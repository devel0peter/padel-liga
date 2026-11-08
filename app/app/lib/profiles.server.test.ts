// profiles.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): who has a profile, what shows before and after the
// league starts, final results only, Elo history, deleted accounts, and that
// no email or phone leaves the module (#36).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { formerPairs, hasProfile, pairProfile, playerProfile, profilePairIds } = await import("~/lib/profiles.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (iso: string) => new Date(iso);

// Phase 1 from Monday 9 Nov 2026, phase 2 from 30 Nov (Budapest, UTC+1).
const STARTS = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z"];
const BEFORE = at("2026-11-07T10:00:00Z");
const DURING = at("2026-11-20T10:00:00Z");

const played = (sets: [number, number][]) => JSON.stringify({ kind: "played", score: { sets } });

function user(id: string, name: string, level = "halado", elo: number | null = null) {
  h.raw
    .prepare("insert into users (id, email, name, phone, level, elo, consent_at) values (?, ?, ?, '+36301234567', ?, ?, 1)")
    .run(id, `${id}@titkos.example`, name, level, elo);
}

function pair(id: number, a: string, b: string) {
  h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)").run(id, a, b);
}

function group(phase: number, number: number, pairIds: number[], published = true): number {
  h.raw
    .prepare("insert into groups (season_id, phase, number, published_at) values (1, ?, ?, ?)")
    .run(phase, number, published ? sec("2026-11-06T10:00:00Z") : null);
  const id = h.raw.prepare("select id from groups where phase = ? and number = ?").get(phase, number).id;
  pairIds.forEach((p, i) => h.raw.prepare("insert into group_pairs (group_id, pair_id, seed) values (?, ?, ?)").run(id, p, i + 1));
  return id;
}

function match(groupId: number, a: number, b: number, week: number, status = "open", outcome: string | null = null): number {
  h.raw
    .prepare("insert into matches (group_id, pair_a, pair_b, week, deadline, status, outcome) values (?, ?, ?, ?, ?, ?, ?)")
    .run(groupId, a, b, week, sec(STARTS[0]!) + 21 * 86400 - 60, status, outcome);
  return h.raw.prepare("select max(id) as id from matches").get().id;
}

function eloChange(matchId: number, userId: string, before: number, after: number, iso: string) {
  h.raw
    .prepare("insert into elo_changes (match_id, user_id, rating_before, rating_after, delta, k, at) values (?, ?, ?, ?, ?, 40, ?)")
    .run(matchId, userId, before, after, after - before, sec(iso));
}

// Group 1 of phase 1: pairs 1 (Anna, Bea), 2 (Cili, Dóra), 3 (Emma, Flóra).
let g1: number;
beforeEach(() => {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  STARTS.forEach((start, i) =>
    h.raw
      .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, ?, ?, ?)")
      .run(i + 1, sec(start), sec(start) + 21 * 86400 - 60),
  );
  user("ua", "Anna", "halado", 1412.4);
  user("ub", "Bea");
  user("uc", "Cili", "kozephalado");
  user("ud", "Dóra", "kozephalado");
  user("ue", "Emma");
  user("uf", "Flóra");
  pair(1, "ua", "ub");
  pair(2, "uc", "ud");
  pair(3, "ue", "uf");
  g1 = group(1, 1, [1, 2, 3]);
});

