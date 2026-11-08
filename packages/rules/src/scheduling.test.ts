import { describe, expect, it } from "vitest";

import { budapestTime } from "./calendar";
import type { SlotRange } from "./slots";
import {
  activeSides,
  isValidActivity,
  proposalKind,
  schedulingActions,
  schedulingState,
  isLateCancel,
  lateCancellers,
  waitingFor,
  type SchedulingEvent,
} from "./scheduling";

const at = (day: string, h: number, m = 0) => budapestTime(day, h, m);
const deadline = at("2026-11-29", 23, 59);
const now = at("2026-11-10", 12);
const range = (day: string, from: number, to: number): SlotRange => ({ start: at(day, from), end: at(day, to) });
// Three ranges one match long: their starts are the only choices.
const SLOTS = [at("2026-11-12", 18), at("2026-11-13", 19), at("2026-11-14", 10)];
const RANGES: SlotRange[] = SLOTS.map((s) => ({ start: s, end: new Date(s.getTime() + 3600_000) }));

const proposal = (side: "a" | "b", when = at("2026-11-10", 9), ranges = RANGES, clubId: number | null = null): SchedulingEvent => ({
  kind: "proposal",
  side,
  at: when,
  ranges,
  clubId,
});

describe("schedulingState (spec 6, #26)", () => {
  it("no log: to schedule", () => {
    expect(schedulingState([], now)).toEqual({ status: "to_schedule" });
  });

  it("a proposal is open for the other pair", () => {
    expect(schedulingState([proposal("a", undefined, RANGES, 7)], now)).toEqual({
      status: "proposed",
      by: "a",
      ranges: RANGES,
      clubId: 7,
      at: at("2026-11-10", 9),
    });
  });

  it("accepting one slot schedules the match at it, with the proposal's venue", () => {
    const log: SchedulingEvent[] = [proposal("a", undefined, RANGES, 7), { kind: "accepted", side: "b", at: now, slot: SLOTS[1] }];
    expect(schedulingState(log, now)).toEqual({ status: "scheduled", slot: SLOTS[1], clubId: 7 });
  });

  it("a pair can't accept its own proposal, nor a slot that wasn't offered", () => {
    expect(schedulingState([proposal("a"), { kind: "accepted", side: "a", at: now, slot: SLOTS[0] }], now).status).toBe("proposed");
    const other = at("2026-11-15", 10);
    expect(schedulingState([proposal("a"), { kind: "accepted", side: "b", at: now, slot: other }], now).status).toBe("proposed");
  });

  it("a counter-proposal replaces the open proposal", () => {
    const counter = [range("2026-11-20", 18, 20), range("2026-11-21", 10, 14)];
    const log: SchedulingEvent[] = [proposal("a"), { kind: "counter_proposal", side: "b", at: now, ranges: counter }];
    const state = schedulingState(log, now);
    expect(state).toMatchObject({ status: "proposed", by: "b", ranges: counter });
    // The first proposal's slots can't be accepted any more.
    expect(schedulingState([...log, { kind: "accepted", side: "b", at: now, slot: SLOTS[0] }], now).status).toBe("proposed");
  });

  it("slots that have started drop out; when all have, the proposal lapses", () => {
    expect(schedulingState([proposal("a")], at("2026-11-13", 9))).toMatchObject({ ranges: [RANGES[1], RANGES[2]] });
    expect(schedulingState([proposal("a")], at("2026-11-14", 10))).toEqual({ status: "to_schedule" });
  });

  describe("ranges (D144)", () => {
    const ranges = [range("2026-11-12", 14, 18), range("2026-11-13", 18, 20)];
    const offer = proposal("a", undefined, ranges);
    const accept = (slot: Date): SchedulingEvent => ({ kind: "accepted", side: "b", at: now, slot });

    it("any whole-hour start inside a range schedules the match, up to the end minus 60 minutes", () => {
      expect(schedulingState([offer, accept(at("2026-11-12", 15))], now)).toMatchObject({ status: "scheduled", slot: at("2026-11-12", 15) });
      expect(schedulingState([offer, accept(at("2026-11-12", 17))], now)).toMatchObject({ status: "scheduled" });
      expect(schedulingState([offer, accept(at("2026-11-13", 19))], now)).toMatchObject({ status: "scheduled" });
    });

    it("a start that doesn't fit a range changes nothing", () => {
      for (const slot of [at("2026-11-12", 18), at("2026-11-12", 13), at("2026-11-12", 15, 30), at("2026-11-13", 20)])
        expect(schedulingState([offer, accept(slot)], now).status).toBe("proposed");
    });

    it("a started range is trimmed to its next start; the proposal lapses when none is left", () => {
      expect(schedulingState([offer], at("2026-11-12", 15, 20))).toMatchObject({ ranges: [range("2026-11-12", 16, 18), ranges[1]] });
      expect(schedulingState([offer], at("2026-11-12", 17))).toMatchObject({ ranges: [ranges[1]] });
      expect(schedulingState([offer], at("2026-11-13", 19))).toEqual({ status: "to_schedule" });
    });

    it("a proposal stored before D144 (off-hour starts, one match long) still works", () => {
      const legacy = { start: at("2026-11-12", 19, 30), end: at("2026-11-12", 20, 30) };
      const log = [proposal("a", undefined, [legacy, RANGES[1]!]), accept(legacy.start)];
      expect(schedulingState(log, now)).toMatchObject({ status: "scheduled", slot: legacy.start });
    });

    it("the other pair can accept the open ranges", () => {
      const state = schedulingState([offer], at("2026-11-12", 15, 20));
      expect(schedulingActions(state, "b", at("2026-11-12", 15, 20), deadline).accept).toEqual([range("2026-11-12", 16, 18), ranges[1]]);
    });
  });

  describe("agreed time (spec 6.3)", () => {
    const agreed: SchedulingEvent = { kind: "agreed_time", side: "a", at: now, slot: at("2026-11-11", 20), clubId: 3 };

    it("waits for the other pair", () => {
      expect(schedulingState([agreed], now)).toEqual({ status: "agreed_time", by: "a", slot: at("2026-11-11", 20), clubId: 3, at: now });
    });

    it("confirmed by the other pair: scheduled", () => {
      expect(schedulingState([agreed, { kind: "agreed_confirmed", side: "b", at: now }], now)).toEqual({
        status: "scheduled",
        slot: at("2026-11-11", 20),
        clubId: 3,
      });
    });

    it("declined by the other pair: back to scheduling", () => {
      expect(schedulingState([agreed, { kind: "agreed_declined", side: "b", at: now }], now)).toEqual({ status: "to_schedule" });
    });

    it("the recording pair can't confirm or decline its own", () => {
      expect(schedulingState([agreed, { kind: "agreed_confirmed", side: "a", at: now }], now).status).toBe("agreed_time");
      expect(schedulingState([agreed, { kind: "agreed_declined", side: "a", at: now }], now).status).toBe("agreed_time");
    });

    it("lapses unconfirmed when its start passes", () => {
      expect(schedulingState([agreed], at("2026-11-11", 20))).toEqual({ status: "to_schedule" });
    });

    it("replaces an open proposal, and a proposal replaces it", () => {
      expect(schedulingState([proposal("b"), agreed], now).status).toBe("agreed_time");
      expect(schedulingState([agreed, proposal("b", now)], now)).toMatchObject({ status: "proposed", by: "b" });
    });

    it("a confirmed time stays scheduled after it starts", () => {
      const log: SchedulingEvent[] = [agreed, { kind: "agreed_confirmed", side: "b", at: now }];
      expect(schedulingState(log, at("2026-11-12", 9)).status).toBe("scheduled");
    });
  });

  it("no proposal or agreed time reopens a scheduled match (only cancelling does, #27)", () => {
    const log: SchedulingEvent[] = [proposal("a"), { kind: "accepted", side: "b", at: now, slot: SLOTS[0] }];
    const later: SchedulingEvent[] = [
      proposal("b", now),
      { kind: "agreed_time", side: "a", at: now, slot: at("2026-11-20", 10) },
    ];
    expect(schedulingState([...log, ...later], now)).toMatchObject({ status: "scheduled", slot: SLOTS[0] });
  });
});

