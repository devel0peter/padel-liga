import { describe, expect, it } from "vitest";
import {
  BOTH_INACTIVE_SIDE,
  isValidSet,
  isValidSuperTieBreak,
  type MatchScore,
  type ResultErrorKind,
  type Score,
  validateScore,
  walkoverTotals,
} from "./results";

const kinds = (score: MatchScore): ResultErrorKind[] => {
  const v = validateScore(score);
  return v.ok ? [] : v.errors.map((e) => e.kind);
};

const totals = (score: MatchScore) => {
  const v = validateScore(score);
  if (!v.ok) throw new Error(`expected a valid score, got ${JSON.stringify(v.errors)}`);
  return v.totals;
};

describe("isValidSet (spec 7: short sets to 4, win by 2, tie-break at 4-4)", () => {
  it("accepts 4-0, 4-1, 4-2, 5-3 and 5-4, for either side", () => {
    const valid: Score[] = [[4, 0], [4, 1], [4, 2], [5, 3], [5, 4], [0, 4], [1, 4], [2, 4], [3, 5], [4, 5]];
    expect(valid.filter((s) => !isValidSet(s))).toEqual([]);
  });

  it("rejects unfinished sets and scores the format can't produce", () => {
    const invalid: Score[] = [[4, 3], [3, 4], [6, 4], [4, 6], [5, 2], [2, 5], [5, 5], [4, 4], [3, 0], [0, 0], [6, 0], [6, 5], [7, 5]];
    expect(invalid.filter((s) => isValidSet(s))).toEqual([]);
  });
});

describe("isValidSuperTieBreak (spec 7: to 10, win by 2)", () => {
  it("accepts 10 with a 2-point lead, and win-by-2 beyond 10", () => {
    const valid: Score[] = [[10, 0], [10, 8], [8, 10], [11, 9], [12, 10], [10, 12], [15, 13]];
    expect(valid.filter((s) => !isValidSuperTieBreak(s))).toEqual([]);
  });

  it("rejects 10-9, 9-7, a lead other than 2 beyond 10, and unfinished ones", () => {
    const invalid: Score[] = [[10, 9], [9, 10], [9, 7], [11, 8], [12, 9], [13, 10], [11, 10], [10, 10], [0, 0]];
    expect(invalid.filter((s) => isValidSuperTieBreak(s))).toEqual([]);
  });
});

describe("validateScore: valid results and their counts (spec 7)", () => {
  it("counts a 2-0 win: 4-0 4-2", () => {
    expect(totals({ sets: [[4, 0], [4, 2]] })).toEqual({ winner: "a", sets: [2, 0], games: [8, 2] });
  });

  it("counts a 2-0 win with a tie-break set: 5-4 4-1 for side b", () => {
    expect(totals({ sets: [[4, 5], [1, 4]] })).toEqual({ winner: "b", sets: [0, 2], games: [5, 9] });
  });

  it("counts a 5-3 set (4-3, then a 2-game lead)", () => {
    expect(totals({ sets: [[5, 3], [4, 1]] })).toEqual({ winner: "a", sets: [2, 0], games: [9, 4] });
  });

  it("counts the super tie-break as one set and a 1-0 game: 4-2 2-4 10-8 gives 2-1 and 7-6", () => {
    expect(totals({ sets: [[4, 2], [2, 4]], superTieBreak: [10, 8] })).toEqual({ winner: "a", sets: [2, 1], games: [7, 6] });
  });

  it("gives the match to the super tie-break winner, whoever won the first set", () => {
    expect(totals({ sets: [[4, 2], [2, 4]], superTieBreak: [9, 11] })).toEqual({ winner: "b", sets: [1, 2], games: [6, 7] });
    expect(totals({ sets: [[5, 4], [0, 4]], superTieBreak: [12, 10] })).toEqual({ winner: "a", sets: [2, 1], games: [6, 8] });
  });
});

