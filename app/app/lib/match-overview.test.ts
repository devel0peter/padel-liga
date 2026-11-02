import { budapestTime, type ResultState, type SchedulingEventKind, type SchedulingState } from "@padel-liga/rules";
import { describe, expect, it } from "vitest";

import {
  activityLine,
  filterMatches,
  overviewStatus,
  parseFilter,
  quietUntil,
  resultStatus,
  statusOf,
  STUCK_TEXT,
  stuckReason,
  type OverviewStatus,
  type StuckReason,
} from "./match-overview";

// Phase 1 starts Mon 9 Nov 2026 00:00 Budapest.
const PHASE = budapestTime("2026-11-09", 0, 0);
const names = { a: "Kiss Anna – Nagy Béla", b: "Tóth Cili – Szabó Dani" };
const slot = budapestTime("2026-11-12", 18, 0);
const hours = (from: Date, h: number) => new Date(from.getTime() + h * 3600 * 1000);

describe("overviewStatus (#158 requirement 1)", () => {
  it("to schedule", () => {
    expect(overviewStatus({ status: "to_schedule" }, names)).toEqual({ label: "Egyeztetésre vár", tone: "todo" });
  });

  it("a proposal names the pair whose answer it waits for", () => {
    const state: SchedulingState = { status: "proposed", by: "a", slots: [slot], clubId: null, at: slot };
    expect(overviewStatus(state, names).label).toBe("Időpontokat ajánlottak, Tóth Cili – Szabó Dani válaszára vár");
    expect(overviewStatus({ ...state, by: "b" }, names).label).toBe("Időpontokat ajánlottak, Kiss Anna – Nagy Béla válaszára vár");
  });

  it("an agreed time names its time and the pair that has to confirm", () => {
    const state: SchedulingState = { status: "agreed_time", by: "b", slot, clubId: null, at: slot };
    expect(overviewStatus(state, names)).toEqual({
      label: "Megbeszélt időpont (nov. 12., csütörtök 18:00), Kiss Anna – Nagy Béla megerősítésére vár",
      tone: "waiting",
    });
  });

  it("a scheduled match with its time and venue", () => {
    const state: SchedulingState = { status: "scheduled", slot, clubId: 1 };
    expect(overviewStatus(state, names, "Ace Padel")).toEqual({ label: "Lefixálva: nov. 12., csütörtök 18:00, Ace Padel", tone: "done" });
    expect(overviewStatus(state, names).label).toBe("Lefixálva: nov. 12., csütörtök 18:00");
  });
});

describe("result statuses (#28, #29 on the #158 overview)", () => {
  const score = { sets: [[4, 1], [2, 4]] as [number, number][], superTieBreak: [10, 8] as [number, number] };
  const recorded: ResultState = { status: "recorded", by: "b", score, at: slot };
  const disputed: ResultState = { status: "disputed", by: "a", score, at: slot, counter: null, disputedAt: slot };
  const scheduled: SchedulingState = { status: "scheduled", slot, clubId: null };

  it("a recorded result names the score and the pair that has to confirm", () => {
    expect(resultStatus(recorded, names)).toEqual({ label: "Eredmény: 4:1, 2:4, szuper tie-break 10:8, Kiss Anna – Nagy Béla megerősítésére vár", tone: "waiting" });
    expect(statusOf(scheduled, recorded)).toBe("result_pending");
  });

  it("a disputed result waits for the organizer", () => {
    expect(resultStatus(disputed, names)).toEqual({ label: "Vitatott eredmény, a szervező dönt", tone: "todo" });
    expect(statusOf(scheduled, disputed)).toBe("disputed");
  });

  it("a played match with its score and winner; an organizer's decision says so", () => {
    const outcome = { kind: "played" as const, score };
    expect(resultStatus({ status: "final", outcome, how: "confirmed", at: slot }, names)).toEqual({
      label: "Lejátszva: 4:1, 2:4, szuper tie-break 10:8 (nyert: Kiss Anna – Nagy Béla)",
      tone: "done",
    });
    expect(resultStatus({ status: "final", outcome, how: "organizer", at: slot }, names)?.label).toMatch(/^Döntés: 4:1, 2:4/);
    expect(statusOf(scheduled, { status: "final", outcome, how: "auto_accepted", at: slot })).toBe("final");
  });

  it("without a result: no result line, the scheduling status", () => {
    expect(resultStatus({ status: "none" }, names)).toBeNull();
    expect(statusOf(scheduled, { status: "none" })).toBe("scheduled");
  });
});