describe("who has a profile", () => {
  it("a pair in a published group, and its players", async () => {
    expect(await pairProfile(1, DURING)).not.toBeNull();
    expect(await playerProfile("ua", DURING)).not.toBeNull();
    expect(await hasProfile("ua")).toBe(true);
    expect([...(await profilePairIds([1, 2, 99]))].sort()).toEqual([1, 2]);
  });

  it("nobody before the groups are published: a draft is not public", async () => {
    user("ux", "Xénia");
    user("uy", "Ylona");
    pair(4, "ux", "uy");
    group(1, 2, [4], false);
    expect(await pairProfile(4, DURING)).toBeNull();
    expect(await playerProfile("ux", DURING)).toBeNull();
    expect(await hasProfile("ux")).toBe(false);
    expect(await profilePairIds([4])).toEqual(new Set());
  });

  it("nobody in a league whose city is not listed", async () => {
    h.raw.exec("update cities set listed = 0 where slug = 'gyor'");
    expect(await pairProfile(1, DURING)).toBeNull();
    expect(await playerProfile("ua", DURING)).toBeNull();
    expect(await hasProfile("ua")).toBe(false);
  });

  it("no such pair or player, or a malformed id", async () => {
    expect(await pairProfile(999, DURING)).toBeNull();
    expect(await pairProfile(Number.NaN, DURING)).toBeNull();
    expect(await pairProfile(-1, DURING)).toBeNull();
    expect(await playerProfile("nincs", DURING)).toBeNull();
  });

  it("a deleted or anonymized account has none, and shows as Törölt játékos without a link or its id", async () => {
    h.raw.prepare("update users set name = 'Törölt játékos', email = 'x@deleted.invalid', phone = null, deleted_at = ? where id = 'ub'").run(sec("2026-11-12T10:00:00Z"));
    expect(await playerProfile("ub", DURING)).toBeNull();
    match(g1, 2, 1, 1, "final", played([[4, 1], [4, 2]]));
    const p = await pairProfile(1, DURING);
    expect(p!.pair.players).toEqual([
      { id: "ua", name: "Anna" },
      { id: null, name: "Törölt játékos" },
    ]);
    // Also where the pair appears as an opponent.
    const cili = await playerProfile("uc", DURING);
    expect(cili!.matches[0]!.opponents.players[1]).toEqual({ id: null, name: "Törölt játékos" });
    // Its account id was public in its old profile's address: nowhere in the data now.
    const pages = [p, cili, await playerProfile("ua", DURING), await pairProfile(2, DURING)];
    for (const page of pages) expect(JSON.stringify(page)).not.toContain('"ub"');
  });
});

describe("before the league starts", () => {
  it("names and groups only: no rating, no results, no place", async () => {
    match(g1, 1, 2, 1, "final", played([[4, 1], [4, 2]]));
    const anna = await playerProfile("ua", BEFORE);
    expect(anna).toMatchObject({ started: false, elo: null, eloHistory: [], matches: [] });
    expect(anna!.pairs).toEqual([
      {
        pair: { id: 1, players: [{ id: "ua", name: "Anna" }, { id: "ub", name: "Bea" }] },
        league: "Padelpárbaj Győr",
        latest: { season: "2026/27 tél", phase: 1, group: 1, division: "Bronz divízió", place: null, withdrawn: false },
      },
    ]);
    const p = await pairProfile(1, BEFORE);
    expect(p).toMatchObject({ started: false, matches: [], league: { name: "Padelpárbaj Győr", slug: "gyor" } });
    expect(p!.groups).toEqual([{ season: "2026/27 tél", phase: 1, group: 1, division: "Bronz divízió", place: null, withdrawn: false }]);
  });
});

