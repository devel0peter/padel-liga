import { describe, expect, it } from "vitest";
import {
  currentElo,
  expectedScore,
  isLevel,
  matchEloChanges,
  pairElo,
  playerK,
  ratedWinner,
  replayElo,
  sideK,
  STARTING_ELO,
  startingElo,
  type EloState,
  type RatedMatch,
} from "./elo";

describe("startingElo (spec 11)", () => {
  it("starts from the self-assessed level", () => {
    expect(startingElo("kezdo")).toBe(1000);
    expect(startingElo("kozephalado")).toBe(1200);
    expect(startingElo("halado")).toBe(1400);
    expect(startingElo("versenyzo")).toBe(1600);
  });

  it("knows exactly the four signup levels", () => {
    expect(Object.keys(STARTING_ELO).sort()).toEqual(["halado", "kezdo", "kozephalado", "versenyzo"]);
    expect(isLevel("halado")).toBe(true);
    expect(isLevel("profi")).toBe(false);
    expect(isLevel("toString")).toBe(false);
  });
});

describe("pairElo (spec 11)", () => {
  it("is the average of the two players", () => {
    expect(pairElo(1000, 1200)).toBe(1100);
    expect(pairElo(1400, 1400)).toBe(1400);
    expect(pairElo(1000, 1601)).toBe(1300.5);
  });

  it("doesn't depend on the order of the players", () => {
    expect(pairElo(1600, 1000)).toBe(pairElo(1000, 1600));
  });
});

describe("currentElo (spec 11)", () => {
  it("is the stored rating once there is one", () => {
    expect(currentElo(1234.5, "kezdo")).toBe(1234.5);
  });

  it("falls back to the level's starting value, else null", () => {
    expect(currentElo(null, "halado")).toBe(1400);
    expect(currentElo(null, null)).toBeNull();
    expect(currentElo(null, "profi")).toBeNull();
  });
});

const fresh = (rating: number, matches = 0): EloState => ({ rating, matches });

describe("expectedScore (spec 11)", () => {
  it("is 50% between equal pairs", () => {
    expect(expectedScore(1300, 1300)).toBe(0.5);
  });

  it("matches the rules page: a 1200 pair has a 24% chance against a 1400 one", () => {
    expect(expectedScore(1200, 1400)).toBeCloseTo(0.2403, 4);
    expect(expectedScore(1200, 1400) + expectedScore(1400, 1200)).toBeCloseTo(1, 10);
  });
});

describe("playerK and sideK (spec 11, D104)", () => {
  it("is 40 for a player's first 10 rated matches, 20 from the 11th", () => {
    expect(playerK(0)).toBe(40);
    expect(playerK(9)).toBe(40);
    expect(playerK(10)).toBe(20);
    expect(playerK(25)).toBe(20);
  });

  it("gives a side the average of its players' K", () => {
    expect(sideK(40, 40)).toBe(40);
    expect(sideK(40, 20)).toBe(30);
    expect(sideK(20, 20)).toBe(20);
  });
});

describe("ratedWinner (spec 8, 11)", () => {
  it("rates only a played match, by who won it", () => {
    expect(ratedWinner({ kind: "played", score: { sets: [[4, 1], [4, 2]] } })).toBe("a");
    expect(ratedWinner({ kind: "played", score: { sets: [[1, 4], [2, 4]] } })).toBe("b");
  });

  it("decides a 1-1 match by the super tie-break", () => {
    expect(ratedWinner({ kind: "played", score: { sets: [[4, 1], [2, 4]], superTieBreak: [8, 10] } })).toBe("b");
  });

  it("doesn't rate a walkover, a both-inactive or an unplayed match, or none at all", () => {
    expect(ratedWinner({ kind: "walkover", winner: "a" })).toBeNull();
    expect(ratedWinner({ kind: "both-inactive" })).toBeNull();
    expect(ratedWinner({ kind: "unplayed" })).toBeNull();
    expect(ratedWinner(null)).toBeNull();
  });
});

const m = (id: number, a: [string, string], b: [string, string], winner: "a" | "b" = "a"): RatedMatch => ({ id, a, b, winner });
const deltas = (changes: { playerId: string; delta: number }[]) => Object.fromEntries(changes.map((c) => [c.playerId, c.delta]));