describe("quietUntil", () => {
  it("is the Wednesday 00:00 Budapest of the scheduled week", () => {
    expect(quietUntil(PHASE, 1)).toEqual(budapestTime("2026-11-11", 0, 0));
    expect(quietUntil(PHASE, 3)).toEqual(budapestTime("2026-11-25", 0, 0));
  });

  it("follows the Budapest calendar across a daylight-saving change", () => {
    // Phase from Mon 23 Mar 2026; week 2 starts Mon 30 Mar (summer time from 29 Mar).
    const spring = budapestTime("2026-03-23", 0, 0);
    expect(quietUntil(spring, 2)).toEqual(new Date("2026-03-31T22:00:00Z"));
  });
});

describe("stuckReason (#158 stuck match)", () => {
  const base = { phaseStartsAt: PHASE, week: 1 };
  const wednesday = budapestTime("2026-11-11", 0, 0);
  const monday = budapestTime("2026-11-09", 10, 0);
  const toSchedule: SchedulingState = { status: "to_schedule" };
  const ev = (kind: SchedulingEventKind, at: Date) => ({ kind, at });

  it("no valid activity: stuck from the 3rd day of the scheduled week, not before", () => {
    const s = { ...base, state: toSchedule, events: [] };
    expect(stuckReason({ ...s, now: new Date(wednesday.getTime() - 1) })).toBeNull();
    expect(stuckReason({ ...s, now: wednesday })).toBe("no_activity");
    // A week 3 match isn't stuck in week 1.
    expect(stuckReason({ ...s, week: 3, now: wednesday })).toBeNull();
  });

  it("accepting or declining alone isn't valid activity (spec 8)", () => {
    expect(stuckReason({ ...base, state: toSchedule, events: [ev("agreed_declined", monday)], now: wednesday })).toBe("no_activity");
  });

  it("a proposal unanswered for 48 hours", () => {
    const state: SchedulingState = { status: "proposed", by: "a", slots: [hours(monday, 100)], clubId: null, at: monday };
    const events = [ev("proposal", monday)];
    expect(stuckReason({ ...base, state, events, now: hours(monday, 47.99) })).toBeNull();
    expect(stuckReason({ ...base, state, events, now: hours(monday, 48) })).toBe("unanswered");
  });

  it("an agreed time unconfirmed for 48 hours", () => {
    const state: SchedulingState = { status: "agreed_time", by: "b", slot: hours(monday, 72), clubId: null, at: monday };
    const events = [ev("agreed_time", monday)];
    expect(stuckReason({ ...base, state, events, now: hours(monday, 47) })).toBeNull();
    expect(stuckReason({ ...base, state, events, now: hours(monday, 49) })).toBe("unanswered");
  });

  it("a proposal that lapsed unanswered stays stuck: back to scheduling, but nobody answered", () => {
    // Every slot has started: the state is back to scheduling.
    for (const kind of ["proposal", "counter_proposal"] as const)
      expect(stuckReason({ ...base, state: toSchedule, events: [ev("proposal", monday), ev(kind, hours(monday, 1))], now: hours(monday, 100) })).toBe(
        "unanswered",
      );
  });

  it("an agreed time that lapsed unconfirmed is stuck once 48 hours passed since it was recorded", () => {
    // Recorded for 3 hours later: it lapses long before the 48 hours.
    const events = [ev("agreed_time", monday)];
    expect(stuckReason({ ...base, state: toSchedule, events, now: hours(monday, 5) })).toBeNull();
    expect(stuckReason({ ...base, state: toSchedule, events, now: hours(monday, 48) })).toBe("unanswered");
  });

  it("an answered offer back to scheduling isn't stuck: declined, or its pairs were active", () => {
    const declined = [ev("agreed_time", monday), ev("agreed_declined", hours(monday, 1))];
    expect(stuckReason({ ...base, state: toSchedule, events: declined, now: hours(monday, 100) })).toBeNull();
  });

  it("a fresh proposal isn't stuck, even late in the week", () => {
    const at = hours(wednesday, 30);
    const state: SchedulingState = { status: "proposed", by: "a", slots: [hours(at, 60)], clubId: null, at };
    expect(stuckReason({ ...base, state, events: [ev("proposal", at)], now: hours(at, 1) })).toBeNull();
  });

  it("a scheduled match isn't stuck", () => {
    const events = [ev("proposal", monday), ev("accepted", hours(monday, 1))];
    expect(stuckReason({ ...base, state: { status: "scheduled", slot, clubId: null }, events, now: hours(wednesday, 200) })).toBeNull();
  });

  it("a result decides alone: one that counts is never stuck, an unconfirmed or disputed one always is", () => {
    const late = hours(wednesday, 200);
    const score = { sets: [[4, 1], [4, 2]] as [number, number][] };
    const final: ResultState = { status: "final", outcome: { kind: "played", score }, how: "confirmed", at: monday };
    // Nobody scheduled, past Wednesday: no_activity without the result.
    expect(stuckReason({ ...base, state: toSchedule, events: [], now: late })).toBe("no_activity");
    expect(stuckReason({ ...base, state: toSchedule, events: [], result: final, now: late })).toBeNull();
    // An offer unanswered for 48 hours, then a result counts.
    expect(stuckReason({ ...base, state: toSchedule, events: [ev("proposal", monday)], result: final, now: late })).toBeNull();
    expect(stuckReason({ ...base, state: toSchedule, events: [], result: { status: "recorded", by: "a", score, at: monday }, now: monday })).toBe("unconfirmed");
    const disputed: ResultState = { status: "disputed", by: "a", score, at: monday, counter: null, disputedAt: monday };
    expect(stuckReason({ ...base, state: { status: "scheduled", slot, clubId: null }, events: [], result: disputed, now: monday })).toBe("disputed");
    expect(stuckReason({ ...base, state: toSchedule, events: [], result: { status: "none" }, now: late })).toBe("no_activity");
  });

  it("has a Hungarian text per reason", () => {
    expect(STUCK_TEXT.no_activity).toBe("Elakadt: még egyik pár sem lépett");
    expect(STUCK_TEXT.unanswered).toBe("Elakadt: 48 órája nincs válasz");
    expect(STUCK_TEXT.unconfirmed).toBe("Elakadt: az eredmény megerősítésre vár");
    expect(STUCK_TEXT.disputed).toBe("Elakadt: vitatott eredmény, dönts róla");
  });
});

