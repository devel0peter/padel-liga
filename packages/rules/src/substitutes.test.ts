import { describe, expect, it } from "vitest";

import { matchEloChanges, replayElo, type EloState } from "./elo";
import { absenceClosesAt, absenceOpen, markRefusal, resultAbsences, unmarkRefusal, type AbsenceCheck } from "./substitutes";

const deadline = new Date("2026-11-29T22:59:00Z");
const slot = new Date("2026-11-18T18:00:00Z");

describe("when an absence can be marked before the match (spec 4, #400)", () => {
  it("closes at the agreed start, or at the deadline without one", () => {
    expect(absenceClosesAt({ scheduledAt: slot, deadline })).toEqual(slot);
    expect(absenceClosesAt({ scheduledAt: null, deadline })).toEqual(deadline);
  });

  it("is open only before the start, without a result, on a match that counts", () => {
    const before = new Date(slot.getTime() - 1000);
    expect(absenceOpen({ closesAt: slot, hasResult: false, voided: false }, before)).toBe(true);
    expect(absenceOpen({ closesAt: slot, hasResult: false, voided: false }, slot)).toBe(false);
    expect(absenceOpen({ closesAt: slot, hasResult: true, voided: false }, before)).toBe(false);
    expect(absenceOpen({ closesAt: slot, hasResult: false, voided: true }, before)).toBe(false);
  });
});

const base: AbsenceCheck = { open: true, pair: ["a1", "a2"], absentId: "a2", marked: [] };

describe("marking a player of the own pair as not playing (#400)", () => {
  it("lets a player of the pair mark their partner, or themself", () => {
    expect(markRefusal(base)).toBeNull();
    expect(markRefusal({ ...base, absentId: "a1" })).toBeNull();
  });

  it("lets both players of a pair be marked", () => {
    expect(markRefusal({ ...base, absentId: "a1", marked: ["a2"] })).toBeNull();
  });

  it("refuses once the match started or has a result", () => {
    expect(markRefusal({ ...base, open: false })).toBe("closed");
  });

  it("refuses a player of the other pair", () => {
    expect(markRefusal({ ...base, absentId: "b1" })).toBe("not_own");
  });

  it("refuses marking the same player twice", () => {
    expect(markRefusal({ ...base, marked: ["a2"] })).toBe("already");
  });

  it("takes a mark back only before the start, only one of the own pair's, only if marked", () => {
    expect(unmarkRefusal({ ...base, marked: ["a2"] })).toBeNull();
    expect(unmarkRefusal({ ...base, marked: ["a2"], open: false })).toBe("closed");
    expect(unmarkRefusal({ ...base, absentId: "b1", marked: ["b1"] })).toBe("not_own");
    expect(unmarkRefusal(base)).toBe("not_marked");
  });
});

describe("the result form's marks (#400: after a sudden injury)", () => {
  const pair = ["a1", "a2"];

  it("adds a player ticked after the match", () => {
    expect(resultAbsences(pair, [], ["a2"])).toEqual({ add: ["a2"], remove: [] });
  });

  it("keeps a mark from before the match that is still ticked, and drops one no longer ticked", () => {
    expect(resultAbsences(pair, ["a2"], ["a2"])).toEqual({ add: [], remove: [] });
    expect(resultAbsences(pair, ["a2"], [])).toEqual({ add: [], remove: ["a2"] });
    expect(resultAbsences(pair, ["a2"], ["a1"])).toEqual({ add: ["a1"], remove: ["a2"] });
  });

  it("ignores the other pair's players, ticked or marked", () => {
    expect(resultAbsences(pair, ["b1"], ["b2", "a1"])).toEqual({ add: ["a1"], remove: [] });
  });
});

describe("Élő-pont with a temporary substitute (spec 11, #400)", () => {
  const start: Record<string, number> = { a1: 1200, a2: 1300, b1: 1200, b2: 1200 };
  const state = (id: string): EloState => ({ rating: start[id]!, matches: 0 });

  it("leaves the absent player's rating and match count alone; the other three change as usual", () => {
    const { players, changes } = replayElo((id) => start[id]!, [{ id: 1, a: ["a1", "a2"], b: ["b1", "b2"], winner: "a", absent: ["a2"] }]);
    expect(changes.map((c) => c.playerId)).toEqual(["a1", "b1", "b2"]);
    expect(players.has("a2")).toBe(false);
    expect(players.get("a1")!.rating).toBeGreaterThan(1200);
    expect(players.get("b1")!.rating).toBeLessThan(1200);
  });

  it("rates the side with the absent player's Élő-pont standing in for the substitute", () => {
    const withAbsent = matchEloChanges({ id: 1, a: ["a1", "a2"], b: ["b1", "b2"], winner: "a", absent: ["a2"] }, state);
    const everyone = matchEloChanges({ id: 1, a: ["a1", "a2"], b: ["b1", "b2"], winner: "a" }, state);
    // The same deltas for whoever is rated.
    expect(withAbsent.map((c) => c.delta)).toEqual(everyone.filter((c) => c.playerId !== "a2").map((c) => c.delta));
  });

  it("keeps the absent player's later matches as if this one wasn't theirs (K, count)", () => {
    const { players } = replayElo((id) => start[id]!, [
      { id: 1, a: ["a1", "a2"], b: ["b1", "b2"], winner: "a", absent: ["a2"] },
      { id: 2, a: ["a1", "a2"], b: ["b1", "b2"], winner: "b" },
    ]);
    expect(players.get("a2")!.matches).toBe(1);
    expect(players.get("a1")!.matches).toBe(2);
  });

  it("leaves both players of a side alone when both were absent", () => {
    const { changes } = replayElo((id) => start[id]!, [{ id: 1, a: ["a1", "a2"], b: ["b1", "b2"], winner: "b", absent: ["a1", "a2"] }]);
    expect(changes.map((c) => c.playerId)).toEqual(["b1", "b2"]);
  });
});
