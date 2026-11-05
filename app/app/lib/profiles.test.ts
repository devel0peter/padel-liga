import { describe, expect, it } from "vitest";

import { eloSeries, matchViews, pairName, pairPath, personView, playerPath, shownElo, type ProfileMatchInput, type ProfilePair } from "./profiles";

const pairOf = (id: number, a: string, b: string): ProfilePair => ({
  id,
  players: [personView({ id: `${a}-id`, name: a, deletedAt: null }), personView({ id: `${b}-id`, name: b, deletedAt: null })],
});
const P1 = pairOf(1, "Anna", "Bea");
const P2 = pairOf(2, "Cili", "Dóra");

const input = (over: Partial<ProfileMatchInput>): ProfileMatchInput => ({
  id: 1,
  season: "2026/27 tél",
  phase: 1,
  startsAt: new Date("2026-11-08T23:00:00Z"),
  week: 1,
  scheduledAt: null,
  status: "final",
  outcome: null,
  a: P1,
  b: P2,
  withdrawn: false,
  ...over,
});
const fmt = () => "nov. 10.";

describe("personView and links (#36)", () => {
  it("a deleted account is Törölt játékos, never its old name or id, and links nowhere", () => {
    const gone = personView({ id: "x", name: "Régi Név", deletedAt: new Date() });
    expect(gone).toEqual({ id: null, name: "Törölt játékos" });
    expect(playerPath(gone)).toBeNull();
  });

  it("a player links to /players/<id>, a pair to /pairs/<id>", () => {
    expect(playerPath(P1.players[0])).toBe("/players/Anna-id");
    expect(pairPath(7)).toBe("/pairs/7");
    expect(pairName(P1)).toBe("Anna – Bea");
  });

  it("an account without a name is Névtelen", () => {
    expect(personView({ id: "x", name: "", deletedAt: null }).name).toBe("Névtelen");
  });
});

describe("matchViews", () => {
  it("shows the outcome from the own pair's side", () => {
    const m = input({ outcome: { kind: "played", score: { sets: [[4, 1], [2, 4]], superTieBreak: [10, 8] } }, scheduledAt: new Date() });
    expect(matchViews(new Set([1]), [m], fmt)[0]).toMatchObject({
      opponents: P2,
      verdict: "Győzelem",
      result: "4:1, 2:4, szuper tie-break 10:8",
      date: "nov. 10.",
    });
    expect(matchViews(new Set([2]), [m], fmt)[0]).toMatchObject({ opponents: P1, verdict: "Vereség", result: "1:4, 4:2, szuper tie-break 8:10" });
  });

  it("walkover and both-inactive read as wins and losses, without a score played", () => {
    const wo = input({ outcome: { kind: "walkover", winner: "b" } });
    expect(matchViews(new Set([2]), [wo], fmt)[0]).toMatchObject({ verdict: "Győzelem", result: "Játék nélkül (4:0, 4:0)" });
    const both = input({ outcome: { kind: "both-inactive" } });
    expect(matchViews(new Set([1]), [both], fmt)[0]).toMatchObject({ verdict: "Vereség", result: "Mindkét pár vereséget kap (0:4, 0:4)" });
  });

  it("leaves out matches that are not final, unplayed, or not the pair's", () => {
    const score = { kind: "played", score: { sets: [[4, 1], [4, 1]] } } as const;
    const list = [
      input({ id: 1, status: "disputed", outcome: score }),
      input({ id: 2, outcome: { kind: "unplayed" } }),
      input({ id: 3, outcome: null }),
    ];
    expect(matchViews(new Set([1]), list, fmt)).toEqual([]);
    expect(matchViews(new Set([9]), [input({ outcome: score })], fmt)).toEqual([]);
  });

  it("orders newest first: phase, then week", () => {
    const score = { kind: "played", score: { sets: [[4, 1], [4, 1]] } } as const;
    const list = [
      input({ id: 1, week: 1, outcome: score }),
      input({ id: 2, week: 3, outcome: score }),
      input({ id: 3, phase: 2, startsAt: new Date("2026-11-29T23:00:00Z"), week: 1, outcome: score }),
    ];
    expect(matchViews(new Set([1]), list, fmt).map((m) => m.when)).toEqual([
      "2026/27 tél, 2. kör, 1. hét",
      "2026/27 tél, 1. kör, 3. hét",
      "2026/27 tél, 1. kör, 1. hét",
    ]);
  });
});

describe("Elo on profiles (spec 11: the profile shows the rounded number)", () => {
  it("rounds", () => {
    expect([shownElo(1412.4), shownElo(1412.5), shownElo(999.6)]).toEqual([1412, 1413, 1000]);
  });

  it("the series starts before the first rated match and follows the replay order", () => {
    const c = (matchId: number, before: number, after: number, iso: string) => ({ matchId, before, after, delta: after - before, at: new Date(iso) });
    expect(eloSeries([c(2, 1420, 1410, "2026-11-18T10:00:00Z"), c(1, 1400, 1420, "2026-11-11T10:00:00Z")])).toEqual([1400, 1420, 1410]);
    expect(eloSeries([])).toEqual([]);
  });
});
