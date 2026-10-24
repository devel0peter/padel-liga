import { describe, expect, it } from "vitest";
import { groupProblems, movePair, phaseMatches, seedOrder, validGroupSize } from "./groups";
import { seedGroups } from "./seeding";

interface Pair {
  readonly id: string;
  readonly averageElo: number;
}

const p = (id: string, averageElo: number): Pair => ({ id, averageElo });
const ids = (groups: readonly (readonly Pair[])[]) => groups.map((g) => g.map((x) => x.id));

/** Pairs P1..Pn with strictly falling Elo, so P1 is the strongest. */
function pairsDescending(n: number): Pair[] {
  return Array.from({ length: n }, (_, i) => p(`P${i + 1}`, 2000 - i * 10));
}

describe("validGroupSize (spec 4: groups of 3 or 4)", () => {
  it("accepts 3 and 4 only", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(validGroupSize)).toEqual([false, false, false, true, true, false, false]);
  });
});

describe("groupProblems (#24: a group of 2 or 5 can't be published)", () => {
  it("is empty when every group has 3 or 4 pairs", () => {
    expect(groupProblems([4, 3, 3])).toEqual([]);
    expect(groupProblems([3])).toEqual([]);
  });

  it("names every group that is too small or too big, by index", () => {
    expect(groupProblems([5, 3, 2])).toEqual([0, 2]);
    expect(groupProblems([4, 0, 3])).toEqual([1]);
  });

  it("reports a draft without groups as not publishable", () => {
    expect(groupProblems([])).toEqual([-1]);
  });
});

describe("seedOrder (spec 10: by average Elo, ties by input order)", () => {
  it("sorts strongest first and keeps the input order on ties", () => {
    const sorted = seedOrder([p("A", 1200), p("B", 1400), p("C", 1200), p("D", 1300)]);
    expect(sorted.map((x) => x.id)).toEqual(["B", "D", "A", "C"]);
  });

  it("does not modify its input", () => {
    const input = [p("A", 1), p("B", 2)];
    seedOrder(input);
    expect(input.map((x) => x.id)).toEqual(["A", "B"]);
  });
});

describe("movePair (#24: the organizer adjusts the draft)", () => {
  const draft = () => {
    const r = seedGroups(pairsDescending(10));
    if (!r.ok) throw new Error("expected a split");
    return r.groups;
  };

  it("10 approved pairs give a 4+3+3 draft the organizer can change", () => {
    const groups = draft();
    expect(groups.map((g) => g.length)).toEqual([4, 3, 3]);
    // P4 (weakest of group 1) moves down: 3+4+3, both still publishable.
    const moved = movePair(groups, "P4", 1, (x) => x.id);
    expect(ids(moved)).toEqual([
      ["P1", "P2", "P3"],
      ["P4", "P5", "P6", "P7"],
      ["P8", "P9", "P10"],
    ]);
    expect(groupProblems(moved.map((g) => g.length))).toEqual([]);
  });

  it("re-seeds the target group by Elo, wherever the pair came from", () => {
    // P10 (the weakest) moves to group 1: it is seeded last there.
    const moved = movePair(draft(), "P10", 0, (x) => x.id);
    expect(ids(moved)[0]).toEqual(["P1", "P2", "P3", "P4", "P10"]);
    // A strong pair moved down is seeded first in its new group.
    const down = movePair(draft(), "P1", 2, (x) => x.id);
    expect(ids(down)[2]).toEqual(["P1", "P8", "P9", "P10"]);
  });

  it("allows a move that leaves a group of 2 or 5, which then blocks publishing", () => {
    const moved = movePair(draft(), "P5", 0, (x) => x.id);
    expect(moved.map((g) => g.length)).toEqual([5, 2, 3]);
    expect(groupProblems(moved.map((g) => g.length))).toEqual([0, 1]);
  });

  it("leaves the draft unchanged for a move into the pair's own group", () => {
    const groups = draft();
    expect(ids(movePair(groups, "P2", 0, (x) => x.id))).toEqual(ids(groups));
  });

  it("does not modify the input draft", () => {
    const groups = draft();
    movePair(groups, "P4", 1, (x) => x.id);
    expect(groups.map((g) => g.length)).toEqual([4, 3, 3]);
  });

  it("rejects an unknown pair or a group that doesn't exist", () => {
    expect(() => movePair(draft(), "P99", 1, (x) => x.id)).toThrow(/not in the draft/);
    expect(() => movePair(draft(), "P1", 3, (x) => x.id)).toThrow(/no group/);
    expect(() => movePair(draft(), "P1", -1, (x) => x.id)).toThrow(/no group/);
  });
});

describe("phaseMatches (spec 5: every group's round robin, by week)", () => {
  it("creates every match of a 4+3+3 phase with its group and week", () => {
    const r = seedGroups(pairsDescending(10));
    if (!r.ok) throw new Error("expected a split");
    const matches = phaseMatches(r.groups);
    // 6 matches in the group of 4, 3 in each group of 3.
    expect(matches).toHaveLength(12);
    const of = (group: number) =>
      matches.filter((m) => m.group === group).map((m) => `${m.week}:${m.a.id}-${m.b.id}`);
    expect(of(0)).toEqual(["1:P1-P4", "1:P2-P3", "2:P1-P3", "2:P2-P4", "3:P1-P2", "3:P3-P4"]);
    expect(of(1)).toEqual(["1:P6-P7", "2:P5-P7", "3:P5-P6"]);
    expect(of(2)).toEqual(["1:P9-P10", "2:P8-P10", "3:P8-P9"]);
  });

  it("every pair meets every other pair of its group exactly once", () => {
    const groups = [pairsDescending(4), pairsDescending(3).map((x) => p(`Q${x.id}`, x.averageElo))];
    const matches = phaseMatches(groups);
    for (const [gi, group] of groups.entries())
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++) {
          const meet = matches.filter(
            (m) => m.group === gi && new Set([m.a.id, m.b.id]).size === 2 && [m.a.id, m.b.id].includes(group[i]!.id) && [m.a.id, m.b.id].includes(group[j]!.id),
          );
          expect(meet).toHaveLength(1);
        }
  });

  it("refuses a group that isn't 3 or 4 pairs", () => {
    expect(() => phaseMatches([pairsDescending(2)])).toThrow(/3 or 4/);
    expect(() => phaseMatches([pairsDescending(5)])).toThrow(/3 or 4/);
  });
});
