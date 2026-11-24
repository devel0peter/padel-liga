import { describe, expect, it } from "vitest";
import {
  bothInactiveSide,
  asSetGames,
  isValidSet,
  isValidSuperTieBreak,
  type MatchScore,
  type ResultErrorKind,
  type Score,
  type SetGames,
  SETS_TO_SIX,
  SHORT_SETS,
  validSetsText,
  validateScore,
  walkoverTotals,
} from "./results";

const kinds = (score: MatchScore, g: SetGames = SHORT_SETS): ResultErrorKind[] => {
  const v = validateScore(score, g);
  return v.ok ? [] : v.errors.map((e) => e.kind);
};

const totals = (score: MatchScore, g: SetGames = SHORT_SETS) => {
  const v = validateScore(score, g);
  if (!v.ok) throw new Error(`expected a valid score, got ${JSON.stringify(v.errors)}`);
  return v.totals;
};

describe("isValidSet (spec 7: short sets to 4, win by 2, tie-break at 4-4)", () => {
  it("accepts 4-0, 4-1, 4-2, 5-3 and 5-4, for either side", () => {
    const valid: Score[] = [[4, 0], [4, 1], [4, 2], [5, 3], [5, 4], [0, 4], [1, 4], [2, 4], [3, 5], [4, 5]];
    expect(valid.filter((s) => !isValidSet(s, SHORT_SETS))).toEqual([]);
  });

  it("rejects unfinished sets and scores the format can't produce", () => {
    const invalid: Score[] = [[4, 3], [3, 4], [6, 4], [4, 6], [5, 2], [2, 5], [5, 5], [4, 4], [3, 0], [0, 0], [6, 0], [6, 5], [7, 5]];
    expect(invalid.filter((s) => isValidSet(s, SHORT_SETS))).toEqual([]);
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
      const v = validateScore({ sets: [[4, 0], bad] }, SHORT_SETS);
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
      const v = validateScore(s, SHORT_SETS);
      return v.ok ? "" : (v.errors[0]?.message ?? "");
    });
    expect(new Set(messages).size).toBe(samples.length);
    expect(messages.every((m) => m.length > 0 && m.length <= 90)).toBe(true);
  });
});

describe("walkovers (spec 8)", () => {
  it("gives the active side 4-0 4-0 in a short-set round", () => {
    expect(walkoverTotals("a", SHORT_SETS)).toEqual({ winner: "a", sets: [2, 0], games: [8, 0] });
    expect(walkoverTotals("b", SHORT_SETS)).toEqual({ winner: "b", sets: [0, 2], games: [0, 8] });
  });

  it("records 0-4 0-4 for each side when neither side was active in a short-set round", () => {
    expect(bothInactiveSide(SHORT_SETS)).toEqual({ setsWon: 0, setsLost: 2, gamesWon: 0, gamesLost: 8 });
  });

  it("gives the active side 6-0 6-0 in a sets-to-6 round (#396)", () => {
    expect(walkoverTotals("a", SETS_TO_SIX)).toEqual({ winner: "a", sets: [2, 0], games: [12, 0] });
    expect(walkoverTotals("b", SETS_TO_SIX)).toEqual({ winner: "b", sets: [0, 2], games: [0, 12] });
  });

  it("records 0-6 0-6 for each side when neither side was active in a sets-to-6 round (#396)", () => {
    expect(bothInactiveSide(SETS_TO_SIX)).toEqual({ setsWon: 0, setsLost: 2, gamesWon: 0, gamesLost: 12 });
  });
});