describe("schedulingActions (spec 6, #26)", () => {
  it("to schedule: either pair proposes or records an agreed time; nothing to answer", () => {
    for (const side of ["a", "b"] as const)
      expect(schedulingActions({ status: "to_schedule" }, side, now, deadline)).toEqual({
        propose: true,
        recordAgreed: true,
        accept: [],
        confirm: false,
        decline: false,
        venue: false,
        cancel: false,
      });
  });

  it("the other pair accepts one of the open slots or counter-proposes; no plain rejection", () => {
    const state = schedulingState([proposal("a")], now);
    expect(schedulingActions(state, "b", now, deadline)).toEqual({ propose: true, recordAgreed: true, accept: RANGES, confirm: false, decline: false, venue: false, cancel: false });
    // The proposing pair doesn't wait: it can propose again.
    expect(schedulingActions(state, "a", now, deadline)).toEqual({ propose: true, recordAgreed: true, accept: [], confirm: false, decline: false, venue: false, cancel: false });
  });

  it("the other pair confirms or declines an agreed time", () => {
    const state = schedulingState([{ kind: "agreed_time", side: "b", at: now, slot: at("2026-11-11", 20) }], now);
    expect(schedulingActions(state, "a", now, deadline)).toMatchObject({ confirm: true, decline: true });
    expect(schedulingActions(state, "b", now, deadline)).toMatchObject({ confirm: false, decline: false });
  });

  it("once scheduled only the venue and cancelling (#27); nothing after the deadline", () => {
    const none = { propose: false, recordAgreed: false, accept: [], confirm: false, decline: false, venue: false, cancel: false };
    const scheduled = { status: "scheduled", slot: SLOTS[0]!, clubId: null } as const;
    for (const side of ["a", "b"] as const) expect(schedulingActions(scheduled, side, now, deadline)).toEqual({ ...none, venue: true, cancel: true });
    // Once the slot has started it can't be cancelled; the venue can still be recorded.
    expect(schedulingActions(scheduled, "a", SLOTS[0]!, deadline)).toEqual({ ...none, venue: true });
    expect(schedulingActions(scheduled, "a", deadline, deadline)).toEqual(none);
    expect(schedulingActions({ status: "to_schedule" }, "a", deadline, deadline)).toEqual(none);
  });
});

