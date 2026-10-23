import { describe, expect, it } from "vitest";
import { groupOf3Rounds, groupOf4Rounds, groupRounds } from "./fixtures";

describe("groupOf4Rounds (spec 5)", () => {
  const rounds = groupOf4Rounds(["A", "B", "C", "D"]);

  it("follows the spec order: 1–4 & 2–3, then 1–3 & 2–4, then 1–2 & 3–4", () => {
    expect(rounds).toEqual([
      [["A", "D"], ["B", "C"]],
      [["A", "C"], ["B", "D"]],
      [["A", "B"], ["C", "D"]],
    ]);
  });

  it("has every pair play exactly once per week", () => {
    for (const round of rounds) {
      expect(new Set(round.flat()).size).toBe(4);
    }
  });

  it("has every pair meet every other pair exactly once", () => {
    const keys = rounds.flat().map((p) => [...p].sort().join("-"));
    expect(new Set(keys).size).toBe(6);
  });

  it("rejects groups that are not 4 pairs", () => {
    expect(() => groupOf4Rounds(["A", "B", "C"])).toThrow();
    expect(() => groupOf4Rounds(["A", "B", "C", "D", "E"])).toThrow();
  });
});

describe("groupOf3Rounds (spec 5)", () => {
  const rounds = groupOf3Rounds(["A", "B", "C"]);

  it("follows the spec order: 2–3 (1 rests), 1–3 (2 rests), 1–2 (3 rests)", () => {
    expect(rounds).toEqual([[["B", "C"]], [["A", "C"]], [["A", "B"]]]);
  });

  it("has exactly one match per week", () => {
    expect(rounds).toHaveLength(3);
    for (const round of rounds) expect(round).toHaveLength(1);
  });

  it("has every pair play 2 matches and rest exactly once", () => {
    for (const pair of ["A", "B", "C"]) {
      const played = rounds.filter((round) => round.flat().includes(pair)).length;
      expect(played).toBe(2);
      expect(rounds.filter((round) => !round.flat().includes(pair))).toHaveLength(1);
    }
  });

  it("has the pair resting in week n be the one seeded n", () => {
    rounds.forEach((round, week) => {
      expect(round.flat()).not.toContain(["A", "B", "C"][week]);
    });
  });

  it("has every pair meet every other pair exactly once", () => {
    const keys = rounds.flat().map((p) => [...p].sort().join("-"));
    expect([...keys].sort()).toEqual(["A-B", "A-C", "B-C"]);
  });

  it("uses the given seed order, not the values", () => {
    expect(groupOf3Rounds([30, 20, 10])).toEqual([[[20, 10]], [[30, 10]], [[30, 20]]]);
  });

  it("rejects groups that are not 3 pairs", () => {
    expect(() => groupOf3Rounds([])).toThrow();
    expect(() => groupOf3Rounds(["A", "B"])).toThrow();
    expect(() => groupOf3Rounds(["A", "B", "C", "D"])).toThrow();
  });
});

describe("groupRounds (spec 4 and 5)", () => {
  it("uses the group-of-4 order for 4 pairs", () => {
    const pairs = ["A", "B", "C", "D"];
    expect(groupRounds(pairs)).toEqual(groupOf4Rounds(pairs));
  });

  it("uses the group-of-3 order for 3 pairs", () => {
    const pairs = ["A", "B", "C"];
    expect(groupRounds(pairs)).toEqual(groupOf3Rounds(pairs));
  });

  it("rejects any other group size", () => {
    for (const size of [0, 1, 2, 5, 6]) {
      expect(() => groupRounds(Array.from({ length: size }, (_, i) => i))).toThrow();
    }
  });
});