describe("isValidSet, sets to 6 (D173, #396: to 6 games, win by 2, tie-break at 6-6)", () => {
  it("accepts 6-0, 6-1, 6-2, 6-3, 6-4, 7-5 and 7-6, for either side", () => {
    const valid: Score[] = [[6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [7, 5], [7, 6]];
    const both = [...valid, ...valid.map(([a, b]) => [b, a] as const)];
    expect(both.filter((s) => !isValidSet(s, SETS_TO_SIX))).toEqual([]);
  });

  it("rejects unfinished sets, short-set scores and scores the format can't produce", () => {
    const invalid: Score[] = [
      [6, 5], [5, 6], [6, 6], [7, 4], [4, 7], [7, 7], [8, 6], [7, 3], [5, 0], [0, 0],
      [4, 0], [4, 1], [4, 2], [5, 3], [5, 4], [3, 5], [4, 5],
    ];
    expect(invalid.filter((s) => isValidSet(s, SETS_TO_SIX))).toEqual([]);
  });

  it("short sets keep their own list: no 6-x or 7-x set is a short set", () => {
    const sixes: Score[] = [[6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [7, 5], [7, 6]];
    expect(sixes.filter((s) => isValidSet(s, SHORT_SETS))).toEqual([]);
  });
});

describe("validateScore by the round's format (#396 acceptance)", () => {
  it("a sets-to-6 round accepts 6:4 7:6 and refuses 4:2 4:1 with a Hungarian message naming the valid sets", () => {
    expect(totals({ sets: [[6, 4], [7, 6]] }, SETS_TO_SIX)).toEqual({ winner: "a", sets: [2, 0], games: [13, 10] });
    const v = validateScore({ sets: [[4, 2], [4, 1]] }, SETS_TO_SIX);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.map((e) => e.message)).toEqual([
      "1. szett: 4:2 nem lehet. Lehet 6:0, 6:1, 6:2, 6:3, 6:4, 7:5 vagy (tie-break után) 7:6.",
      "2. szett: 4:1 nem lehet. Lehet 6:0, 6:1, 6:2, 6:3, 6:4, 7:5 vagy (tie-break után) 7:6.",
    ]);
  });

  it("a short-set round (Győr round 1) still accepts 4:2 5:3 and refuses 6:4 6:3", () => {
    expect(totals({ sets: [[4, 2], [5, 3]] }, SHORT_SETS)).toEqual({ winner: "a", sets: [2, 0], games: [9, 5] });
    const v = validateScore({ sets: [[6, 4], [6, 3]] }, SHORT_SETS);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.map((e) => e.message)).toEqual([
      "1. szett: 6:4 nem lehet. Lehet 4:0, 4:1, 4:2, 5:3 vagy (tie-break után) 5:4.",
      "2. szett: 6:3 nem lehet. Lehet 4:0, 4:1, 4:2, 5:3 vagy (tie-break után) 5:4.",
    ]);
  });

  it("sets to 6 keep the rest of the format: 2 won sets, the super tie-break to 10 at 1-1 counts as a set and a 1-0 game", () => {
    expect(totals({ sets: [[6, 3], [4, 6]], superTieBreak: [10, 7] }, SETS_TO_SIX)).toEqual({ winner: "a", sets: [2, 1], games: [11, 9] });
    expect(totals({ sets: [[7, 5], [6, 7]], superTieBreak: [9, 11] }, SETS_TO_SIX)).toEqual({ winner: "b", sets: [1, 2], games: [13, 13] });
    expect(kinds({ sets: [[6, 3], [4, 6]] }, SETS_TO_SIX)).toEqual(["missing-super-tie-break"]);
    expect(kinds({ sets: [[6, 3], [6, 4]], superTieBreak: [10, 8] }, SETS_TO_SIX)).toEqual(["unneeded-super-tie-break"]);
    expect(kinds({ sets: [[6, 3], [4, 6], [6, 2]] }, SETS_TO_SIX)).toEqual(["third-set"]);
    expect(kinds({ sets: [[6, 3], [4, 6]], superTieBreak: [10, 9] }, SETS_TO_SIX)).toEqual(["invalid-super-tie-break"]);
  });

  it("keeps every sets-to-6 message within the length of the short-set ones", () => {
    const v = validateScore({ sets: [[6, 5], [6, 0]] }, SETS_TO_SIX);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]!.message.length).toBeLessThanOrEqual(90);
  });
});

describe("validSetsText and asSetGames", () => {
  it("lists the valid sets of each format in Hungarian", () => {
    expect(validSetsText(SHORT_SETS)).toBe("4:0, 4:1, 4:2, 5:3 vagy (tie-break után) 5:4");
    expect(validSetsText(SETS_TO_SIX)).toBe("6:0, 6:1, 6:2, 6:3, 6:4, 7:5 vagy (tie-break után) 7:6");
  });

  it("reads a stored format back, and nothing else", () => {
    expect(asSetGames(4)).toBe(4);
    expect(asSetGames(6)).toBe(6);
    for (const bad of [0, 5, 7, "6", null, undefined]) expect(asSetGames(bad)).toBeNull();
  });
});