describe("matchEloChanges (spec 11)", () => {
  const states = (map: Record<string, EloState>) => (id: string) => map[id]!;

  it("gives two equal new pairs +20 and -20 (K = 40)", () => {
    const changes = matchEloChanges(m(1, ["p", "q"], ["r", "s"]), () => fresh(1200));
    expect(deltas(changes)).toEqual({ p: 20, q: 20, r: -20, s: -20 });
    expect(changes.find((c) => c.playerId === "p")).toEqual({ matchId: 1, playerId: "p", before: 1200, after: 1220, delta: 20, k: 40 });
  });

  it("matches the rules page example: 1200 beats 1400 for about +30, loses for about -10", () => {
    const st = states({ p: fresh(1200), q: fresh(1200), r: fresh(1400), s: fresh(1400) });
    expect(Math.round(matchEloChanges(m(1, ["p", "q"], ["r", "s"], "a"), st)[0]!.delta)).toBe(30);
    expect(Math.round(matchEloChanges(m(1, ["p", "q"], ["r", "s"], "b"), st)[0]!.delta)).toBe(-10);
  });

  it("rates a pair by its players' average, and both partners get the same delta", () => {
    const st = states({ p: fresh(1000), q: fresh(1400), r: fresh(1200), s: fresh(1200) });
    const d = deltas(matchEloChanges(m(1, ["p", "q"], ["r", "s"]), st));
    expect(d.p).toBe(20);
    expect(d.q).toBe(20);
    expect(d.r).toBe(-20);
  });

  it("uses K = 20 for a player's 11th rated match", () => {
    const st = states({ p: fresh(1200, 10), q: fresh(1200, 10), r: fresh(1200, 10), s: fresh(1200, 10) });
    expect(deltas(matchEloChanges(m(1, ["p", "q"], ["r", "s"]), st))).toEqual({ p: 10, q: 10, r: -10, s: -10 });
    const tenth = states({ p: fresh(1200, 9), q: fresh(1200, 9), r: fresh(1200, 9), s: fresh(1200, 9) });
    expect(matchEloChanges(m(1, ["p", "q"], ["r", "s"]), tenth)[0]!.k).toBe(40);
  });

  it("gives a mixed side K = 30, so the match isn't zero-sum when the sides' K differ", () => {
    const st = states({ p: fresh(1200, 0), q: fresh(1200, 12), r: fresh(1200, 12), s: fresh(1200, 12) });
    const changes = matchEloChanges(m(1, ["p", "q"], ["r", "s"]), st);
    expect(deltas(changes)).toEqual({ p: 15, q: 15, r: -10, s: -10 });
    expect(changes.map((c) => c.k)).toEqual([30, 30, 20, 20]);
  });

  it("changes only the four players who played (a substitute instead of the absent partner)", () => {
    const st = states({ p: fresh(1200), sub: fresh(1000), r: fresh(1200), s: fresh(1200) });
    const changes = matchEloChanges(m(1, ["p", "sub"], ["r", "s"]), st);
    expect(changes.map((c) => c.playerId).sort()).toEqual(["p", "r", "s", "sub"]);
  });
});

describe("replayElo (spec 11)", () => {
  const start = (id: string) => (id.startsWith("h") ? 1400 : 1200);

  it("chains matches in order and counts each player's rated matches", () => {
    const { changes, players } = replayElo(start, [m(1, ["p", "q"], ["r", "s"]), m(2, ["p", "r"], ["q", "s"], "b")]);
    expect(changes).toHaveLength(8);
    expect(changes[4]).toMatchObject({ matchId: 2, playerId: "p", before: 1220 });
    expect(players.get("p")).toMatchObject({ matches: 2 });
    expect(players.get("s")).toMatchObject({ matches: 2 });
  });

  it("leaves players without a rated match out, at their starting value", () => {
    const { players } = replayElo(start, [m(1, ["p", "q"], ["r", "s"])]);
    expect(players.has("x")).toBe(false);
  });

  it("switches a player to K = 20 from their 11th match", () => {
    const ten = Array.from({ length: 11 }, (_, i) => m(i + 1, ["p", "q"], ["r", "s"], i % 2 === 0 ? "a" : "b"));
    const { changes, players } = replayElo(start, ten);
    expect(changes.filter((c) => c.playerId === "p").map((c) => c.k)).toEqual([...Array(10).fill(40), 20]);
    expect(players.get("p")!.matches).toBe(11);
  });

  it("replays an overridden match in its place, as if the new outcome had been there from the start", () => {
    const first = [m(1, ["p", "q"], ["r", "s"], "a"), m(2, ["p", "q"], ["h1", "h2"], "a")];
    const overridden = [m(1, ["p", "q"], ["r", "s"], "b"), m(2, ["p", "q"], ["h1", "h2"], "a")];
    const before = replayElo(start, first);
    const after = replayElo(start, overridden);
    // Match 2 now starts from p's lower rating, so it pays more.
    const m2 = (r: ReturnType<typeof replayElo>) => r.changes.find((c) => c.matchId === 2 && c.playerId === "p")!;
    expect(m2(after).before).toBe(1180);
    expect(m2(after).delta).toBeGreaterThan(m2(before).delta);
    // The same result as replaying the new outcomes from scratch.
    expect(after.players.get("h1")!.rating).toBeCloseTo(1400 + matchEloChanges(overridden[1]!, (id) => ({ rating: id === "p" || id === "q" ? 1180 : 1400, matches: id.startsWith("h") ? 0 : 1 })).find((c) => c.playerId === "h1")!.delta, 10);
  });
});
