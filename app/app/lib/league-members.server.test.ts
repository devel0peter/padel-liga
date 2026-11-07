// league-members.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): a league's players (D128, #331), each way of joining, and
// the release's backfill of today's players (migration 0053).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const M = await import("~/lib/league-members.server");

const all = (q: string) => h.raw.prepare(q).all();
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const NOW = new Date("2026-11-07T12:00:00Z");

// Győr (listed, a running season), Óvár (listed, registration open),
// Debrecen (listed, nothing open), Pécs (not listed, a running season).
function freshDb() {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('mmo', 'Mosonmagyaróvár', 1), ('deb', 'Debrecen', 1), ('pecs', 'Pécs', 0)`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values
    (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'mmo', 'ovar', 'Padelpárbaj Óvár'),
    (3, 'deb', 'deb', 'Padelpárbaj Debrecen'), (4, 'pecs', 'pecs', 'Padelpárbaj Pécs')`);
  const season = (id: number, league: number, opens: string, first: string) => {
    h.raw
      .prepare("insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (?, ?, 'Tél', ?, ?, ?)")
      .run(id, league, sec(opens), sec(first), first.slice(0, 10));
    h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (?, 1, ?, ?)").run(id, sec(first), sec(first) + 21 * 86400);
  };
  season(1, 1, "2026-10-28T23:00:00Z", "2026-11-08T23:00:00Z");
  season(2, 2, "2026-11-05T23:00:00Z", "2026-12-06T23:00:00Z");
  season(3, 3, "2026-12-01T23:00:00Z", "2027-01-03T23:00:00Z");
  season(4, 4, "2026-10-28T23:00:00Z", "2026-11-08T23:00:00Z");
  for (const id of ["a", "b", "c"]) h.raw.prepare("insert into users (id, email, name, consent_at) values (?, ?, ?, 1)").run(id, `${id}@x.hu`, id);
  // Started an account, first-login page not done.
  h.raw.exec(`insert into users (id, email, name) values ('n', 'n@x.hu', '')`);
}

beforeEach(freshDb);

describe("a league's players (D128)", () => {
  it("belongs to no league until joining one; a pair of the league counts too, also a dissolved one", async () => {
    expect(await M.memberLeagueIds("a")).toEqual(new Set());
    expect(await M.playerLeagues("a")).toEqual([]);
    h.raw.exec(`insert into pairs (league_id, player_a, player_b, status) values (2, 'b', 'a', 'dissolved')`);
    expect(await M.memberLeagueIds("a")).toEqual(new Set([2]));
    expect((await M.playerLeagues("a")).map((l) => l.id)).toEqual([2]);
  });

  it("lists only leagues of listed cities for the player", async () => {
    h.raw.exec(`insert into league_members (league_id, user_id, source) values (4, 'a', 'chosen'), (1, 'a', 'chosen')`);
    expect(await M.memberLeagueIds("a")).toEqual(new Set([1, 4]));
    expect(await M.playerLeagues("a")).toEqual([{ id: 1, name: "Padelpárbaj Győr", slug: "gyor", city: "gyor" }]);
  });
});

describe("joining through the register button (#331 requirement 1)", () => {
  it("joins the league of the slug, once, audited with the account as the actor", async () => {
    await M.joinFromRegisterButton("n", "gyor");
    await M.joinFromRegisterButton("n", "gyor");
    expect(all("select league_id, user_id, source from league_members")).toEqual([{ league_id: 1, user_id: "n", source: "register" }]);
    expect(all("select actor_id, action, target, detail, league_id from audit_log")).toEqual([
      { actor_id: "n", action: "league.join", target: "user:n", detail: "league:1; register", league_id: 1 },
    ]);
  });

  it("ignores an unknown slug, a league of an unlisted city and no slug", async () => {
    await M.joinFromRegisterButton("a", "nincs");
    await M.joinFromRegisterButton("a", "pecs");
    await M.joinFromRegisterButton("a", null);
    expect(all("select * from league_members")).toEqual([]);
    expect(all("select * from audit_log")).toEqual([]);
  });

  it("joins only that league: the account is no other league's player", async () => {
    await M.joinFromRegisterButton("a", "ovar");
    expect(await M.memberLeagueIds("a")).toEqual(new Set([2]));
  });
});

