import { describe, expect, it } from "vitest";
import {
  borderSwaps,
  DEFAULT_FAST_SWITCHES,
  entryGroup,
  isFastSwitch,
  placeNewPairs,
  promoteAndRelegate,
  recut,
  roundSwitchDraft,
  switchSizes,
  targetGroup,
} from "./promotion";
import { groupStandings, type GroupMatch } from "./standings";

interface Pair {
  readonly id: string;
  readonly averageElo: number;
}

const p = (id: string, averageElo = 1200): Pair => ({ id, averageElo });
const ids = (groups: readonly (readonly { id: string }[])[]) => groups.map((g) => g.map((x) => x.id));
/** Tables of pairs named by group and place: G1P1 is group 1's winner. Elo falls down the ladder. */
function tables(...sizes: number[]): Pair[][] {
  let elo = 2000;
  return sizes.map((n, g) => Array.from({ length: n }, (_, i) => p(`G${g + 1}P${i + 1}`, (elo -= 10))));
}
const none = () => false;

describe("isFastSwitch (spec 10: fast calibration after the first phase of the league's first season)", () => {
  it("is the first switch of the first season by default", () => {
    expect(DEFAULT_FAST_SWITCHES).toBe(1);
    expect(isFastSwitch({ firstSeason: true, endingPhase: 1, fastSwitches: DEFAULT_FAST_SWITCHES })).toBe(true);
    expect(isFastSwitch({ firstSeason: true, endingPhase: 2, fastSwitches: DEFAULT_FAST_SWITCHES })).toBe(false);
  });

  it("never in a later season", () => {
    expect(isFastSwitch({ firstSeason: false, endingPhase: 1, fastSwitches: DEFAULT_FAST_SWITCHES })).toBe(false);
  });

  it("follows the league setting: 2 fast switches, or none", () => {
    expect([1, 2, 3].map((endingPhase) => isFastSwitch({ firstSeason: true, endingPhase, fastSwitches: 2 }))).toEqual([true, true, false]);
    expect(isFastSwitch({ firstSeason: true, endingPhase: 1, fastSwitches: 0 })).toBe(false);
  });
});

describe("borderSwaps (spec 10)", () => {
  it("is 1 at a normal switch", () => {
    expect(borderSwaps(4, 4, false)).toBe(1);
    expect(borderSwaps(3, 3, false)).toBe(1);
  });

  it("is 2 at a fast switch between two groups of 4, 1 when either has 3", () => {
    expect(borderSwaps(4, 4, true)).toBe(2);
    expect(borderSwaps(4, 3, true)).toBe(1);
    expect(borderSwaps(3, 4, true)).toBe(1);
  });
});

describe("promoteAndRelegate (spec 10: 1st up, last down)", () => {
  it("moves the right pairs in a 3-group league; the top winner and the bottom last stay", () => {
    expect(ids(promoteAndRelegate(tables(4, 4, 4), false))).toEqual([
      ["G1P1", "G1P2", "G1P3", "G2P1"],
      ["G1P4", "G2P2", "G2P3", "G3P1"],
      ["G2P4", "G3P2", "G3P3", "G3P4"],
    ]);
  });

  it("relegates the 3rd of a group of 3", () => {
    expect(ids(promoteAndRelegate(tables(4, 3, 3), false))).toEqual([
      ["G1P1", "G1P2", "G1P3", "G2P1"],
      ["G1P4", "G2P2", "G3P1"],
      ["G2P3", "G3P2", "G3P3"],
    ]);
  });

  it("leaves a single group as it is", () => {
    expect(ids(promoteAndRelegate(tables(4), true))).toEqual([["G1P1", "G1P2", "G1P3", "G1P4"]]);
  });

  it("swaps 2 at every border of groups of 4 at a fast switch: the middle group's 1st and 2nd up, 3rd and 4th down", () => {
    expect(ids(promoteAndRelegate(tables(4, 4, 4), true))).toEqual([
      ["G1P1", "G1P2", "G2P1", "G2P2"],
      ["G1P3", "G1P4", "G3P1", "G3P2"],
      ["G2P3", "G2P4", "G3P3", "G3P4"],
    ]);
  });

  it("swaps only 1 at a fast switch where a group of 3 borders", () => {
    expect(ids(promoteAndRelegate(tables(4, 4, 3), true))).toEqual([
      ["G1P1", "G1P2", "G2P1", "G2P2"],
      ["G1P3", "G1P4", "G2P3", "G3P1"],
      ["G2P4", "G3P2", "G3P3"],
    ]);
  });

  it("counts a group by its table: a pair withdrawn mid-phase leaves a table of 3, so 1 swaps and the table's last goes down", () => {
    // Group 2 had 4 pairs; one withdrew and is out of the table (rules 2).
    expect(ids(promoteAndRelegate(tables(4, 3, 4), true))).toEqual([
      ["G1P1", "G1P2", "G1P3", "G2P1"],
      ["G1P4", "G2P2", "G3P1"],
      ["G2P3", "G3P2", "G3P3", "G3P4"],
    ]);
  });

  it("sends a lone pair up, never both ways", () => {
    expect(ids(promoteAndRelegate(tables(4, 1, 4), false))).toEqual([
      ["G1P1", "G1P2", "G1P3", "G2P1"],
      ["G1P4", "G3P1"],
      ["G3P2", "G3P3", "G3P4"],
    ]);
  });

  it("takes the order from the table, so a three-way tie resolved by groupStandings decides who goes up", () => {
    // A, B and C beat each other in a circle with the same score: set and game
    // difference are equal, the average Elo decides (spec 9), C first.
    const score = { sets: [[4, 2], [4, 2]] as const };
    const matches: GroupMatch[] = [
      { a: "A", b: "B", outcome: { kind: "played", score } },
      { a: "B", b: "C", outcome: { kind: "played", score } },
      { a: "C", b: "A", outcome: { kind: "played", score } },
    ];
    const elo: Record<string, number> = { A: 1100, B: 1200, C: 1300 };
    const table = groupStandings(
      ["A", "B", "C"].map((id) => ({ id, elo: elo[id]! })),
      matches,
    ).map((r) => p(r.id, r.elo));
    const above = [p("X1"), p("X2"), p("X3")];
    expect(ids(promoteAndRelegate([above, table], false))).toEqual([["X1", "X2", "C"], ["X3", "B", "A"]]);
  });
});

