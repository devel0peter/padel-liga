import { describe, expect, it } from "vitest";
import { groupOf4Rounds } from "./fixtures";

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