describe("Melyik ligában játszol? (#331 requirement 1)", () => {
  it("offers the listed leagues with an open or running season to a player in none", async () => {
    expect((await M.leagueChoices("a", NOW)).map((l) => [l.id, l.cityName, l.name])).toEqual([
      [1, "Győr", "Padelpárbaj Győr"],
      [2, "Mosonmagyaróvár", "Padelpárbaj Óvár"],
    ]);
  });

  it("offers nothing to a player who belongs to a league", async () => {
    h.raw.exec(`insert into league_members (league_id, user_id, source) values (3, 'a', 'chosen')`);
    expect(await M.leagueChoices("a", NOW)).toEqual([]);
    h.raw.exec(`insert into pairs (league_id, player_a, player_b) values (1, 'b', 'c')`);
    expect(await M.leagueChoices("b", NOW)).toEqual([]);
  });

  it("with one league open, offers that one", async () => {
    h.raw.exec(`delete from seasons where id = 2`);
    expect((await M.leagueChoices("a", NOW)).map((l) => l.id)).toEqual([1]);
  });

  it("joins a listed league, audited; refuses an unlisted or unknown one", async () => {
    expect(await M.chooseLeague("a", 4)).toBe(false);
    expect(await M.chooseLeague("a", 99)).toBe(false);
    expect(await M.chooseLeague("a", 2)).toBe(true);
    expect(all("select league_id, user_id, source from league_members")).toEqual([{ league_id: 2, user_id: "a", source: "chosen" }]);
    expect(all("select actor_id, action, detail from audit_log")).toEqual([{ actor_id: "a", action: "league.join", detail: "league:2; chosen" }]);
    // A further league, as its register button offers it (D128).
    expect(await M.chooseLeague("a", 3)).toBe(true);
    expect(await M.memberLeagueIds("a")).toEqual(new Set([2, 3]));
  });
});

describe("the register button's league for a logged-in visitor (D128)", () => {
  it("is offered while they don't belong to it, even without an open season; nothing is joined", async () => {
    expect(await M.leagueOffer("a", "deb")).toEqual({ id: 3, city: "deb", cityName: "Debrecen", name: "Padelpárbaj Debrecen" });
    expect(all("select * from league_members")).toEqual([]);
  });

  it("is not offered to a member, nor for an unlisted, unknown or missing league", async () => {
    h.raw.exec(`insert into league_members (league_id, user_id, source) values (1, 'a', 'chosen')`);
    expect(await M.leagueOffer("a", "gyor")).toBeNull();
    expect(await M.leagueOffer("a", "pecs")).toBeNull();
    expect(await M.leagueOffer("a", "nincs")).toBeNull();
    expect(await M.leagueOffer("a", null)).toBeNull();
  });
});