describe("recut (spec 8 and 10: leavers go after promotion and relegation, pairs below move up)", () => {
  it("fills a hole top-down and keeps groups of 4 above groups of 3", () => {
    const moved = promoteAndRelegate(tables(4, 4, 4), false);
    // Group 1's 2nd leaves (3rd strike).
    expect(ids(recut(moved, (x) => x.id === "G1P2"))).toEqual([
      ["G1P1", "G1P3", "G2P1", "G1P4"],
      ["G2P2", "G2P3", "G3P1", "G2P4"],
      ["G3P2", "G3P3", "G3P4"],
    ]);
  });

  it("drops a group when enough pairs leave", () => {
    const moved = promoteAndRelegate(tables(4, 4, 3), false);
    const gone = new Set(["G1P1", "G2P2", "G3P3"]);
    expect(ids(recut(moved, (x) => gone.has(x.id))).map((g) => g.length)).toEqual([4, 4]);
  });

  it("keeps a count that can't be split as groups of 4 and a short last group, for the organizer", () => {
    expect(switchSizes(5)).toEqual([4, 1]);
    expect(switchSizes(2)).toEqual([2]);
    expect(switchSizes(0)).toEqual([]);
    expect(switchSizes(10)).toEqual([4, 3, 3]);
  });
});

/** A ladder of full groups: group g (1-based) holds G<g>P1..P4, Elo 1800 - 100g down by 1 a place, so averages fall by 100 a group. */
function ladder(...sizes: number[]): Pair[][] {
  return sizes.map((n, g) => Array.from({ length: n }, (_, i) => p(`G${g + 1}P${i + 1}`, 1700 - 100 * g - i)));
}

describe("targetGroup (spec 10: by rating, never the top group)", () => {
  const groups = ladder(4, 4, 4); // averages 1698.5, 1598.5, 1498.5

  it("never picks the top group, however high the rating", () => {
    expect(targetGroup(groups, 2000)).toBe(1);
  });

  it("picks the highest group whose average is at most the rating, with no discount", () => {
    expect(targetGroup(groups, 1598.5)).toBe(1);
    expect(targetGroup(groups, 1598)).toBe(2);
  });

  it("picks the bottom group when no average is low enough, the one group of a single-group league", () => {
    expect(targetGroup(groups, 900)).toBe(2);
    expect(targetGroup([groups[0]!], 900)).toBe(0);
  });

  it("skips a planned group with no pairs yet, but falls back to the planned bottom", () => {
    expect(targetGroup([...groups, []], 1500)).toBe(2);
    expect(targetGroup([...groups, []], 900)).toBe(3);
  });
});

