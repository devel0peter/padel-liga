import { describe, expect, it } from "vitest";
import { groupSizes, seedGroups } from "./seeding";

interface Pair {
  readonly id: string;
  readonly averageElo: number;
}

/** Pairs P1..Pn with strictly falling Elo, so P1 is the strongest. */
function pairsDescending(n: number): Pair[] {
  return Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}`, averageElo: 2000 - i * 10 }));
}

function sizesOf(pairs: readonly Pair[]): number[] {
  const result = seedGroups(pairs);
  if (!result.ok) throw new Error("expected a split");
  return result.groups.map((g) => g.length);
}

describe("groupSizes (spec 4)", () => {
  it("fills with groups of 3 and keeps them at the bottom", () => {
    expect(groupSizes(3)).toEqual([3]);
    expect(groupSizes(4)).toEqual([4]);
    expect(groupSizes(6)).toEqual([3, 3]);
    expect(groupSizes(7)).toEqual([4, 3]);
    expect(groupSizes(8)).toEqual([4, 4]);
    expect(groupSizes(9)).toEqual([3, 3, 3]);
    expect(groupSizes(10)).toEqual([4, 3, 3]);
    expect(groupSizes(11)).toEqual([4, 4, 3]);
    expect(groupSizes(12)).toEqual([4, 4, 4]);
    expect(groupSizes(13)).toEqual([4, 3, 3, 3]);
    expect(groupSizes(14)).toEqual([4, 4, 3, 3]);
    expect(groupSizes(15)).toEqual([4, 4, 4, 3]);
  });

  it("uses as many groups of 4 as possible and sums to the pair count", () => {
    for (let n = 6; n <= 60; n++) {
      const sizes = groupSizes(n);
      expect(sizes).not.toBeNull();
      expect(sizes!.reduce((a, b) => a + b, 0)).toBe(n);
      expect(sizes!.every((s) => s === 3 || s === 4)).toBe(true);
      expect(sizes!.filter((s) => s === 3).length).toBeLessThanOrEqual(3);
      expect(sizes).toEqual([...sizes!].sort((a, b) => b - a));
    }
  });

  it("is null for counts that can't be split: 0, 1, 2 and 5", () => {
    for (const n of [0, 1, 2, 5]) expect(groupSizes(n)).toBeNull();
  });

  it("is null for invalid counts", () => {
    for (const n of [-1, 3.5, Number.NaN]) expect(groupSizes(n)).toBeNull();
  });
});

describe("seedGroups (spec 10, first phase)", () => {
  it("gives the sizes of the spec for 8, 9, 10, 11 and 12 pairs", () => {
    expect(sizesOf(pairsDescending(8))).toEqual([4, 4]);
    expect(sizesOf(pairsDescending(9))).toEqual([3, 3, 3]);
    expect(sizesOf(pairsDescending(10))).toEqual([4, 3, 3]);
    expect(sizesOf(pairsDescending(11))).toEqual([4, 4, 3]);
    expect(sizesOf(pairsDescending(12))).toEqual([4, 4, 4]);
  });

  it("makes exactly 3 and 4 pairs a single group", () => {
    expect(sizesOf(pairsDescending(3))).toEqual([3]);
    expect(sizesOf(pairsDescending(4))).toEqual([4]);
  });

  it("reports 0, 1, 2 and 5 pairs as not splittable", () => {
    for (const n of [0, 1, 2, 5]) {
      expect(seedGroups(pairsDescending(n))).toEqual({
        ok: false,
        reason: "not-splittable",
        pairCount: n,
      });
    }
  });

  it("puts the highest average Elo pairs in group 1, strongest first", () => {
    const shuffled = [3, 7, 0, 5, 1, 6, 2, 4].map((i) => pairsDescending(8)[i]!);
    const result = seedGroups(shuffled);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups[0]!.map((p) => p.id)).toEqual(["P1", "P2", "P3", "P4"]);
    expect(result.groups[1]!.map((p) => p.id)).toEqual(["P5", "P6", "P7", "P8"]);
  });

  it("puts the 3-pair groups at the bottom, holding the weakest pairs", () => {
    const result = seedGroups(pairsDescending(10));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups.map((g) => g.map((p) => p.id))).toEqual([
      ["P1", "P2", "P3", "P4"],
      ["P5", "P6", "P7"],
      ["P8", "P9", "P10"],
    ]);
  });

  it("uses every pair exactly once", () => {
    for (let n = 6; n <= 30; n++) {
      const result = seedGroups(pairsDescending(n));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.groups.flat().map((p) => p.id);
      expect(new Set(ids).size).toBe(n);
    }
  });

  it("keeps the input order for equal average Elo (stable, approval order)", () => {
    const tied: Pair[] = ["A", "B", "C", "D", "E", "F"].map((id) => ({ id, averageElo: 1500 }));
    const result = seedGroups(tied);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups.map((g) => g.map((p) => p.id))).toEqual([
      ["A", "B", "C"],
      ["D", "E", "F"],
    ]);
  });

  it("keeps the input order inside a tie while still sorting the rest (three-way tie)", () => {
    const input: Pair[] = [
      { id: "low", averageElo: 1400 },
      { id: "tie1", averageElo: 1600 },
      { id: "top", averageElo: 1800 },
      { id: "tie2", averageElo: 1600 },
      { id: "tie3", averageElo: 1600 },
      { id: "mid", averageElo: 1500 },
      { id: "tie0", averageElo: 1600 },
      { id: "bottom", averageElo: 1300 },
    ];
    const result = seedGroups(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups.flat().map((p) => p.id)).toEqual([
      "top",
      "tie1",
      "tie2",
      "tie3",
      "tie0",
      "mid",
      "low",
      "bottom",
    ]);
  });

  it("splits a tie across a group border by input order", () => {
    const input: Pair[] = [
      { id: "A", averageElo: 1600 },
      { id: "B", averageElo: 1600 },
      { id: "C", averageElo: 1600 },
      { id: "D", averageElo: 1600 },
      { id: "E", averageElo: 1600 },
      { id: "F", averageElo: 1600 },
      { id: "G", averageElo: 1600 },
      { id: "H", averageElo: 1600 },
    ];
    const result = seedGroups(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups[0]!.map((p) => p.id)).toEqual(["A", "B", "C", "D"]);
    expect(result.groups[1]!.map((p) => p.id)).toEqual(["E", "F", "G", "H"]);
  });

  it("handles negative and fractional average Elo", () => {
    const input: Pair[] = [
      { id: "a", averageElo: 1000.5 },
      { id: "b", averageElo: 1000.75 },
      { id: "c", averageElo: -5 },
    ];
    const result = seedGroups(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups[0]!.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("does not modify its input", () => {
    const input = pairsDescending(9).reverse();
    const snapshot = input.map((p) => p.id);
    seedGroups(input);
    expect(input.map((p) => p.id)).toEqual(snapshot);
  });

  it("rejects a non-finite average Elo instead of guessing", () => {
    const bad: Pair[] = [...pairsDescending(5), { id: "bad", averageElo: Number.NaN }];
    expect(() => seedGroups(bad)).toThrow();
    const inf: Pair[] = [...pairsDescending(5), { id: "inf", averageElo: Infinity }];
    expect(() => seedGroups(inf)).toThrow();
  });
});
