import { describe, expect, it } from "vitest";

import { budapestTime } from "./calendar";
import {
  activeSides,
  isValidActivity,
  proposalKind,
  schedulingActions,
  schedulingState,
  waitingFor,
  type SchedulingEvent,
} from "./scheduling";

const at = (day: string, h: number, m = 0) => budapestTime(day, h, m);
const deadline = at("2026-11-29", 23, 59);
const now = at("2026-11-10", 12);
const SLOTS = [at("2026-11-12", 18), at("2026-11-13", 19), at("2026-11-14", 10)];

const proposal = (side: "a" | "b", when = at("2026-11-10", 9), slots = SLOTS, clubId: number | null = null): SchedulingEvent => ({
  kind: "proposal",
  side,
  at: when,
  slots,
  clubId,
});

describe("schedulingState (spec 6, #26)", () => {
  it("no log: to schedule", () => {
    expect(schedulingState([], now)).toEqual({ status: "to_schedule" });
  });

  it("a proposal is open for the other pair", () => {
    expect(schedulingState([proposal("a", undefined, SLOTS, 7)], now)).toEqual({
      status: "proposed",
      by: "a",
      slots: SLOTS,
      clubId: 7,
      at: at("2026-11-10", 9),
    });
  });

  it("accepting one slot schedules the match at it, with the proposal's venue", () => {
    const log: SchedulingEvent[] = [proposal("a", undefined, SLOTS, 7), { kind: "accepted", side: "b", at: now, slot: SLOTS[1] }];
    expect(schedulingState(log, now)).toEqual({ status: "scheduled", slot: SLOTS[1], clubId: 7 });
  });

  it("a pair can't accept its own proposal, nor a slot that wasn't offered", () => {
    expect(schedulingState([proposal("a"), { kind: "accepted", side: "a", at: now, slot: SLOTS[0] }], now).status).toBe("proposed");
    const other = at("2026-11-15", 10);
    expect(schedulingState([proposal("a"), { kind: "accepted", side: "b", at: now, slot: other }], now).status).toBe("proposed");
  });

  it("a counter-proposal replaces the open proposal", () => {
    const counter = [at("2026-11-20", 18), at("2026-11-21", 10), at("2026-11-21", 12)];
    const log: SchedulingEvent[] = [proposal("a"), { kind: "counter_proposal", side: "b", at: now, slots: counter }];
    const state = schedulingState(log, now);
    expect(state).toMatchObject({ status: "proposed", by: "b", slots: counter });
    // The first proposal's slots can't be accepted any more.
    expect(schedulingState([...log, { kind: "accepted", side: "b", at: now, slot: SLOTS[0] }], now).status).toBe("proposed");
  });

  it("slots that have started drop out; when all have, the proposal lapses", () => {
    expect(schedulingState([proposal("a")], at("2026-11-13", 9))).toMatchObject({ slots: [SLOTS[1], SLOTS[2]] });
    expect(schedulingState([proposal("a")], at("2026-11-14", 10))).toEqual({ status: "to_schedule" });
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

  it("nothing reopens a scheduled match here (cancelling is #27)", () => {
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
      });
  });

  it("the other pair accepts one of the open slots or counter-proposes; no plain rejection", () => {
    const state = schedulingState([proposal("a")], now);
    expect(schedulingActions(state, "b", now, deadline)).toEqual({ propose: true, recordAgreed: true, accept: SLOTS, confirm: false, decline: false });
    // The proposing pair doesn't wait: it can propose again.
    expect(schedulingActions(state, "a", now, deadline)).toEqual({ propose: true, recordAgreed: true, accept: [], confirm: false, decline: false });
  });

  it("the other pair confirms or declines an agreed time", () => {
    const state = schedulingState([{ kind: "agreed_time", side: "b", at: now, slot: at("2026-11-11", 20) }], now);
    expect(schedulingActions(state, "a", now, deadline)).toMatchObject({ confirm: true, decline: true });
    expect(schedulingActions(state, "b", now, deadline)).toMatchObject({ confirm: false, decline: false });
  });

  it("nothing once scheduled or after the deadline", () => {
    const none = { propose: false, recordAgreed: false, accept: [], confirm: false, decline: false };
    expect(schedulingActions({ status: "scheduled", slot: SLOTS[0]!, clubId: null }, "a", now, deadline)).toEqual(none);
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
