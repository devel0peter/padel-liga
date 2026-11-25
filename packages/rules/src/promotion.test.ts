import { describe, expect, it } from "vitest";
import {
  borderSwaps,
  DEFAULT_FAST_SWITCHES,
  entryGroup,
  isFastSwitch,
  changeAtSwitch,
  changeLeaveReason,
  keepSpots,
  leaveReason,
  optedOutAfter,
  placeNewPairs,
  promoteAndRelegate,
  recut,
  roundSwitchDraft,
  switchSizes,
  targetGroup,
} from "./promotion";
import { SHORT_SETS } from "./results";
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
      SHORT_SETS,
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

describe("default in and opting out (#395: opted-out pairs leave as \"Nem folytatja\", pairs below move up)", () => {
  const stays = { strikes: false, optedOut: false, active: true, entered: true };

  it("keeps every pair that does nothing: default in", () => {
    expect(leaveReason(stays)).toBeNull();
    const draft = roundSwitchDraft({ tables: tables(4, 4, 4), fast: false, leaves: () => leaveReason(stays) !== null, newPairs: [] });
    expect(draft.flat()).toHaveLength(12);
  });

  it("names an opted-out pair's reason, after a 3rd strike and before a dissolved pair or a taken-out entry", () => {
    expect(leaveReason({ ...stays, optedOut: true })).toBe("opted_out");
    expect(leaveReason({ ...stays, optedOut: true, strikes: true })).toBe("strikes");
    // Opted out, then dissolved after the deadline to form new pairs.
    expect(leaveReason({ ...stays, optedOut: true, active: false })).toBe("opted_out");
    expect(leaveReason({ ...stays, optedOut: true, entered: false })).toBe("opted_out");
    expect(leaveReason({ ...stays, active: false })).toBe("dissolved");
    expect(leaveReason({ ...stays, entered: false })).toBe("taken_out");
  });

  it("ends the season after the phase the pair opted out in, not before", () => {
    expect(optedOutAfter(null, 1)).toBe(false);
    expect(optedOutAfter(1, 1)).toBe(true);
    expect(optedOutAfter(2, 1)).toBe(false);
    expect(optedOutAfter(1, 2)).toBe(true);
  });

  it("leaves out two pairs of one group that opt out, and the pairs below move up: 12 become 4+3+3", () => {
    const out = new Set(["G2P2", "G2P3"]);
    const draft = roundSwitchDraft({ tables: tables(4, 4, 4), fast: false, leaves: (x) => out.has(x.id), newPairs: [] });
    expect(ids(draft)).toEqual([
      ["G1P1", "G1P2", "G1P3", "G2P1"],
      ["G1P4", "G2P4", "G3P1"],
      ["G3P2", "G3P3", "G3P4"],
    ]);
  });

  it("leaves out a group's winner and last that opt out, after promotion: the relegated pair stays up in the hole", () => {
    const out = new Set(["G2P1", "G2P4"]);
    const draft = roundSwitchDraft({ tables: tables(4, 4, 4), fast: false, leaves: (x) => out.has(x.id), newPairs: [] });
    expect(ids(draft)).toEqual([
      ["G1P1", "G1P2", "G1P3", "G1P4"],
      ["G2P2", "G2P3", "G3P1"],
      ["G3P2", "G3P3", "G3P4"],
    ]);
  });

  it("places the staying partner's new pair by the new-pair rules, not into the old pair's spot (D107f)", () => {
    const draft = roundSwitchDraft({
      tables: tables(4, 4),
      fast: false,
      leaves: (x) => x.id === "G1P2",
      newPairs: [p("New", 1985)],
    });
    expect(ids(draft)).toEqual([
      ["G1P1", "G1P3", "G1P4", "G2P1"],
      ["New", "G2P2", "G2P3", "G2P4"],
    ]);
  });
});

