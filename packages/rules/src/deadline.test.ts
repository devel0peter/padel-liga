import { describe, expect, it } from "vitest";

import { budapestTime } from "./calendar";
import {
  activeAtDeadline,
  deadlineDecision,
  type DeadlineMatch,
  projectDeadline,
  resolutionCutoff,
  resolutionDue,
  resolveAtDeadline,
} from "./deadline";
import type { SchedulingEvent } from "./scheduling";
import { groupStandings } from "./standings";

const at = (day: string, h: number, m = 0) => budapestTime(day, h, m);
const DEADLINE = at("2026-11-29", 23, 59);
const SLOTS = [at("2026-11-12", 18), at("2026-11-13", 19), at("2026-11-14", 10)];
// Ranges one match long: their starts are the only choices.
const oneHour = (starts: Date[]) => starts.map((s) => ({ start: s, end: new Date(s.getTime() + 3600_000) }));
const RANGES = oneHour(SLOTS);

const proposal = (side: "a" | "b", when = at("2026-11-10", 9), ranges = RANGES): SchedulingEvent => ({ kind: "proposal", side, at: when, ranges });
const counter = (side: "a" | "b", when: Date, ranges = RANGES): SchedulingEvent => ({ kind: "counter_proposal", side, at: when, ranges });
const accepted = (side: "a" | "b", when: Date, slot: Date): SchedulingEvent => ({ kind: "accepted", side, at: when, slot });
const cancelled = (side: "a" | "b", when: Date, slot: Date): SchedulingEvent => ({ kind: "cancelled", side, at: when, slot });

describe("resolutionDue (D103)", () => {
  it("is the Monday 06:00 Budapest after a Sunday 23:59 deadline", () => {
    expect(resolutionDue(DEADLINE)).toEqual(at("2026-11-30", 6));
  });

  it("works across a clock change (summer time)", () => {
    expect(resolutionDue(at("2027-03-28", 23, 59))).toEqual(at("2027-03-29", 6));
  });

  it("a deadline before 06:00 is resolved at 06:00 the same day", () => {
    expect(resolutionDue(at("2026-11-30", 2))).toEqual(at("2026-11-30", 6));
  });

  it("resolutionCutoff: a deadline before it is due, at any time of the day", () => {
    for (const now of [at("2026-11-30", 5, 59), at("2026-11-30", 6), at("2026-11-30", 12), at("2026-12-01", 3)]) {
      const due = resolutionDue(DEADLINE).getTime() <= now.getTime();
      expect(DEADLINE.getTime() < resolutionCutoff(now).getTime()).toBe(due);
    }
    expect(resolutionCutoff(at("2026-11-30", 5, 59))).toEqual(at("2026-11-29", 6));
    expect(resolutionCutoff(at("2026-11-30", 6))).toEqual(at("2026-11-30", 6));
  });
});