describe("proposalKind", () => {
  it("a counter-proposal answers the other pair's open proposal or agreed time", () => {
    expect(proposalKind({ status: "to_schedule" }, "a")).toBe("proposal");
    const theirs = schedulingState([proposal("b")], now);
    expect(proposalKind(theirs, "a")).toBe("counter_proposal");
    expect(proposalKind(theirs, "b")).toBe("proposal");
    const agreed = schedulingState([{ kind: "agreed_time", side: "b", at: now, slot: at("2026-11-11", 20) }], now);
    expect(proposalKind(agreed, "a")).toBe("counter_proposal");
  });
});

describe("waitingFor", () => {
  it("both while nothing is open, the answering pair after a step, none once scheduled", () => {
    expect(waitingFor({ status: "to_schedule" })).toEqual(["a", "b"]);
    expect(waitingFor(schedulingState([proposal("a")], now))).toEqual(["b"]);
    expect(waitingFor(schedulingState([{ kind: "agreed_time", side: "b", at: now, slot: at("2026-11-11", 20) }], now))).toEqual(["a"]);
    expect(waitingFor({ status: "scheduled", slot: SLOTS[0]!, clubId: null })).toEqual([]);
  });
});

describe("valid activity (spec 8)", () => {
  it("proposing, counter-proposing, recording and confirming an agreed time count; accepting and declining don't", () => {
    expect(isValidActivity("proposal")).toBe(true);
    expect(isValidActivity("counter_proposal")).toBe(true);
    expect(isValidActivity("agreed_time")).toBe(true);
    expect(isValidActivity("agreed_confirmed")).toBe(true);
    expect(isValidActivity("accepted")).toBe(false);
    expect(isValidActivity("agreed_declined")).toBe(false);
  });

  it("activeSides counts only steps before the deadline", () => {
    expect(activeSides([], deadline)).toEqual([]);
    expect(activeSides([proposal("a")], deadline)).toEqual(["a"]);
    const log: SchedulingEvent[] = [
      { kind: "agreed_time", side: "b", at: now, slot: at("2026-11-11", 20) },
      { kind: "agreed_confirmed", side: "a", at: now },
    ];
    expect(activeSides(log, deadline)).toEqual(["a", "b"]);
    expect(activeSides([proposal("a", deadline)], deadline)).toEqual([]);
  });

  it("a pair that only declined is not active", () => {
    const log: SchedulingEvent[] = [
      { kind: "agreed_time", side: "a", at: now, slot: at("2026-11-11", 20) },
      { kind: "agreed_declined", side: "b", at: now },
    ];
    expect(activeSides(log, deadline)).toEqual(["a"]);
  });
});