describe("the release's backfill (migration 0053, #331 requirement 3)", () => {
  // The migration's INSERT statements, run again on rows made after it.
  function backfill() {
    const { readFileSync } = (globalThis as any).process.getBuiltinModule("node:fs");
    const file = readFileSync(new URL("../../drizzle/0053_league_members.sql", import.meta.url), "utf8") as string;
    for (const stmt of file.split("--> statement-breakpoint")) if (/^\s*(--.*\n\s*)*INSERT/.test(stmt)) h.raw.exec(stmt);
  }
  const signup = (city: string, mode: string, email1: string, v: { email2?: string; status?: string; pairedWith?: number; id?: number; at?: number } = {}) =>
    h.raw
      .prepare(
        "insert into interest_signups (id, city, mode, name1, email1, email2, level, status, paired_with, consent_at, created_at) values (?, ?, ?, 'x', ?, ?, 'kezdo', ?, ?, 1, ?)",
      )
      .run(v.id ?? null, city, mode, email1, v.email2 ?? null, v.status ?? "new", v.pairedWith ?? null, v.at ?? 100);
  const user = (id: string, v: { consent?: boolean; deleted?: boolean } = {}) =>
    h.raw
      .prepare("insert into users (id, email, name, consent_at, deleted_at) values (?, ?, ?, ?, ?)")
      .run(id, `${id}@x.hu`, id, v.consent === false ? null : 50, v.deleted ? 60 : null);
  const members = () => all("select league_id, user_id, source from league_members order by league_id, user_id");

  it("keeps every D93 player of Győr: no signup, a Győr signup (either address, withdrawn too); others elsewhere", async () => {
    h.raw.exec(`delete from users`);
    user("nosignup");
    user("gy1");
    user("gy2");
    user("gyw");
    user("other");
    user("ovar");
    user("both");
    user("unfinished", { consent: false });
    user("gone", { deleted: true });
    signup("gyor", "pair", "X@x.hu", { email2: "GY2@x.hu" });
    signup("gyor", "solo", "gy1@x.hu");
    signup("gyor", "solo", "gyw@x.hu", { status: "withdrawn" });
    signup("other", "solo", "other@x.hu");
    signup("mmo", "solo", "ovar@x.hu");
    signup("mmo", "solo", "both@x.hu");
    signup("gyor", "solo", "both@x.hu");
    backfill();
    expect(members()).toEqual([
      { league_id: 1, user_id: "both", source: "carried" },
      { league_id: 1, user_id: "gy1", source: "carried" },
      { league_id: 1, user_id: "gy2", source: "carried" },
      { league_id: 1, user_id: "gyw", source: "carried" },
      { league_id: 1, user_id: "nosignup", source: "carried" },
      { league_id: 2, user_id: "both", source: "carried" },
      { league_id: 2, user_id: "ovar", source: "carried" },
    ]);
  });

  it("adds the players of a league's pairs, with an entry first; nobody twice; leaves existing rows alone", async () => {
    h.raw.exec(`insert into users (id, email, name) values ('d', 'd@x.hu', 'd')`);
    // a, b: an entered pair of Óvár; c, d: a dissolved pair of Debrecen; a already joined Győr.
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, created_at) values (1, 2, 'a', 'b', 10), (2, 3, 'c', 'd', 20)`);
    h.raw.exec(`update pairs set status = 'dissolved' where id = 2`);
    h.raw.exec(`insert into season_entries (season_id, pair_id) values (2, 1)`);
    h.raw.exec(`insert into league_members (league_id, user_id, source, joined_at) values (1, 'a', 'chosen', 5)`);
    // Everyone without a signup is a Győr player (D93 carried over); n hasn't
    // finished the first-login page.
    backfill();
    expect(members()).toEqual([
      { league_id: 1, user_id: "a", source: "chosen" },
      { league_id: 1, user_id: "b", source: "carried" },
      { league_id: 1, user_id: "c", source: "carried" },
      { league_id: 2, user_id: "a", source: "entry" },
      { league_id: 2, user_id: "b", source: "entry" },
      { league_id: 3, user_id: "c", source: "pair" },
      { league_id: 3, user_id: "d", source: "pair" },
    ]);
    backfill();
    expect(members()).toHaveLength(7);
  });

  it("keeps on Párkeresők whoever looks for a partner there, wherever their signups were (#333)", async () => {
    h.raw.exec(`delete from users`);
    user("far");
    user("off");
    user("gone", { deleted: true });
    // Signed up for another city, but switched "Párt keresek" on in Győr and
    // Óvár: Párkeresők listed every seeker, so they stay there.
    signup("other", "solo", "far@x.hu");
    signup("other", "solo", "off@x.hu");
    signup("other", "solo", "gone@x.hu");
    h.raw.exec(`insert into partner_searches (league_id, user_id, seeking, updated_at) values
      (1, 'far', 1, 70), (2, 'far', 1, 80), (1, 'off', 0, 70), (1, 'gone', 1, 70)`);
    backfill();
    expect(all("select league_id, user_id, source, joined_at from league_members order by league_id, user_id")).toEqual([
      { league_id: 1, user_id: "far", source: "carried", joined_at: 70 },
      { league_id: 2, user_id: "far", source: "carried", joined_at: 80 },
    ]);
  });

  it("stores 'Párt keresek' on for whoever is on today only by the old default (#333), and keeps stored choices", async () => {
    h.raw.exec(`delete from users`);
    for (const id of ["wait", "pairedreg", "pairedwait", "partner", "chose", "pairsign", "withdrawn", "away"]) user(id);
    user("unreg", { consent: false });
    // Waiting solo: on. Paired with a solo whose person registered: on.
    signup("gyor", "solo", "Wait@x.hu", { at: 300 });
    signup("gyor", "solo", "wait@x.hu", { at: 200 });
    signup("gyor", "solo", "pairedreg@x.hu", { id: 10, pairedWith: 11 });
    signup("gyor", "solo", "partner@x.hu", { id: 11, pairedWith: 10 });
    // Paired with a solo whose person hasn't registered: off (waits for them).
    signup("gyor", "solo", "pairedwait@x.hu", { id: 12, pairedWith: 13 });
    signup("gyor", "solo", "nobody@x.hu", { id: 13, pairedWith: 12 });
    // Said off themselves: stays off. A pair signup, a withdrawn solo, a
    // solo in another city, an unfinished account: no row.
    signup("gyor", "solo", "chose@x.hu");
    h.raw.exec(`insert into partner_searches (league_id, user_id, seeking, updated_at) values (1, 'chose', 0, 7)`);
    signup("gyor", "pair", "pairsign@x.hu");
    signup("gyor", "solo", "withdrawn@x.hu", { status: "withdrawn" });
    signup("mmo", "solo", "away@x.hu");
    signup("gyor", "solo", "unreg@x.hu");
    backfill();
    expect(all("select league_id, user_id, seeking, updated_at from partner_searches order by league_id, user_id")).toEqual([
      { league_id: 1, user_id: "chose", seeking: 0, updated_at: 7 },
      { league_id: 1, user_id: "pairedreg", seeking: 1, updated_at: 100 },
      { league_id: 1, user_id: "partner", seeking: 1, updated_at: 100 },
      { league_id: 1, user_id: "wait", seeking: 1, updated_at: 200 },
      { league_id: 2, user_id: "away", seeking: 1, updated_at: 100 },
    ]);
  });
});