describe("keepSpots and roundSwitchDraft with permanent partner changes (#403, spec 10, D179)", () => {
  // The new pair of G<g>P<n>: the staying player with a new partner.
  const changed = (old: Pair, averageElo = old.averageElo): Pair => p(`${old.id}+new`, averageElo);
  const at = (draft: readonly (readonly { id: string }[])[], id: string) => draft.findIndex((g) => g.some((x) => x.id === id));

  it("an old pair that won its group: the new pair starts one group higher, in the winner's spot", () => {
    const t = tables(4, 4, 4);
    const winner = t[1]![0]!; // G2P1
    const draft = roundSwitchDraft({ tables: t, fast: false, leaves: none, newPairs: [], changes: [{ old: winner, pair: changed(winner) }] });
    expect(at(draft, "G2P1+new")).toBe(0);
    expect(at(draft, "G2P1")).toBe(-1);
    expect(ids(draft)).toEqual([
      ["G1P1", "G1P2", "G1P3", "G2P1+new"],
      ["G1P4", "G2P2", "G2P3", "G3P1"],
      ["G2P4", "G3P2", "G3P3", "G3P4"],
    ]);
  });

  it("an old pair that finished last: the new pair starts one group lower", () => {
    const t = tables(4, 4, 4);
    const last = t[1]![3]!; // G2P4
    const draft = roundSwitchDraft({ tables: t, fast: false, leaves: none, newPairs: [], changes: [{ old: last, pair: changed(last) }] });
    expect(at(draft, "G2P4+new")).toBe(2);
  });

  it("keeps the spot whatever the new pair's rating: no new-pair placement, only the seed inside the group follows it", () => {
    const t = tables(4, 4, 4);
    const mid = t[2]![1]!; // G3P2 stays in group 3
    const draft = roundSwitchDraft({ tables: t, fast: false, leaves: none, newPairs: [], changes: [{ old: mid, pair: changed(mid, 2500) }] });
    // Placed as a new pair, 2500 would aim at group 2; it keeps group 3 and is seeded first there.
    expect(draft[2]![0]!.id).toBe("G3P2+new");
  });

  it("an old pair that leaves by a 3rd strike: the new pair is placed by the new-pair rules", () => {
    const t = tables(4, 4, 4);
    const winner = t[0]![0]!; // G1P1, rated 1990: the new pair, 1000, goes to the bottom
    const draft = roundSwitchDraft({
      tables: t,
      fast: false,
      leaves: (x) => x.id === "G1P1",
      newPairs: [],
      changes: [{ old: winner, pair: changed(winner, 1000) }],
    });
    expect(at(draft, "G1P1")).toBe(-1);
    expect(at(draft, "G1P1+new")).toBe(2);
    // The same as a late entry of that rating.
    const late = roundSwitchDraft({ tables: t, fast: false, leaves: (x) => x.id === "G1P1", newPairs: [p("G1P1+new", 1000)] });
    expect(ids(draft)).toEqual(ids(late));
  });

  it("a group where two pairs change partners: both keep their spots", () => {
    const t = tables(4, 4, 4);
    const [first, , third] = t[1]!; // G2P1 goes up, G2P3 stays
    const draft = roundSwitchDraft({
      tables: t,
      fast: false,
      leaves: none,
      newPairs: [],
      changes: [
        { old: first!, pair: changed(first!) },
        { old: third!, pair: changed(third!) },
      ],
    });
    expect(at(draft, "G2P1+new")).toBe(0);
    expect(at(draft, "G2P3+new")).toBe(1);
    expect(draft.flat()).toHaveLength(12);
  });

  it("a group where one pair opts out (#395) and another changes partner: the change keeps its spot, the pairs below move up into the hole", () => {
    const t = tables(4, 4, 4);
    const stays = t[1]![1]!; // G2P2
    const draft = roundSwitchDraft({
      tables: t,
      fast: false,
      leaves: (x) => x.id === "G2P3",
      newPairs: [],
      changes: [{ old: stays, pair: changed(stays) }],
    });
    expect(ids(draft)).toEqual([
      ["G1P1", "G1P2", "G1P3", "G2P1"],
      ["G1P4", "G2P2+new", "G2P4", "G3P1"],
      ["G3P2", "G3P3", "G3P4"],
    ]);
  });

  it("late entries are placed after the spots are kept, and a change without a spot after them", () => {
    const t = tables(4, 4);
    const gone = t[0]![1]!; // G1P2 leaves by a 3rd strike
    const keep = t[1]![2]!; // G2P3
    const draft = roundSwitchDraft({
      tables: t,
      fast: false,
      leaves: (x) => x.id === "G1P2",
      newPairs: [p("Late", 1000)],
      changes: [
        { old: gone, pair: changed(gone, 1000) },
        { old: keep, pair: changed(keep) },
      ],
    });
    expect(at(draft, "G2P3+new")).toBe(1);
    expect(draft.flat().map((x) => x.id)).toEqual(expect.arrayContaining(["Late", "G1P2+new"]));
    expect(draft.map((g) => g.length)).toEqual([3, 3, 3]);
  });

  it("keepSpots returns the changes without a spot, in their order, and leaves the input as it was", () => {
    const groups = [[p("A"), p("B")], [p("C")]];
    const out = keepSpots(groups, [
      { old: groups[0]![1]!, pair: p("B2") },
      { old: p("X"), pair: p("X2") },
    ]);
    expect(ids(out.groups)).toEqual([["A", "B2"], ["C"]]);
    expect(out.unplaced.map((x) => x.id)).toEqual(["X2"]);
    expect(ids(groups)).toEqual([["A", "B"], ["C"]]);
  });

  it("with an opt-out (#395): the staying player's ends the change and the pair leaves as opted out; the leaving player's changes nothing", () => {
    expect(changeAtSwitch({ strikes: false, optedOutBy: null })).toBe("keeps_spot");
    expect(changeAtSwitch({ strikes: false, optedOutBy: "leaving" })).toBe("keeps_spot");
    expect(changeAtSwitch({ strikes: true, optedOutBy: "leaving" })).toBe("new_pair");
    expect(changeAtSwitch({ strikes: false, optedOutBy: "staying" })).toBe("ends");
    expect(changeAtSwitch({ strikes: true, optedOutBy: "staying" })).toBe("ends");
    expect(changeLeaveReason({ strikes: false, optedOutBy: "leaving" })).toBeNull();
    expect(changeLeaveReason({ strikes: false, optedOutBy: "staying" })).toBe("opted_out");
    expect(changeLeaveReason({ strikes: true, optedOutBy: null })).toBe("strikes");

    // The draft: G2P1 changes partner. The leaving player opted out: the new pair still goes up.
    const t = tables(4, 4, 4);
    const winner = t[1]![0]!;
    const kept = roundSwitchDraft({ tables: t, fast: false, leaves: none, newPairs: [], changes: [{ old: winner, pair: changed(winner) }] });
    expect(at(kept, "G2P1+new")).toBe(0);
    // The staying player opted out: no change reaches the draft, the old pair leaves and the pairs below move up.
    const ended = roundSwitchDraft({ tables: t, fast: false, leaves: (x) => x.id === "G2P1", newPairs: [], changes: [] });
    expect(at(ended, "G2P1")).toBe(-1);
    expect(at(ended, "G2P1+new")).toBe(-1);
    expect(ended.flat()).toHaveLength(11);
  });

  it("without changes the draft is unchanged", () => {
    const t = tables(4, 4, 4);
    expect(ids(roundSwitchDraft({ tables: t, fast: false, leaves: none, newPairs: [], changes: [] }))).toEqual(
      ids(roundSwitchDraft({ tables: t, fast: false, leaves: none, newPairs: [] })),
    );
  });
});