describe("venue and cancellation (spec 6.4 and 6.6, #27)", () => {
  // Scheduled by b accepting a's slot on Thu 12 Nov 18:00, venue 7 offered with it.
  const SLOT = SLOTS[0]!;
  const booked: SchedulingEvent[] = [proposal("a", undefined, RANGES, 7), { kind: "accepted", side: "b", at: now, slot: SLOT }];
  const cancel = (side: "a" | "b", when: Date): SchedulingEvent => ({ kind: "cancelled", side, at: when, slot: SLOT });
  const hours = (n: number) => new Date(SLOT.getTime() - n * 3_600_000);
  const LATER = [range("2026-11-20", 18, 20), range("2026-11-21", 9, 13)];

  it("either pair records the venue and the court; the latest wins and the match stays scheduled", () => {
    const log: SchedulingEvent[] = [...booked, { kind: "venue", side: "b", at: now, clubId: 9, court: "2-es pálya" }];
    expect(schedulingState(log, now)).toEqual({ status: "scheduled", slot: SLOT, clubId: 9, court: "2-es pálya" });
    const changed: SchedulingEvent[] = [...log, { kind: "venue", side: "a", at: now, clubId: 4 }];
    expect(schedulingState(changed, now)).toEqual({ status: "scheduled", slot: SLOT, clubId: 4, court: null });
  });

  it("a venue before the match is scheduled changes nothing", () => {
    expect(schedulingState([{ kind: "venue", side: "a", at: now, clubId: 9 }], now)).toEqual({ status: "to_schedule" });
  });

  it("late means under 24 hours before the slot: 23 hours is late, exactly 24 and 25 are not", () => {
    expect(isLateCancel(SLOT, hours(23))).toBe(true);
    expect(isLateCancel(SLOT, hours(24))).toBe(false);
    expect(isLateCancel(SLOT, hours(25))).toBe(false);
  });

  it("cancelling 25 hours before goes back to scheduling, for both pairs", () => {
    const state = schedulingState([...booked, cancel("a", hours(25))], hours(25));
    expect(state).toEqual({ status: "to_schedule" });
    expect(waitingFor(state)).toEqual(["a", "b"]);
  });

  it("cancelling 23 hours before is late: the cancelling pair must propose next", () => {
    const state = schedulingState([...booked, cancel("b", hours(23))], hours(23));
    expect(state).toEqual({ status: "to_schedule", nextBy: "b" });
    expect(waitingFor(state)).toEqual(["b"]);
    // The other pair isn't blocked (D74).
    expect(schedulingActions(state, "a", hours(23), deadline)).toMatchObject({ propose: true, recordAgreed: true });
    // A new proposal ends it.
    expect(schedulingState([...booked, cancel("b", hours(23)), proposal("b", hours(22), LATER)], hours(22))).toMatchObject({
      status: "proposed",
      by: "b",
    });
  });

  it("a cancellation once the slot started, or without a scheduled match, changes nothing", () => {
    expect(schedulingState([...booked, cancel("a", SLOT)], SLOT)).toMatchObject({ status: "scheduled" });
    expect(schedulingState([proposal("a"), cancel("b", now)], now)).toMatchObject({ status: "proposed" });
  });

  it("after a cancellation the match can be scheduled again", () => {
    const again: SchedulingEvent[] = [
      ...booked,
      cancel("a", hours(30)),
      { kind: "agreed_time", side: "b", at: hours(29), slot: at("2026-11-20", 18) },
      { kind: "agreed_confirmed", side: "a", at: hours(28) },
    ];
    expect(schedulingState(again, hours(28))).toEqual({ status: "scheduled", slot: at("2026-11-20", 18), clubId: null });
  });

  it("neither cancelling nor the venue is valid activity (spec 8)", () => {
    expect(isValidActivity("cancelled")).toBe(false);
    expect(isValidActivity("venue")).toBe(false);
  });

  describe("lateCancellers (spec 6.6 and 8, for #11)", () => {
    it("names the pair that cancelled late, whatever its earlier activity", () => {
      expect(lateCancellers([...booked, cancel("a", hours(23))], deadline)).toEqual(["a"]);
      expect(lateCancellers([...booked, cancel("a", hours(25))], deadline)).toEqual([]);
    });

    it("keeps a late cancellation after the match was scheduled again", () => {
      const log: SchedulingEvent[] = [
        ...booked,
        cancel("b", hours(2)),
        { kind: "agreed_time", side: "a", at: hours(1), slot: at("2026-11-20", 18) },
        { kind: "agreed_confirmed", side: "b", at: hours(1) },
        { kind: "cancelled", side: "a", at: at("2026-11-15", 10), slot: at("2026-11-20", 18) },
      ];
      // b was late; a cancelled days ahead.
      expect(lateCancellers(log, deadline)).toEqual(["b"]);
    });

    it("ignores cancellations that changed nothing", () => {
      expect(lateCancellers([proposal("a"), cancel("b", now)], deadline)).toEqual([]);
    });
  });
});