describe("resolveAtDeadline (spec 8, #11)", () => {
  it("one side active, the other did nothing: a 4-0 4-0 walkover for the active side, a strike for the other", () => {
    expect(resolveAtDeadline([proposal("a")], DEADLINE)).toEqual({ outcome: { kind: "walkover", winner: "a" }, inactive: ["b"] });
    expect(resolveAtDeadline([proposal("b")], DEADLINE)).toEqual({ outcome: { kind: "walkover", winner: "b" }, inactive: ["a"] });
  });

  it("one side proposed, the other never answered (its slots lapsed): walkover", () => {
    const lapsed = [proposal("a"), proposal("a", at("2026-11-20", 9), oneHour([at("2026-11-23", 18), at("2026-11-24", 18), at("2026-11-25", 18)]))];
    expect(resolveAtDeadline(lapsed, DEADLINE)).toEqual({ outcome: { kind: "walkover", winner: "a" }, inactive: ["b"] });
  });

  it("both active, no agreement: unplayed, no strikes", () => {
    const log = [proposal("a"), counter("b", at("2026-11-11", 9), oneHour([at("2026-11-15", 18), at("2026-11-16", 18), at("2026-11-17", 18)]))];
    expect(resolveAtDeadline(log, DEADLINE)).toEqual({ outcome: { kind: "unplayed" }, inactive: [] });
  });

  it("neither side active: a 0-4 0-4 loss for both, a strike for both", () => {
    expect(resolveAtDeadline([], DEADLINE)).toEqual({ outcome: { kind: "both-inactive" }, inactive: ["a", "b"] });
  });

  it("recording or confirming an agreed time is valid activity", () => {
    const slot = at("2026-11-20", 18);
    // a declined it in time (not valid activity): b recorded, b is the active side.
    const log: SchedulingEvent[] = [
      { kind: "agreed_time", side: "b", at: at("2026-11-10", 9), slot },
      { kind: "agreed_declined", side: "a", at: at("2026-11-10", 10) },
    ];
    expect(resolveAtDeadline(log, DEADLINE).outcome).toEqual({ kind: "walkover", winner: "b" });
  });

  it("an agreed time nobody answered became fixed by itself (D148): an agreed slot, both active, no strikes", () => {
    const slot = at("2026-11-20", 18);
    const log: SchedulingEvent[] = [{ kind: "agreed_time", side: "b", at: at("2026-11-10", 9), slot }];
    expect(resolveAtDeadline(log, DEADLINE)).toEqual({ outcome: { kind: "unplayed" }, inactive: [] });
  });

  it("tapping the SMS or e-mail button is valid activity (D148)", () => {
    const log: SchedulingEvent[] = [proposal("a"), { kind: "contacted", side: "b", at: at("2026-11-12", 9) }];
    expect(resolveAtDeadline(log, DEADLINE)).toEqual({ outcome: { kind: "unplayed" }, inactive: [] });
    expect(resolveAtDeadline([{ kind: "contacted", side: "b", at: at("2026-11-12", 9) }], DEADLINE).outcome).toEqual({ kind: "walkover", winner: "b" });
  });

  it("accepting or declining alone is not valid activity", () => {
    const slot = at("2026-11-20", 18);
    const log: SchedulingEvent[] = [
      { kind: "agreed_time", side: "a", at: at("2026-11-10", 9), slot },
      { kind: "agreed_declined", side: "b", at: at("2026-11-10", 10) },
    ];
    expect(resolveAtDeadline(log, DEADLINE)).toEqual({ outcome: { kind: "walkover", winner: "a" }, inactive: ["b"] });
  });

  it("activity after the deadline doesn't count", () => {
    expect(resolveAtDeadline([proposal("a"), proposal("b", at("2026-11-30", 1))], DEADLINE).outcome).toEqual({ kind: "walkover", winner: "a" });
  });

  it("an agreed slot reached before the deadline counts both sides active: a scheduled slot that passed is unplayed, no strikes", () => {
    // b only accepted (not valid activity by itself), but the match was fixed.
    const log = [proposal("a"), accepted("b", at("2026-11-10", 12), SLOTS[0]!)];
    expect(activeAtDeadline(log, DEADLINE)).toEqual(["a", "b"]);
    expect(resolveAtDeadline(log, DEADLINE)).toEqual({ outcome: { kind: "unplayed" }, inactive: [] });
  });

  it("a confirmed agreed time is an agreed slot too", () => {
    const slot = at("2026-11-29", 18);
    const log: SchedulingEvent[] = [
      { kind: "agreed_time", side: "a", at: at("2026-11-20", 9), slot },
      { kind: "agreed_confirmed", side: "b", at: at("2026-11-20", 10) },
    ];
    expect(resolveAtDeadline(log, DEADLINE)).toEqual({ outcome: { kind: "unplayed" }, inactive: [] });
  });

  it("a slot cancelled more than 24 hours ahead is no agreement and no strike for the canceller by itself", () => {
    const log = [proposal("a"), accepted("b", at("2026-11-10", 12), SLOTS[2]!), cancelled("b", at("2026-11-12", 9), SLOTS[2]!)];
    // b's only steps were accepting and an early cancel: not valid activity.
    expect(resolveAtDeadline(log, DEADLINE)).toEqual({ outcome: { kind: "walkover", winner: "a" }, inactive: ["b"] });
    // Had b proposed again, both were active: unplayed.
    const again = [...log, proposal("b", at("2026-11-13", 9), oneHour([at("2026-11-20", 18), at("2026-11-21", 18), at("2026-11-22", 18)]))];
    expect(resolveAtDeadline(again, DEADLINE)).toEqual({ outcome: { kind: "unplayed" }, inactive: [] });
  });

  it("late cancellation, then not played: the cancelling side is inactive, walkover for the other", () => {
    const log = [proposal("a"), accepted("b", at("2026-11-10", 12), SLOTS[0]!), cancelled("a", at("2026-11-12", 9), SLOTS[0]!)];
    expect(resolveAtDeadline(log, DEADLINE)).toEqual({ outcome: { kind: "walkover", winner: "b" }, inactive: ["a"] });
  });

  it("a late canceller who proposed earlier (and again after) still loses by walkover", () => {
    const log = [
      proposal("a"),
      counter("b", at("2026-11-10", 11), RANGES),
      accepted("a", at("2026-11-10", 12), SLOTS[0]!),
      cancelled("a", at("2026-11-12", 9), SLOTS[0]!),
      proposal("a", at("2026-11-13", 9), oneHour([at("2026-11-20", 18), at("2026-11-21", 18), at("2026-11-22", 18)])),
    ];
    expect(resolveAtDeadline(log, DEADLINE)).toEqual({ outcome: { kind: "walkover", winner: "b" }, inactive: ["a"] });
  });

  it("a late canceller stays inactive even if the match was fixed again and that slot passed", () => {
    const later = at("2026-11-20", 18);
    const log: SchedulingEvent[] = [
      proposal("a"),
      accepted("b", at("2026-11-10", 12), SLOTS[0]!),
      cancelled("b", at("2026-11-12", 9), SLOTS[0]!),
      { kind: "agreed_time", side: "b", at: at("2026-11-13", 9), slot: later },
      { kind: "agreed_confirmed", side: "a", at: at("2026-11-13", 10) },
    ];
    expect(resolveAtDeadline(log, DEADLINE)).toEqual({ outcome: { kind: "walkover", winner: "a" }, inactive: ["b"] });
  });

  it("both sides cancelled late: neither counts as active, a loss and a strike for both", () => {
    const later = at("2026-11-20", 18);
    const log: SchedulingEvent[] = [
      proposal("a"),
      accepted("b", at("2026-11-10", 12), SLOTS[0]!),
      cancelled("a", at("2026-11-12", 9), SLOTS[0]!),
      { kind: "agreed_time", side: "a", at: at("2026-11-13", 9), slot: later },
      { kind: "agreed_confirmed", side: "b", at: at("2026-11-13", 10) },
      cancelled("b", at("2026-11-20", 8), later),
    ];
    expect(resolveAtDeadline(log, DEADLINE)).toEqual({ outcome: { kind: "both-inactive" }, inactive: ["a", "b"] });
  });

  it("the outcomes count in the table as spec 9 says: walkover 3-0, both inactive 0-0 in the differences, unplayed nothing", () => {
    const rows = groupStandings(
      [
        { id: "A", elo: 1200 },
        { id: "B", elo: 1200 },
        { id: "C", elo: 1200 },
      ],
      [
        { a: "A", b: "B", outcome: resolveAtDeadline([proposal("a")], DEADLINE).outcome },
        { a: "B", b: "C", outcome: resolveAtDeadline([], DEADLINE).outcome },
        { a: "A", b: "C", outcome: resolveAtDeadline([proposal("a"), proposal("b", at("2026-11-11", 9))], DEADLINE).outcome },
      ],
    );
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get("A")).toMatchObject({ points: 3, matches: 1, setDiff: 2, gameDiff: 8 });
    expect(by.get("B")).toMatchObject({ points: 0, matches: 2, setDiff: -4, gameDiff: -16 });
    expect(by.get("C")).toMatchObject({ points: 0, matches: 1, setDiff: -2, gameDiff: -8 });
  });
});