describe("entryGroup (spec 10: the bottom group of the target's division)", () => {
  it("is the target's division's bottom group (6 groups: 2 + 2 + 2; 7 groups: 2 + 3 + 2)", () => {
    expect([0, 1, 2, 3, 4, 5].map((t) => entryGroup(t, 6))).toEqual([1, 1, 3, 3, 5, 5]);
    expect([1, 2, 3, 4, 5, 6].map((t) => entryGroup(t, 7))).toEqual([1, 4, 4, 4, 6, 6]);
  });

  it("is the target itself with one group per division, or one or two groups", () => {
    expect([1, 2].map((t) => entryGroup(t, 3))).toEqual([1, 2]);
    expect(entryGroup(0, 1)).toBe(0);
    expect(entryGroup(1, 2)).toBe(1);
  });
});

describe("placeNewPairs (spec 10, D107f: at the bottom of the division)", () => {
  it("plans 21 pairs as 4+4+4+3+3+3 and puts a strong new pair at the bottom of its target's division, pushing down from there", () => {
    // 5 full groups and a new pair rated 1550: target group 3 (average 1498.5),
    // Réz = groups 3 and 4 of the 6 planned, so it enters group 4.
    const out = placeNewPairs(ladder(4, 4, 4, 4, 4), [p("New", 1550)]);
    expect(out.map((g) => g.length)).toEqual([4, 4, 4, 3, 3, 3]);
    expect(ids(out).slice(0, 3)).toEqual(ids(ladder(4, 4, 4)));
    expect(ids(out)[3]).toEqual(["G4P1", "G4P2", "New"]);
    // Each group over its planned size passes its lowest-Elo pairs down.
    expect(ids(out)[4]).toEqual(["G5P1", "G4P4", "G4P3"]);
    expect(ids(out)[5]).toEqual(["G5P4", "G5P3", "G5P2"]);
  });

  it("takes the nearest real free spot at or below the entry group", () => {
    // A group of 3 at the bottom: 23 + 1 plan six groups of 4.
    const out = placeNewPairs(ladder(4, 4, 4, 4, 4, 3), [p("New", 1550)]);
    expect(out.map((g) => g.length)).toEqual([4, 4, 4, 4, 4, 4]);
    expect(ids(out)[5]).toEqual(["G6P1", "G6P2", "G6P3", "New"]);
    expect(ids(out).slice(0, 5)).toEqual(ids(ladder(4, 4, 4, 4, 4)));
  });

  it("fills a spot above the entry group from below, so the 3s stay at the bottom", () => {
    // 21 continuing (4+4+4+3+3+3) and a weak pair: the plan for 22 is
    // 4+4+4+4+3+3, the pair enters the bottom group, the best pairs below
    // group 4 move up.
    const out = placeNewPairs(ladder(4, 4, 4, 3, 3, 3), [p("Weak", 900)]);
    expect(out.map((g) => g.length)).toEqual([4, 4, 4, 4, 3, 3]);
    expect(ids(out)[3]).toEqual(["G4P1", "G4P2", "G4P3", "G5P1"]);
    expect(ids(out)[5]).toContain("Weak");
  });

  it("never pulls the new pair up out of its entry group: 13 continuing + 1 rated 1450 stays in Rookie", () => {
    // 4+3+3+3 plan 4+4+3+3 for 14: Bronz 1, Réz 2–3, Rookie 4. Target and
    // entry: group 4. The holes in groups 2 and 3 take continuing pairs.
    const out = placeNewPairs(ladder(4, 3, 3, 3), [p("New", 1450)]);
    expect(out.map((g) => g.length)).toEqual([4, 4, 3, 3]);
    expect(ids(out)[1]).toEqual(["G2P1", "G2P2", "G2P3", "G3P1"]);
    expect(ids(out)[2]).toEqual(["G3P2", "G3P3", "G4P1"]);
    expect(ids(out)[3]).toEqual(["G4P2", "G4P3", "New"]);
  });

  it("keeps a pair rated 1350 in its entry group, the bottom of Rookie, with 21 continuing", () => {
    // 4+4+4+3+3+3 plan 4+4+4+4+3+3 for 22: target group 5, Rookie = 5–6, entry 6.
    const out = placeNewPairs(ladder(4, 4, 4, 3, 3, 3), [p("New", 1350)]);
    expect(out.map((g) => g.length)).toEqual([4, 4, 4, 4, 3, 3]);
    expect(ids(out)[4]).toEqual(["G5P2", "G5P3", "G6P1"]);
    expect(ids(out)[5]).toEqual(["G6P2", "G6P3", "New"]);
  });

  it("places two new pairs each in its own division's bottom, neither pulled up", () => {
    const out = placeNewPairs(ladder(4, 3, 3, 3), [p("A", 1460), p("B", 1450)]);
    // 15: 4+4+4+3; Bronz 1, Réz 2–3, Rookie 4. Both target group 4 (1399).
    expect(out.map((g) => g.length)).toEqual([4, 4, 4, 3]);
    expect(ids(out)[3]).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("moves the best new pair up only when continuing pairs can't fill the groups above (Peter, D107f): 9 + 4 weak", () => {
    // 13 plan 4+3+3+3 (Bronz 1, Réz 2–3, Rookie 4); every new pair's entry is
    // group 4, but 9 continuing pairs can't fill 4+3+3: N1 fills group 3.
    const weak = [1000, 990, 980, 970].map((elo, i) => p(`N${i + 1}`, elo));
    const out = placeNewPairs(ladder(3, 3, 3), weak);
    expect(out.map((g) => g.length)).toEqual([4, 3, 3, 3]);
    expect(ids(out)[2]).toEqual(["G3P2", "G3P3", "N1"]);
    expect(ids(out)[3]).toEqual(["N2", "N3", "N4"]);
  });

  it("moves new pairs up across a division border when they must: 6 continuing (3+3) + 6 new give 4+4+4, two new pairs in Réz", () => {
    const weak = [1000, 990, 980, 970, 960, 950].map((elo, i) => p(`N${i + 1}`, elo));
    const out = placeNewPairs(ladder(3, 3), weak);
    expect(out.map((g) => g.length)).toEqual([4, 4, 4]);
    expect(ids(out)[0]!.some((id) => id.startsWith("N"))).toBe(false);
    expect(ids(out)[1]).toEqual(expect.arrayContaining(["N1", "N2"]));
    expect(ids(out)[2]).toEqual(["N3", "N4", "N5", "N6"]);
  });

  it("adds 2 new pairs to 8 as 4+3+3: the stronger first, each at the bottom of its division", () => {
    const out = placeNewPairs(ladder(4, 4), [p("Low", 1000), p("High", 1650)]);
    expect(out.map((g) => g.length)).toEqual([4, 3, 3]);
    expect(ids(out)[0]).toEqual(["G1P1", "G1P2", "G1P3", "G1P4"]);
    // High: target group 2 (average 1598.5), Réz = group 2 alone; Low: the bottom.
    expect(ids(out)[1]).toEqual(["G2P1", "G2P2", "High"]);
    expect(ids(out)[2]).toEqual(["G2P4", "G2P3", "Low"]);
  });

  it("places one by one, highest rating first, ties in entry order", () => {
    const out = placeNewPairs([], [p("N1", 1100), p("N2", 1300), p("N3", 1100)]);
    expect(ids(out)).toEqual([["N2", "N1", "N3"]]);
  });

  it("changes nothing without new pairs", () => {
    const groups = ladder(4, 3);
    expect(placeNewPairs(groups, [])).toEqual(groups);
  });
});

describe("roundSwitchDraft (spec 10)", () => {
  it("adds 2 new pairs to 8 as 4+3+3", () => {
    const draft = roundSwitchDraft({
      tables: tables(4, 4), // G1 1990..1960, G2 1950..1920
      fast: false,
      leaves: none,
      newPairs: [p("Low", 1000), p("High", 1955)],
    });
    expect(draft.map((g) => g.length)).toEqual([4, 3, 3]);
    // High: target group 2, Réz = group 2: it enters there and the two
    // lowest move down; Low takes the bottom group's free spot.
    expect(ids(draft)).toEqual([
      ["G1P1", "G1P2", "G1P3", "G2P1"],
      ["G1P4", "High", "G2P2"],
      ["G2P3", "G2P4", "Low"],
    ]);
  });

  it("removes a strike leaver after promotion: the promoted pair that leaves opens a spot the pair below fills", () => {
    const draft = roundSwitchDraft({ tables: tables(4, 4, 4), fast: false, leaves: (x) => x.id === "G2P1", newPairs: [] });
    expect(ids(draft)).toEqual([
      ["G1P1", "G1P2", "G1P3", "G1P4"],
      ["G2P2", "G2P3", "G2P4", "G3P1"],
      ["G3P2", "G3P3", "G3P4"],
    ]);
  });

  it("seeds each group by average Elo, strongest first", () => {
    const t = [
      [p("A", 1300), p("B", 1500), p("C", 1400)],
      [p("D", 1450), p("E", 1100), p("F", 1000)],
    ];
    expect(ids(roundSwitchDraft({ tables: t, fast: false, leaves: none, newPairs: [] }))).toEqual([
      ["B", "D", "A"],
      ["C", "E", "F"],
    ]);
  });

  it("drafts only new pairs when nobody continues", () => {
    const draft = roundSwitchDraft({
      tables: [],
      fast: false,
      leaves: none,
      newPairs: [1, 2, 3].map((i) => p(`N${i}`, 1000 + i)),
    });
    expect(ids(draft)).toEqual([["N3", "N2", "N1"]]);
  });
});
