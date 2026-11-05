import { describe, expect, it } from "vitest";
import {
  borderSwaps,
  DEFAULT_FAST_SWITCHES,
  isFastSwitch,
  placementRating,
  placeNewPairs,
  promoteAndRelegate,
  recut,
  roundSwitchDraft,
  switchSizes,
  UNRATED_DISCOUNT,
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

describe("placementRating (spec 10 step 1)", () => {
  it("averages the two players' Elo", () => {
    expect(placementRating({ elo: 1300, rated: true }, { elo: 1100, rated: true })).toBe(1200);
  });

  it("counts a player without a rated match 100 lower", () => {
    expect(UNRATED_DISCOUNT).toBe(100);
    expect(placementRating({ elo: 1400, rated: false }, { elo: 1200, rated: true })).toBe(1250);
    expect(placementRating({ elo: 1400, rated: false }, { elo: 1400, rated: false })).toBe(1300);
  });
});

describe("placeNewPairs (interim: new pairs go to the bottom until the placement policy is decided)", () => {
  const full = (prefix: string, elo: number, n = 4) => Array.from({ length: n }, (_, i) => p(`${prefix}${i + 1}`, elo - i));

  it("fills the bottom group's free spot", () => {
    expect(ids(placeNewPairs([full("A", 1600), full("B", 1400, 3)], [{ pair: p("N", 1500), rating: 1500 }]))).toEqual([
      ["A1", "A2", "A3", "A4"],
      ["B1", "B2", "B3", "N"],
    ]);
  });

  it("re-cuts the bottom groups to the section 4 sizes when the bottom is full", () => {
    expect(ids(placeNewPairs([full("A", 1600), full("B", 1400)], [{ pair: p("N", 1000), rating: 1000 }]))).toEqual([
      ["A1", "A2", "A3"],
      ["A4", "B1", "B2"],
      ["B3", "B4", "N"],
    ]);
  });

  it("places the highest rating first, ties in entry order", () => {
    const out = placeNewPairs(
      [full("A", 1600, 3)],
      [
        { pair: p("N1", 1100), rating: 1100 },
        { pair: p("N2", 1300), rating: 1300 },
        { pair: p("N3", 1100), rating: 1100 },
      ],
    );
    expect(ids(out)).toEqual([["A1", "A2", "A3"], ["N2", "N1", "N3"]]);
  });

  it("starts a group when nobody continues, and changes nothing without new pairs", () => {
    expect(ids(placeNewPairs([], [{ pair: p("N"), rating: 1200 }]))).toEqual([["N"]]);
    const groups = [full("A", 1600)];
    expect(placeNewPairs(groups, [])).toEqual(groups);
  });
});

describe("roundSwitchDraft (spec 10)", () => {
  it("adds 2 new pairs to 8 as 4+3+3", () => {
    const draft = roundSwitchDraft({
      tables: tables(4, 4), // G1 1990..1960, G2 1950..1920
      fast: false,
      leaves: none,
      newPairs: [
        { pair: p("Low", 1000), rating: 1000 },
        { pair: p("High", 1955), rating: 1955 },
      ],
    });
    expect(draft.map((g) => g.length)).toEqual([4, 3, 3]);
    expect(ids(draft)).toEqual([
      ["G1P1", "G1P2", "G1P3", "G2P1"],
      ["G1P4", "G2P2", "G2P3"],
      ["High", "G2P4", "Low"],
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
      newPairs: [1, 2, 3].map((i) => ({ pair: p(`N${i}`, 1000 + i), rating: 1000 + i })),
    });
    expect(ids(draft)).toEqual([["N3", "N2", "N1"]]);
  });
});