describe("deadlineDecision: the one rule of the run and its projection (spec 8, D103, D108, #362)", () => {
  const match = (over: Partial<DeadlineMatch> = {}): DeadlineMatch => ({
    status: "open",
    withdrawn: false,
    openNoShow: false,
    events: [],
    deadline: DEADLINE,
    ...over,
  });

  it("resolves an open or scheduled match by the spec 8 table (resolveAtDeadline)", () => {
    expect(deadlineDecision(match({ events: [proposal("a")] }))).toEqual({
      kind: "resolve",
      resolution: { outcome: { kind: "walkover", winner: "a" }, inactive: ["b"] },
    });
    expect(deadlineDecision(match())).toEqual({ kind: "resolve", resolution: { outcome: { kind: "both-inactive" }, inactive: ["a", "b"] } });
    const both = [proposal("a"), proposal("b", at("2026-11-11", 9))];
    expect(deadlineDecision(match({ events: both }))).toEqual({ kind: "resolve", resolution: { outcome: { kind: "unplayed" }, inactive: [] } });
    const scheduled = [proposal("a"), accepted("b", at("2026-11-10", 12), SLOTS[0]!)];
    expect(deadlineDecision(match({ status: "scheduled", events: scheduled }))).toEqual({
      kind: "resolve",
      resolution: { outcome: { kind: "unplayed" }, inactive: [] },
    });
  });

  it("a late cancellation: walkover for the other side", () => {
    const log = [proposal("a"), accepted("b", at("2026-11-10", 12), SLOTS[0]!), cancelled("a", at("2026-11-12", 9), SLOTS[0]!)];
    expect(deadlineDecision(match({ events: log }))).toEqual({
      kind: "resolve",
      resolution: { outcome: { kind: "walkover", winner: "b" }, inactive: ["a"] },
    });
  });

  it("leaves alone a final match, a result waiting for confirmation, a disputed one and one with a waiting no-show report", () => {
    expect(deadlineDecision(match({ status: "final" }))).toEqual({ kind: "leave", reason: "final" });
    expect(deadlineDecision(match({ status: "result_pending" }))).toEqual({ kind: "leave", reason: "result_pending" });
    expect(deadlineDecision(match({ status: "disputed" }))).toEqual({ kind: "leave", reason: "disputed" });
    expect(deadlineDecision(match({ status: "scheduled", openNoShow: true }))).toEqual({ kind: "leave", reason: "no_show" });
  });

  it("never resolves a withdrawn pair's match, whatever its state", () => {
    for (const status of ["open", "scheduled", "result_pending", "final"] as const)
      expect(deadlineDecision(match({ status, withdrawn: true, openNoShow: true }))).toEqual({ kind: "leave", reason: "withdrawn" });
  });
});