describe("once the league has started", () => {
  it("lists final results only, from the pair's side, newest first; unplayed and pending ones are left out", async () => {
    match(g1, 1, 2, 1, "final", played([[4, 1], [4, 2]]));
    match(g1, 3, 1, 2, "final", JSON.stringify({ kind: "walkover", winner: "a" }));
    match(g1, 2, 3, 3, "result_pending", played([[4, 0], [4, 0]]));
    const p = await pairProfile(1, DURING);
    expect(p!.started).toBe(true);
    expect(p!.matches.map((m) => [m.when, m.opponents.id, m.verdict, m.result])).toEqual([
      ["2026/27 tél, 1. kör, 2. hét", 3, "Vereség", "Játék nélkül (0:4, 0:4)"],
      ["2026/27 tél, 1. kör, 1. hét", 2, "Győzelem", "4:1, 4:2"],
    ]);
    // Pair 2 sees the same match from its side; the pending one is not there.
    expect((await pairProfile(2, DURING))!.matches.map((m) => [m.verdict, m.result])).toEqual([["Vereség", "1:4, 2:4"]]);
    // An unplayed match has no result to show.
    h.raw.exec(`update matches set outcome = '{"kind":"unplayed"}', status = 'final' where week = 3`);
    expect((await pairProfile(2, DURING))!.matches).toHaveLength(1);
  });

  it("the summary (D136): seasons, rounds, matches, wins, losses, for the player and the pair", async () => {
    match(g1, 1, 2, 1, "final", played([[4, 1], [4, 2]]));
    match(g1, 3, 1, 2, "final", JSON.stringify({ kind: "walkover", winner: "a" }));
    // A pending result is not a match yet (D80).
    match(g1, 2, 3, 3, "result_pending", played([[4, 0], [4, 0]]));
    const summary = { seasons: 1, rounds: 1, matches: 2, wins: 1, losses: 1 };
    expect((await playerProfile("ua", DURING))!.stats).toEqual(summary);
    const p = (await pairProfile(1, DURING))!;
    expect(p.stats).toEqual(summary);
    // The pair's Élő-pont: its players' average, a whole number.
    expect(Number.isInteger(p.elo)).toBe(true);
    // Before the round starts nothing is counted and no rating shows.
    expect((await pairProfile(1, BEFORE))!).toMatchObject({ elo: null, stats: { seasons: 0, rounds: 0, matches: 0 } });
  });

  it("the group's place is the league page's table (final results only)", async () => {
    match(g1, 1, 2, 1, "final", played([[4, 1], [4, 2]]));
    match(g1, 3, 2, 2, "final", played([[4, 2], [4, 2]]));
    // A result waiting for the other pair does not count.
    match(g1, 3, 1, 3, "result_pending", played([[4, 0], [4, 0]]));
    const places = await Promise.all([1, 2, 3].map(async (id) => (await pairProfile(id, DURING))!.groups[0]!.place));
    expect(places).toEqual([1, 3, 2]);
  });

  it("a later phase shows first, with its division from the phase's published groups", async () => {
    user("ug", "Gizi");
    user("uh", "Hanna");
    pair(4, "ug", "uh");
    group(1, 2, [4]);
    group(2, 1, [4, 2, 3]);
    const g = group(2, 2, [1]);
    expect(g).toBeGreaterThan(0);
    const p = await pairProfile(1, at("2026-12-01T10:00:00Z"));
    expect(p!.groups.map((x) => [x.phase, x.group, x.division])).toEqual([
      [2, 2, "Réz divízió"],
      [1, 1, "Bronz divízió"],
    ]);
    const anna = await playerProfile("ua", at("2026-12-01T10:00:00Z"));
    expect(anna!.pairs[0]!.latest).toMatchObject({ phase: 2, group: 2, division: "Réz divízió" });
  });

  it("a withdrawn pair has no place, and its matches are marked as not counting", async () => {
    match(g1, 1, 2, 1, "final", played([[4, 1], [4, 2]]));
    h.raw.prepare("update group_pairs set withdrawn_at = ?, withdrawal_reason = 'titkos ok' where pair_id = 2").run(sec("2026-11-15T10:00:00Z"));
    const two = await pairProfile(2, DURING);
    expect(two!.groups[0]).toMatchObject({ place: null, withdrawn: true });
    expect(two!.matches[0]!.note).toBe("Visszalépés miatt nem számít a tabellába.");
    expect((await pairProfile(1, DURING))!.matches[0]!.note).toBe("Visszalépés miatt nem számít a tabellába.");
    expect(JSON.stringify(two)).not.toContain("titkos ok");
  });

  it("the player's rating, rounded, its history after each rated match, and the change on the match", async () => {
    const m1 = match(g1, 1, 2, 1, "final", played([[4, 1], [4, 2]]));
    const m2 = match(g1, 3, 1, 2, "final", played([[4, 2], [4, 2]]));
    eloChange(m1, "ua", 1400, 1416.6, "2026-11-11T10:00:00Z");
    eloChange(m2, "ua", 1416.6, 1412.4, "2026-11-18T10:00:00Z");
    const anna = await playerProfile("ua", DURING);
    expect(anna!.elo).toBe(1412);
    expect(anna!.eloHistory).toEqual([1400, 1417, 1412]);
    expect(anna!.matches.map((m) => [m.verdict, m.elo])).toEqual([
      ["Vereség", { delta: "−4", after: 1412 }],
      ["Győzelem", { delta: "+17", after: 1417 }],
    ]);
  });

  it("a substitute's match moves their rating and chart, but public pages keep the pair's names (D109)", async () => {
    // Emma (pair 3) plays for Bea in pair 1 v pair 2; the replay rates the four who played (#37).
    const m = match(g1, 1, 2, 1, "final", played([[4, 1], [4, 2]]));
    h.raw
      .prepare(
        "insert into match_substitutes (match_id, pair_id, absent_id, substitute_id, status, requested_at, decided_at) values (?, 1, 'ub', 'ue', 'approved', ?, ?)",
      )
      .run(m, sec("2026-11-10T10:00:00Z"), sec("2026-11-10T12:00:00Z"));
    for (const [u, before, after] of [["ua", 1400, 1420], ["ue", 1400, 1420], ["uc", 1200, 1180], ["ud", 1200, 1180]] as const) {
      eloChange(m, u, before, after, "2026-11-11T10:00:00Z");
      h.raw.prepare("update users set elo = ? where id = ?").run(after, u);
    }

    const emma = await playerProfile("ue", DURING);
    expect(emma).toMatchObject({ elo: 1420, eloHistory: [1400, 1420], matches: [] });
    const bea = await playerProfile("ub", DURING);
    expect(bea).toMatchObject({ elo: 1400, eloHistory: [] });
    expect(bea!.matches.map((x) => [x.verdict, x.elo])).toEqual([["Győzelem", null]]);
    const anna = await playerProfile("ua", DURING);
    expect(anna!.matches.map((x) => x.elo)).toEqual([{ delta: "+20", after: 1420 }]);
    // The match names pair 1 as Anna and Bea, on every page: never the substitute.
    const pages = [await pairProfile(1, DURING), await pairProfile(2, DURING), bea, anna, await playerProfile("uc", DURING)];
    for (const page of pages) {
      expect(JSON.stringify(page)).not.toMatch(/Emma|"ue"/);
    }
    expect((await playerProfile("uc", DURING))!.matches[0]!.opponents.players.map((p) => p.name)).toEqual(["Anna", "Bea"]);
  });

  it("before the first rated match the rating is the level's starting value", async () => {
    const cili = await playerProfile("uc", DURING);
    expect(cili).toMatchObject({ started: true, elo: 1200, eloHistory: [], matches: [] });
  });
});