describe("validateScore: invalid results, each with its own Hungarian message (spec 7)", () => {
  it("rejects an impossible set score, naming the set", () => {
    for (const bad of [[4, 3], [5, 2], [6, 4]] as Score[]) {
      const v = validateScore({ sets: [[4, 0], bad] });
      expect(v.ok).toBe(false);
      if (v.ok) continue;
      expect(v.errors).toEqual([expect.objectContaining({ kind: "invalid-set", set: 2 })]);
      expect(v.errors[0]?.message).toContain("2. szett");
      expect(v.errors[0]?.message).toContain(`${bad[0]}:${bad[1]}`);
    }
  });

  it("reports both sets when both are wrong", () => {
    expect(kinds({ sets: [[4, 3], [6, 4]] })).toEqual(["invalid-set", "invalid-set"]);
  });

  it("rejects a missing set", () => {
    expect(kinds({ sets: [[4, 0]] })).toEqual(["missing-set"]);
    expect(kinds({ sets: [] })).toEqual(["missing-set"]);
  });

  it("rejects a third set, even at 1-1 (the super tie-break replaces it)", () => {
    expect(kinds({ sets: [[4, 0], [4, 1], [4, 2]] })).toEqual(["third-set"]);
    expect(kinds({ sets: [[4, 2], [2, 4], [4, 1]] })).toEqual(["third-set"]);
  });

  it("rejects a super tie-break at 2-0 in sets", () => {
    expect(kinds({ sets: [[4, 0], [4, 1]], superTieBreak: [10, 8] })).toEqual(["unneeded-super-tie-break"]);
  });

  it("requires the super tie-break at 1-1 in sets", () => {
    expect(kinds({ sets: [[4, 2], [2, 4]] })).toEqual(["missing-super-tie-break"]);
  });

  it("rejects a super tie-break of 10-9 or 9-7", () => {
    expect(kinds({ sets: [[4, 2], [2, 4]], superTieBreak: [10, 9] })).toEqual(["invalid-super-tie-break"]);
    expect(kinds({ sets: [[4, 2], [2, 4]], superTieBreak: [9, 7] })).toEqual(["invalid-super-tie-break"]);
  });

  it("rejects negative, fractional and non-numeric games or points", () => {
    expect(kinds({ sets: [[4, -1], [4, 0]] })).toEqual(["not-a-number"]);
    expect(kinds({ sets: [[4, 0], [4, 1.5]] })).toEqual(["not-a-number"]);
    expect(kinds({ sets: [[4, 0], [Number.NaN, 4]] })).toEqual(["not-a-number"]);
    expect(kinds({ sets: [[4, 2], [2, 4]], superTieBreak: [10, -2] })).toEqual(["not-a-number"]);
  });

  it("gives every kind of problem a different message", () => {
    const samples: MatchScore[] = [
      { sets: [[4, -1], [4, 0]] },
      { sets: [[4, 0]] },
      { sets: [[4, 0], [4, 1], [4, 2]] },
      { sets: [[4, 3], [4, 0]] },
      { sets: [[4, 2], [2, 4]] },
      { sets: [[4, 0], [4, 1]], superTieBreak: [10, 8] },
      { sets: [[4, 2], [2, 4]], superTieBreak: [10, 9] },
    ];
    const messages = samples.map((s) => {
      const v = validateScore(s);
      return v.ok ? "" : (v.errors[0]?.message ?? "");
    });
    expect(new Set(messages).size).toBe(samples.length);
    expect(messages.every((m) => m.length > 0 && m.length <= 90)).toBe(true);
  });
});

describe("walkovers (spec 8)", () => {
  it("gives the active side 4-0 4-0", () => {
    expect(walkoverTotals("a")).toEqual({ winner: "a", sets: [2, 0], games: [8, 0] });
    expect(walkoverTotals("b")).toEqual({ winner: "b", sets: [0, 2], games: [0, 8] });
  });

  it("records 0-4 0-4 for each side when neither side was active", () => {
    expect(BOTH_INACTIVE_SIDE).toEqual({ setsWon: 0, setsLost: 2, gamesWon: 0, gamesLost: 8 });
  });
});