describe("projectDeadline (#362): outcomes and strikes if the deadline came now", () => {
  // Pairs 1-4, players "1a", "1b", ...
  const PAIRS = [1, 2, 3, 4].map((id) => ({ id, players: [`${id}a`, `${id}b`] }));
  const m = (id: number, pairA: number, pairB: number, over: Partial<DeadlineMatch> = {}) => ({
    id,
    pairA,
    pairB,
    status: "open" as const,
    withdrawn: false,
    openNoShow: false,
    events: [] as SchedulingEvent[],
    deadline: DEADLINE,
    ...over,
  });

  it("gives every match its decision and no strike for both-active or left-alone matches", () => {
    const p = projectDeadline(
      [m(1, 1, 2, { events: [proposal("a"), proposal("b", at("2026-11-11", 9))] }), m(2, 3, 4, { status: "disputed" }), m(3, 1, 3, { status: "final" })],
      PAIRS,
      new Map(),
    );
    expect(p.decisions.get(1)).toEqual({ kind: "resolve", resolution: { outcome: { kind: "unplayed" }, inactive: [] } });
    expect(p.decisions.get(2)).toEqual({ kind: "leave", reason: "disputed" });
    expect(p.decisions.get(3)).toEqual({ kind: "leave", reason: "final" });
    expect([...p.strikes.values()].every((s) => s.now === 0 && s.after === 0)).toBe(true);
    expect(p.warned).toEqual([]);
    expect(p.leaving).toEqual([]);
  });

  it("a pair with 1 strike and one projected inactive match: both players reach their 2nd (the warning)", () => {
    const p = projectDeadline(
      [m(1, 1, 2, { events: [proposal("a")] })],
      PAIRS,
      new Map([
        ["2a", 1],
        ["2b", 1],
      ]),
    );
    expect(p.strikes.get("2a")).toEqual({ now: 1, after: 2 });
    expect(p.strikes.get("1a")).toEqual({ now: 0, after: 0 });
    expect(p.warned).toEqual([
      { pairId: 2, userId: "2a" },
      { pairId: 2, userId: "2b" },
    ]);
    expect(p.leaving).toEqual([]);
  });

  it("strikes belong to the player: the player at 2 reaches 3 and the pair would leave, the partner at 0 reaches 1", () => {
    const p = projectDeadline([m(1, 1, 2, { events: [proposal("a")] })], PAIRS, new Map([["2a", 2]]));
    expect(p.strikes.get("2a")).toEqual({ now: 2, after: 3 });
    expect(p.strikes.get("2b")).toEqual({ now: 0, after: 1 });
    expect(p.warned).toEqual([]);
    expect(p.leaving).toEqual([2]);
  });

  it("two projected inactive matches count in match order: the warning at 2, then 3 and leaving", () => {
    const p = projectDeadline([m(2, 2, 3), m(1, 1, 2, { events: [proposal("a")] })], PAIRS, new Map([["2a", 1]]));
    expect(p.strikes.get("2a")).toEqual({ now: 1, after: 3 });
    expect(p.strikes.get("3a")).toEqual({ now: 0, after: 1 });
    // Match 1 first: 2a reaches 2 (the warning), then match 2 brings 2a to 3.
    expect(p.warned).toEqual([{ pairId: 2, userId: "2a" }]);
    expect(p.leaving).toEqual([2]);
  });

  it("a pair already at 3 is on the leaving list; a withdrawn pair's match gives no strike", () => {
    const p = projectDeadline([m(1, 1, 4, { withdrawn: true })], PAIRS, new Map([["3b", 3]]));
    expect(p.decisions.get(1)).toEqual({ kind: "leave", reason: "withdrawn" });
    expect(p.strikes.get("1a")!.after).toBe(0);
    expect(p.leaving).toEqual([3]);
  });

  it("a substitute never gets a strike: only the pair's two players are counted", () => {
    const p = projectDeadline([m(1, 1, 2, { events: [proposal("a")] })], PAIRS, new Map([["sub", 2]]));
    expect(p.strikes.has("sub")).toBe(false);
    expect([...p.strikes.entries()].filter(([, s]) => s.after > s.now).map(([id]) => id)).toEqual(["2a", "2b"]);
  });
});