describe("filters (#158 requirement 3)", () => {
  const m = (id: number, groupNumber: number, status: OverviewStatus, stuck: StuckReason | null) => ({ id, groupNumber, status, stuck });
  const all = [
    m(1, 1, "to_schedule", "no_activity"),
    m(2, 1, "proposed", "unanswered"),
    m(3, 1, "scheduled", null),
    m(4, 2, "proposed", null),
    m(5, 2, "to_schedule", "no_activity"),
  ];
  const ids = (r: { shown: { id: number }[] }) => r.shown.map((x) => x.id);

  it("reads the URL and ignores what it can't read", () => {
    expect(parseFilter(new URLSearchParams("stuck=1&group=2&status=proposed"))).toEqual({ stuck: true, group: 2, status: "proposed" });
    expect(parseFilter(new URLSearchParams("stuck=yes&group=-1&status=played"))).toEqual({ stuck: false, group: null, status: null });
    expect(parseFilter(new URLSearchParams(""))).toEqual({ stuck: false, group: null, status: null });
    expect(parseFilter(new URLSearchParams("status=disputed")).status).toBe("disputed");
    expect(parseFilter(new URLSearchParams("status=final")).status).toBe("final");
  });

  it("no filter: everything, and the stuck count", () => {
    const r = filterMatches(all, { stuck: false, group: null, status: null });
    expect(ids(r)).toEqual([1, 2, 3, 4, 5]);
    expect(r.stuckCount).toBe(3);
  });

  it("the stuck switch shows exactly the stuck matches, as many as its count", () => {
    const r = filterMatches(all, { stuck: true, group: null, status: null });
    expect(ids(r)).toEqual([1, 2, 5]);
    expect(r.stuckCount).toBe(r.shown.length);
  });

  it("group and status narrow the list and the count", () => {
    expect(ids(filterMatches(all, { stuck: false, group: 2, status: null }))).toEqual([4, 5]);
    expect(filterMatches(all, { stuck: false, group: 2, status: null }).stuckCount).toBe(1);
    expect(ids(filterMatches(all, { stuck: false, group: null, status: "proposed" }))).toEqual([2, 4]);
    expect(ids(filterMatches(all, { stuck: true, group: 1, status: "proposed" }))).toEqual([2]);
    expect(filterMatches(all, { stuck: true, group: null, status: "scheduled" })).toEqual({ shown: [], stuckCount: 0 });
  });
});

describe("activityLine (#158 requirement 2)", () => {
  it("says which pairs have valid activity", () => {
    expect(activityLine({ a: true, b: true }, names)).toBe("Mindkét pár lépett");
    expect(activityLine({ a: true, b: false }, names)).toBe("Csak Kiss Anna – Nagy Béla lépett");
    expect(activityLine({ a: false, b: true }, names)).toBe("Csak Tóth Cili – Szabó Dani lépett");
    expect(activityLine({ a: false, b: false }, names)).toBe("Még egyik pár sem lépett");
  });
});
