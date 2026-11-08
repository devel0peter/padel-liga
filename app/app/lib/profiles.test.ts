import { describe, expect, it } from "vitest";

import {
  changedPairIds,
  eloSeries,
  formerPairViews,
  matchViews,
  pairName,
  pairPath,
  personView,
  playerPath,
  playerStats,
  roundsText,
  shownElo,
  type FormerPairInput,
  type ProfileMatchInput,
  type ProfilePair,
} from "./profiles";

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

describe("playerStats (D136)", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const g = (season: string, startsAt: string) => ({ season, startsAt: new Date(startsAt) });

  it("counts the seasons and rounds the player has played in", () => {
    const stats = playerStats(
      [g("1:ősz", "2026-10-05T00:00:00Z"), g("1:ősz", "2026-10-26T00:00:00Z"), g("1:tél", "2026-11-16T00:00:00Z")],
      [],
      now,
    );
    expect(stats).toMatchObject({ seasons: 2, rounds: 3 });
  });

  it("leaves out a round that hasn't started yet", () => {
    const stats = playerStats([g("1:ősz", "2026-10-26T00:00:00Z"), g("1:tél", "2026-11-30T00:00:00Z")], [], now);
    expect(stats).toMatchObject({ seasons: 1, rounds: 1 });
  });

  it("keeps two leagues' seasons of the same name apart", () => {
    expect(playerStats([g("1:ősz", "2026-10-05T00:00:00Z"), g("2:ősz", "2026-10-05T00:00:00Z")], [], now).seasons).toBe(2);
  });

  it("counts the matches with a final result as wins and losses", () => {
    const stats = playerStats([], [{ verdict: "Győzelem" }, { verdict: "Vereség" }, { verdict: "Győzelem" }], now);
    expect(stats).toEqual({ seasons: 0, rounds: 0, matches: 3, wins: 2, losses: 1 });
  });

  it("is all zero for a player without a started round", () => {
    expect(playerStats([], [], now)).toEqual({ seasons: 0, rounds: 0, matches: 0, wins: 0, losses: 0 });
  });
});

describe("Korábbi párjaid (#347, D142)", () => {
  const g = (season: string, phase: number, startsAt: string) => ({ season, phase, startsAt: new Date(startsAt) });

  describe("roundsText", () => {
    it("one round, and consecutive rounds as a range", () => {
      expect(roundsText([g("2026/27 tél", 1, "2026-11-08T23:00:00Z")])).toBe("2026/27 tél, 1. kör");
      expect(roundsText([g("2026/27 tél", 2, "2026-11-29T23:00:00Z"), g("2026/27 tél", 1, "2026-11-08T23:00:00Z")])).toBe(
        "2026/27 tél, 1–2. kör",
      );
    });

    it("a gap splits the range; a round twice counts once", () => {
      const list = [1, 2, 3, 5, 5].map((n) => g("2026/27 tél", n, "2026-11-08T23:00:00Z"));
      expect(roundsText(list)).toBe("2026/27 tél, 1–3., 5. kör");
    });

    it("several seasons, the oldest first", () => {
      const list = [g("2027 tavasz", 1, "2027-03-01T00:00:00Z"), g("2026/27 tél", 3, "2026-12-20T23:00:00Z")];
      expect(roundsText(list)).toBe("2026/27 tél, 3. kör; 2027 tavasz, 1. kör");
    });
  });

  describe("changedPairIds", () => {
    it("reads the old pair from a pair.change entry's detail", () => {
      const details = ["league:1; from pair:12; user:a -> user:b", "league:1; from pair:3; user:c -> user:d", null];
      expect(changedPairIds(details)).toEqual(new Set([12, 3]));
    });

    it("does not mistake another pair's id or another kind of detail for it", () => {
      expect(changedPairIds(["league:1", "league:1; from pair:120x; user:a", "pair:12"])).toEqual(new Set());
    });
  });

  describe("formerPairViews", () => {
    const anna = personView({ id: "ua", name: "Anna", deletedAt: null });
    const gone = personView({ id: "ub", name: "Régi Név", deletedAt: new Date() });
    const former = (over: Partial<FormerPairInput>): FormerPairInput => ({
      pairId: 1,
      partner: anna,
      league: "Padelpárbaj Győr",
      dissolvedAt: new Date("2026-12-01T10:00:00Z"),
      groups: [g("2026/27 tél", 1, "2026-11-08T23:00:00Z")],
      ...over,
    });
    const day = (d: Date) => d.toISOString().slice(0, 10);

    it("a row: partner, the pair page, league, rounds, how and when it ended", () => {
      expect(formerPairViews([former({})], new Set(), day)).toEqual([
        {
          pairId: 1,
          partner: anna,
          link: "/pairs/1",
          league: "Padelpárbaj Győr",
          rounds: "2026/27 tél, 1. kör",
          end: "Felbontva",
          endedOn: "2026-12-01",
        },
      ]);
    });

    it("Partnercsere for a pair a partner change ended, Felbontva for the rest", () => {
      const views = formerPairViews([former({ pairId: 1 }), former({ pairId: 2 })], new Set([2]), day);
      expect(views.map((v) => [v.pairId, v.end])).toEqual([
        [2, "Partnercsere"],
        [1, "Felbontva"],
      ]);
    });

    it("the newest ended first; a pair with no stored end last", () => {
      const list = [
        former({ pairId: 1, dissolvedAt: new Date("2026-12-01T10:00:00Z") }),
        former({ pairId: 2, dissolvedAt: null }),
        former({ pairId: 3, dissolvedAt: new Date("2027-01-05T10:00:00Z") }),
      ];
      const views = formerPairViews(list, new Set(), day);
      expect(views.map((v) => v.pairId)).toEqual([3, 1, 2]);
      expect(views[2]!.endedOn).toBe("");
    });

    it("leaves out a pair that never played in a published group", () => {
      expect(formerPairViews([former({ groups: [] })], new Set(), day)).toEqual([]);
    });

    it("a deleted partner is Törölt játékos without a link", () => {
      const [v] = formerPairViews([former({ partner: gone })], new Set(), day);
      expect(v).toMatchObject({ partner: { id: null, name: "Törölt játékos" }, link: null });
    });
  });
});
