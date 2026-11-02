import { describe, expect, it } from "vitest";
import type { MatchScore } from "./results";
import { type GroupMatch, groupStandings, type StandingPair } from "./standings";

const pair = (id: string, elo = 1200, withdrawn = false): StandingPair => ({ id, elo, withdrawn });

// Scores from side a's point of view.
const S20: MatchScore = { sets: [[4, 0], [4, 0]] }; // 2-0, games 8-0
const S20close: MatchScore = { sets: [[5, 4], [5, 4]] }; // 2-0, games 10-8
const S20mid: MatchScore = { sets: [[4, 2], [4, 2]] }; // 2-0, games 8-4
const S21: MatchScore = { sets: [[4, 2], [2, 4]], superTieBreak: [10, 8] }; // 2-1, games 7-6

/** `a` beat `b` with the given score. */
const beat = (a: string, b: string, score: MatchScore = S20): GroupMatch => ({ a, b, outcome: { kind: "played", score } });
const walkover = (winner: string, loser: string): GroupMatch => ({ a: winner, b: loser, outcome: { kind: "walkover", winner: "a" } });
const bothInactive = (a: string, b: string): GroupMatch => ({ a, b, outcome: { kind: "both-inactive" } });
const unplayed = (a: string, b: string): GroupMatch => ({ a, b, outcome: { kind: "unplayed" } });

const order = (pairs: StandingPair[], matches: GroupMatch[]) => groupStandings(pairs, matches).map((r) => r.id);
const row = (pairs: StandingPair[], matches: GroupMatch[], id: string) => {
  const r = groupStandings(pairs, matches).find((x) => x.id === id);
  if (!r) throw new Error(`no row for ${id}`);
  return r;
};

const ABCD = [pair("A"), pair("B"), pair("C"), pair("D")];
const ABC = [pair("A"), pair("B"), pair("C")];