describe("formerPairs: Korábbi párjaid on the own Profil (#347, D142)", () => {
  const dissolve = (id: number, iso: string) =>
    h.raw.prepare("update pairs set status = 'dissolved', dissolved_at = ?, dissolved_by = 'ua' where id = ?").run(sec(iso), id);
  // What "Partner cseréje" stores (changePartner): the old pair dissolved, a
  // new one, and the pair.change entry naming the old pair.
  function changePartner(oldPair: number, newPair: number, keep: string, partner: string, leaving: string, iso: string) {
    dissolve(oldPair, iso);
    pair(newPair, keep, partner);
    h.raw
      .prepare("insert into audit_log (actor_id, action, target, detail, at, league_id) values ('ua', 'pair.change', ?, ?, ?, 1)")
      .run(`pair:${newPair}`, `league:1; from pair:${oldPair}; user:${leaving} -> user:${partner}`, sec(iso));
  }

  it("a pair dissolved after playing: partner, pair page, league, rounds, Felbontva and the date", async () => {
    group(2, 1, [1, 3]);
    dissolve(1, "2026-12-21T10:00:00Z");
    expect(await formerPairs("ua")).toEqual([
      {
        pairId: 1,
        partner: { id: "ub", name: "Bea" },
        link: "/pairs/1",
        league: "Padelpárbaj Győr",
        rounds: "2026/27 tél, 1–2. kör",
        end: "Felbontva",
        endedOn: "2026. 12. 21.",
      },
    ]);
    // The same pair from the partner's side.
    expect((await formerPairs("ub")).map((p) => p.partner.name)).toEqual(["Anna"]);
  });

  it("the date is the Budapest day", async () => {
    dissolve(1, "2026-12-20T23:30:00Z");
    expect((await formerPairs("ua"))[0]!.endedOn).toBe("2026. 12. 21.");
  });

  it("after a partner change the old pair is Partnercsere, and the new one is not listed", async () => {
    user("ux", "Xénia");
    changePartner(2, 5, "uc", "ux", "ud", "2026-12-21T10:00:00Z");
    const cili = await formerPairs("uc");
    expect(cili.map((p) => [p.pairId, p.partner.name, p.end])).toEqual([[2, "Dóra", "Partnercsere"]]);
    expect((await formerPairs("ud")).map((p) => p.end)).toEqual(["Partnercsere"]);
    expect(await formerPairs("ux")).toEqual([]);
  });

  it("another pair's change does not mark this one", async () => {
    user("ux", "Xénia");
    pair(12, "ux", "ue");
    h.raw
      .prepare("insert into audit_log (actor_id, action, target, detail, league_id) values ('ua', 'pair.change', 'pair:13', 'league:1; from pair:12; user:ue -> user:uf', 1)")
      .run();
    dissolve(1, "2026-12-21T10:00:00Z");
    expect((await formerPairs("ua")).map((p) => p.end)).toEqual(["Felbontva"]);
  });

  it("only pairs that played in a published group, the newest ended first; active pairs are not listed", async () => {
    user("ug", "Gréta");
    user("uh", "Hanna");
    dissolve(1, "2026-12-21T10:00:00Z");
    // Pair 6 only ever in a draft; pair 7 played in phase 2 and ended later than pair 1.
    pair(6, "ua", "ug");
    group(1, 2, [6], false);
    dissolve(6, "2026-12-22T10:00:00Z");
    pair(7, "ua", "uh");
    group(2, 1, [7]);
    dissolve(7, "2027-01-10T10:00:00Z");
    expect((await formerPairs("ua")).map((p) => p.pairId)).toEqual([7, 1]);
    expect(await formerPairs("uc")).toEqual([]);
  });

  it("nothing from a league whose city is not listed, like the pair page", async () => {
    dissolve(1, "2026-12-21T10:00:00Z");
    h.raw.exec("update cities set listed = 0 where slug = 'gyor'");
    expect(await formerPairs("ua")).toEqual([]);
  });

  it("a deleted former partner is Törölt játékos without a link; no email or phone anywhere", async () => {
    dissolve(1, "2026-12-21T10:00:00Z");
    h.raw.prepare("update users set name = 'Törölt játékos', email = 'x@deleted.invalid', phone = null, deleted_at = ? where id = 'ub'").run(sec("2026-12-22T10:00:00Z"));
    const list = await formerPairs("ua");
    expect(list).toMatchObject([{ partner: { id: null, name: "Törölt játékos" }, link: null }]);
    user("ux", "Xénia");
    changePartner(2, 5, "uc", "ux", "ud", "2026-12-21T10:00:00Z");
    expect(JSON.stringify([list, await formerPairs("uc")])).not.toMatch(/titkos\.example|deleted\.invalid|@|\+36|30123|ub"/);
  });
});

it("carries no email, phone or withdrawal reason", async () => {
  match(g1, 1, 2, 1, "final", played([[4, 1], [4, 2]]));
  const text = JSON.stringify([await playerProfile("ua", DURING), await pairProfile(1, DURING), await pairProfile(2, DURING)]);
  expect(text).toContain("Anna");
  expect(text).not.toMatch(/titkos\.example|@|\+36|30123/);
});