describe("points (spec 9: win 3, played loss 1, walkover loss 0, both inactive 0)", () => {
  it("gives 3 for a win and 1 for a played loss", () => {
    const m = [beat("A", "B")];
    expect(row(ABCD, m, "A")).toMatchObject({ points: 3, wins: 1, losses: 0, matches: 1 });
    expect(row(ABCD, m, "B")).toMatchObject({ points: 1, wins: 0, losses: 1, matches: 1 });
  });

  it("gives 3 for a walkover win and 0 for the walkover loss, scored 4-0 4-0", () => {
    const m = [walkover("C", "D")];
    expect(row(ABCD, m, "C")).toMatchObject({ points: 3, wins: 1, setsWon: 2, setsLost: 0, gamesWon: 8, gamesLost: 0 });
    expect(row(ABCD, m, "D")).toMatchObject({ points: 0, losses: 1, setsWon: 0, setsLost: 2, gamesWon: 0, gamesLost: 8 });
  });

  it("works for a walkover won by side b", () => {
    const m: GroupMatch[] = [{ a: "A", b: "B", outcome: { kind: "walkover", winner: "b" } }];
    expect(row(ABCD, m, "B")).toMatchObject({ points: 3, setDiff: 2, gameDiff: 8 });
    expect(row(ABCD, m, "A")).toMatchObject({ points: 0, setDiff: -2, gameDiff: -8 });
  });

  it("gives both sides a 0-point loss, 0-4 0-4, when neither was active", () => {
    const m = [bothInactive("A", "B")];
    for (const id of ["A", "B"]) {
      expect(row(ABCD, m, id)).toMatchObject({
        points: 0,
        matches: 1,
        wins: 0,
        losses: 1,
        setsWon: 0,
        setsLost: 2,
        gamesWon: 0,
        gamesLost: 8,
        setDiff: -2,
        gameDiff: -8,
      });
    }
  });

  it("gives nothing for an unplayed match and leaves it out of set and game difference", () => {
    const m = [unplayed("A", "B")];
    for (const id of ["A", "B"]) {
      expect(row(ABCD, m, id)).toMatchObject({ points: 0, matches: 0, wins: 0, losses: 0, setDiff: 0, gameDiff: 0 });
    }
  });

  it("counts sets and games over all of a pair's matches, walkovers included", () => {
    const m = [beat("A", "B", S21), walkover("A", "C"), beat("D", "A", S20mid)];
    expect(row(ABCD, m, "A")).toMatchObject({
      points: 3 + 3 + 1,
      setsWon: 2 + 2 + 0,
      setsLost: 1 + 0 + 2,
      gamesWon: 7 + 8 + 4,
      gamesLost: 6 + 0 + 8,
    });
  });

  it("ranks by points first", () => {
    const m = [beat("D", "A"), beat("D", "B"), beat("D", "C"), beat("C", "A"), beat("C", "B"), beat("B", "A")];
    expect(order(ABCD, m)).toEqual(["D", "C", "B", "A"]);
    expect(groupStandings(ABCD, m).map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
});

describe("two pairs tied on points (spec 9 step 2: head-to-head first)", () => {
  // A and B both 7 points with the same set difference (+2); B has the much better game
  // difference, but A beat B. C and D both 5 points; C beat D.
  const m = [
    beat("A", "B", S20close),
    beat("A", "C", S20mid),
    beat("D", "A", S20mid),
    beat("B", "C"),
    beat("B", "D"),
    beat("C", "D"),
  ];

  it("puts the head-to-head winner ahead, even with a worse game difference", () => {
    const rows = groupStandings(ABCD, m);
    expect(rows.map((r) => [r.id, r.points, r.setDiff])).toEqual([
      ["A", 7, 2],
      ["B", 7, 2],
      ["C", 5, -2],
      ["D", 5, -2],
    ]);
    expect(rows[1]!.gameDiff).toBeGreaterThan(rows[0]!.gameDiff);
  });

  it("puts the head-to-head winner ahead even with a worse set difference", () => {
    // A beat B narrowly, but B crushed C and D while A only won 2-1s.
    const m2 = [beat("A", "B", S21), beat("A", "C", S21), beat("D", "A"), beat("B", "C"), beat("B", "D"), beat("C", "D")];
    const rows = groupStandings(ABCD, m2);
    expect(rows.slice(0, 2).map((r) => r.id)).toEqual(["A", "B"]);
    expect(rows[1]!.setDiff).toBeGreaterThan(rows[0]!.setDiff);
  });

  it("counts a walkover as a head-to-head win", () => {
    // A and B both 6 points; A has the better set difference, but B won their match by walkover.
    const m = [walkover("B", "A"), beat("A", "C"), beat("A", "D"), beat("B", "C", S21), walkover("D", "B"), beat("C", "D")];
    const rows = groupStandings(ABCD, m);
    expect(rows.map((r) => [r.id, r.points])).toEqual([
      ["B", 6],
      ["A", 6],
      ["C", 5],
      ["D", 5],
    ]);
    expect(rows[1]!.setDiff).toBeGreaterThan(rows[0]!.setDiff);
  });

  it("falls through to set difference when their match was unplayed", () => {
    const pairs3 = [pair("A"), pair("B"), pair("C")];
    // A and B: one win each over C, A by 2-1, B by 2-0; A-B unplayed.
    const m3 = [beat("A", "C", S21), beat("B", "C"), unplayed("A", "B")];
    expect(order(pairs3, m3)).toEqual(["B", "A", "C"]);
  });

  it("falls through when neither was active in their match (no head-to-head winner)", () => {
    const pairs3 = [pair("A"), pair("B"), pair("C")];
    const m3 = [beat("A", "C", S20close), beat("B", "C", S20), bothInactive("A", "B")];
    // Same points and set difference (0), B has the better game difference.
    expect(order(pairs3, m3)).toEqual(["B", "A", "C"]);
    expect(row(pairs3, m3, "A").setDiff).toBe(row(pairs3, m3, "B").setDiff);
  });

  it("uses Elo last", () => {
    const pairs3 = [pair("A", 1100), pair("B", 1300), pair("C")];
    const sameGames = [beat("A", "C"), beat("B", "C"), unplayed("A", "B")];
    expect(order(pairs3, sameGames)).toEqual(["B", "A", "C"]);
  });
});

describe("three or more pairs tied on points (spec 9: set, game, Elo; back to head-to-head at 2)", () => {
  it("ranks the spec example A, B, C: A by set difference, then B over C by head-to-head", () => {
    // A beat B, B beat C, C beat A; each also beat D, so A, B and C have 2 wins each.
    // C has a better game difference than B, but B beat C.
    const m = [
      beat("A", "B"),
      beat("B", "C", S20mid),
      beat("C", "A"),
      beat("A", "D"),
      beat("B", "D", S21),
      beat("C", "D", S21),
    ];
    const rows = groupStandings(ABCD, m);
    expect(rows.map((r) => r.id)).toEqual(["A", "B", "C", "D"]);
    expect(rows.slice(0, 3).map((r) => r.points)).toEqual([7, 7, 7]);
    expect(rows.slice(0, 3).map((r) => r.setDiff)).toEqual([2, 1, 1]);
    expect(rows[2]!.gameDiff).toBeGreaterThan(rows[1]!.gameDiff);
  });

  it("doesn't use head-to-head while 3 are tied: set difference decides even against the direct result", () => {
    // Group of 3, a cycle: A beat B 2-0, B beat C 2-1, C beat A 2-1. All 4 points.
    const m = [beat("A", "B"), beat("B", "C", S21), beat("C", "A", S21)];
    const rows = groupStandings(ABC, m);
    expect(rows.map((r) => [r.id, r.points, r.setDiff])).toEqual([
      ["A", 4, 1],
      ["C", 4, 0],
      ["B", 4, -1],
    ]);
  });

  it("uses game difference when set difference leaves all 3 tied", () => {
    // Each won 2-0 once and lost 0-2 once: set difference 0 for all.
    const m = [beat("A", "B", S20), beat("B", "C", S20close), beat("C", "A", S20mid)];
    // A: +8 -4 = +4, B: -8 +2 = -6, C: -2 +4 = +2
    expect(order(ABC, m)).toEqual(["A", "C", "B"]);
  });

  it("uses Elo when sets and games leave all 3 tied, and head-to-head for the 2 still tied", () => {
    const m = [beat("A", "B", S20mid), beat("B", "C", S20mid), beat("C", "A", S20mid)];
    // Everybody: 4 points, sets 2-2, games 12-12. A has the best Elo; B and C share one.
    const pairs = [pair("C", 1200), pair("B", 1200), pair("A", 1400)];
    expect(order(pairs, m)).toEqual(["A", "B", "C"]);
  });

  it("goes back to head-to-head when game difference leaves 2 of 3 tied", () => {
    // A, B and C each beat D and one other (7 points) and all have set difference +2.
    // Games: A +8, B and C +4 each; B beat C. Input order puts C before B.
    const m = [
      beat("A", "B", S20),
      beat("B", "C", S20),
      beat("C", "A", S20),
      beat("A", "D", S20),
      beat("B", "D", S20mid),
      beat("C", "D", S20mid),
    ];
    const pairs = [pair("D"), pair("C"), pair("B"), pair("A")];
    const rows = groupStandings(pairs, m);
    expect(rows.map((r) => [r.id, r.points, r.setDiff, r.gameDiff])).toEqual([
      ["A", 7, 2, 8],
      ["B", 7, 2, 4],
      ["C", 7, 2, 4],
      ["D", 3, -6, -16],
    ]);
  });

  it("splits a 4-way tie into two 2-way ties and settles each by head-to-head", () => {
    // A cycle with the diagonals unplayed: D>A, A>B, B>C, C>D, all 2-0. Everyone has
    // 4 points and set difference 0. Games: A and B +2, C and D -2. A beat B, C beat D.
    // B and D have the better Elo and come first in the input.
    const S41: MatchScore = { sets: [[4, 1], [4, 1]] }; // 2-0, games 8-2
    const m = [
      beat("D", "A", S20close),
      beat("A", "B", S20mid),
      beat("B", "C", S41),
      beat("C", "D", S20mid),
      unplayed("A", "C"),
      unplayed("B", "D"),
    ];
    const pairs = [pair("B", 1400), pair("A", 1000), pair("D", 1400), pair("C", 1000)];
    const rows = groupStandings(pairs, m);
    expect(rows.map((r) => [r.id, r.points, r.setDiff, r.gameDiff])).toEqual([
      ["A", 4, 0, 2],
      ["B", 4, 0, 2],
      ["C", 4, 0, -2],
      ["D", 4, 0, -2],
    ]);
  });

  it("settles the 2 left tied in the middle by head-to-head", () => {
    // All 4 points. Set difference: A +1, B and D 0, C -1. B and D are also level on
    // games and Elo, and B comes first in the input, but D beat B.
    const m = [beat("B", "A", S21), beat("A", "C", S20), beat("D", "B", S21), beat("C", "D", S21), unplayed("A", "D"), unplayed("B", "C")];
    const rows = groupStandings(ABCD, m);
    expect(rows.map((r) => [r.id, r.points, r.setDiff])).toEqual([
      ["A", 4, 1],
      ["D", 4, 0],
      ["B", 4, 0],
      ["C", 4, -1],
    ]);
  });
});

describe("pairs equal on every rule", () => {
  it("keep the order they were given in (seed order)", () => {
    expect(order([pair("A"), pair("B")], [unplayed("A", "B")])).toEqual(["A", "B"]);
    expect(order([pair("B"), pair("A")], [unplayed("A", "B")])).toEqual(["B", "A"]);
    expect(order(ABC, [])).toEqual(["A", "B", "C"]);
  });
});

describe("withdrawn pairs (rules 2: all their matches leave the table)", () => {
  const base = [beat("A", "B"), beat("B", "C", S21), beat("C", "A", S21)];

  it("leaves out the pair and every match it played, so nobody's points or differences change", () => {
    const withD = [...base, beat("D", "A"), beat("B", "D"), walkover("C", "D")];
    const pairs = [pair("A"), pair("B"), pair("C"), pair("D", 1200, true)];
    expect(groupStandings(pairs, withD)).toEqual(groupStandings(ABC, base));
    expect(order(pairs, withD)).not.toContain("D");
  });

  it("also drops its unplayed and both-inactive matches", () => {
    const withD = [...base, unplayed("D", "A"), bothInactive("B", "D")];
    const pairs = [pair("A"), pair("B"), pair("C"), pair("D", 1200, true)];
    expect(groupStandings(pairs, withD)).toEqual(groupStandings(ABC, base));
  });
});

describe("group sizes (spec 4: 3 and 4)", () => {
  it("ranks a full group of 3", () => {
    const m = [beat("A", "B"), beat("A", "C"), beat("B", "C")];
    const rows = groupStandings(ABC, m);
    expect(rows.map((r) => [r.id, r.points, r.matches])).toEqual([
      ["A", 6, 2],
      ["B", 4, 2],
      ["C", 2, 2],
    ]);
  });

  it("ranks a full group of 4", () => {
    const m = [beat("A", "B"), beat("A", "C"), beat("A", "D"), beat("B", "C"), beat("B", "D"), beat("C", "D")];
    const rows = groupStandings(ABCD, m);
    expect(rows.map((r) => [r.id, r.points, r.matches])).toEqual([
      ["A", 9, 3],
      ["B", 7, 3],
      ["C", 5, 3],
      ["D", 3, 3],
    ]);
  });
});

describe("bad input", () => {
  it("rejects a match with a pair outside the group", () => {
    expect(() => groupStandings(ABC, [beat("A", "X")])).toThrow(/outside the group/);
  });

  it("rejects a pair playing itself", () => {
    expect(() => groupStandings(ABC, [beat("A", "A")])).toThrow(/itself/);
  });

  it("rejects duplicate pair ids", () => {
    expect(() => groupStandings([pair("A"), pair("A")], [])).toThrow(/Duplicate/);
  });

  it("rejects a played match with an invalid score", () => {
    expect(() => groupStandings(ABC, [beat("A", "B", { sets: [[4, 3], [4, 0]] })])).toThrow(/invalid-set/);
  });
});
