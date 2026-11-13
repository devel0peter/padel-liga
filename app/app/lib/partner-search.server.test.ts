// partner-search.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the "Párt keresek" switch and the Párkeresők list (D59).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, notified: [] as unknown[], mailed: [] as unknown[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({ listedCities: async () => [{ slug: "gyor" }] }));
vi.mock("~/lib/email/outbox.server", () => ({ queuePairCreated: async (...args: unknown[]) => void h.mailed.push(args) }));
vi.mock("~/lib/notifications.server", () => ({ notifyPlayers: async (...args: unknown[]) => void h.notified.push(args) }));

const { migratedDatabase } = await import("~/test/sqlite");
const S = await import("~/lib/partner-search.server");

const GYOR = { id: 1, name: "Padelpárbaj Győr" };
const LEAGUE = { id: 1, city: "gyor", name: "Padelpárbaj Győr" };
const user = (id: string, consentAt: Date | null = new Date()) => ({ id, email: `${id}@x.hu`, consentAt }) as any;
const ids = async () => (await S.leagueSeekers(LEAGUE)).map((s) => s.id);

beforeEach(() => {
  h.raw = migratedDatabase();
  h.notified = [];
  h.mailed = [];
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  for (const [id, name, level] of [
    ["a", "Anna", "halado"],
    ["b", "Béla", "kezdo"],
    ["c", "Cecil", "kezdo"],
  ])
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, ?, 1)").run(id, `${id}@x.hu`, name, level);
  h.raw.exec(`insert into users (id, email, name) values ('n', 'n@x.hu', ''), ('org', 'org@x.hu', 'Szervező')`);
  // Anna, Béla and Cecil joined the league (D128).
  h.raw.exec(`insert into league_members (league_id, user_id, source) values (1, 'a', 'chosen'), (1, 'b', 'chosen'), (1, 'c', 'chosen')`);
  // Cecil looks for a partner (the release stored his old solo-signup default
  // as a row, #333); Béla signed up alone too, but has no row: off.
  h.raw.exec(`insert into partner_searches (league_id, user_id, seeking, updated_at) values (1, 'c', 1, 100)`);
  h.raw.exec(`insert into interest_signups (city, mode, name1, email1, level, consent_at, note) values
    ('gyor', 'solo', 'Béla', 'b@x.hu', 'kezdo', 1, 'hétvégén')`);
});

describe("Párt keresek on real SQLite (D59)", () => {
  it("is off until switched on, whatever the interest list says (#333)", async () => {
    expect(await S.partnerSearchState(user("a"), [GYOR])).toEqual(new Map([[1, false]]));
    expect(await S.partnerSearchState(user("b"), [GYOR])).toEqual(new Map([[1, false]]));
    expect(await S.partnerSearchState(user("c"), [GYOR])).toEqual(new Map([[1, true]]));
    expect(await ids()).toEqual(["c"]);
    // Name, level, phone and since when; nothing from a signup.
    expect(await S.leagueSeekers(LEAGUE)).toEqual([{ id: "c", name: "Cecil", level: "kezdo", phone: "", since: new Date(100_000) }]);
  });

  it("gives the organizer each seeker's phone number, formatted (D126)", async () => {
    h.raw.exec(`update users set phone = '+36301234567' where id = 'c'`);
    const [cecil] = await S.leagueSeekers(LEAGUE);
    expect(cecil.phone).toBe("+36 30 123 4567");
    expect(cecil).not.toHaveProperty("email");
  });

  it("follows the switch, both ways, and lists by level", async () => {
    expect(await S.setPartnerSearch(user("a"), 1, true, [GYOR])).toBe(true);
    expect(await S.setPartnerSearch(user("b"), 1, true, [GYOR])).toBe(true);
    expect(await S.setPartnerSearch(user("c"), 1, false, [GYOR])).toBe(true);
    expect(await ids()).toEqual(["b", "a"]);
    expect(await S.partnerSearchState(user("c"), [GYOR])).toEqual(new Map([[1, false]]));
    await S.setPartnerSearch(user("a"), 1, false, [GYOR]);
    expect(await ids()).toEqual(["b"]);
    expect(h.raw.prepare("select action from audit_log order by id").all().map((r: any) => r.action)).toEqual([
      "partner_search.on",
      "partner_search.on",
      "partner_search.off",
      "partner_search.off",
    ]);
  });

  it("refuses an unfinished account and an unknown league", async () => {
    expect(await S.setPartnerSearch(user("n", null), 1, true, [GYOR])).toBe(false);
    expect(await S.setPartnerSearch(user("a"), 2, true, [GYOR])).toBe(false);
    expect(h.raw.prepare("select count(*) as n from partner_searches where user_id <> 'c'").get()).toEqual({ n: 0 });
  });

  it("pairs two seekers at once, with a message and an email (#260), and they leave the list", async () => {
    await S.setPartnerSearch(user("a"), 1, true, [GYOR]);
    expect(await S.pairSeekers("org", LEAGUE, "a", "c")).toEqual({ ok: true });
    expect(h.raw.prepare("select player_a, player_b, source, status from pairs").all()).toEqual([
      { player_a: "a", player_b: "c", source: "search", status: "active" },
    ]);
    expect(h.notified).toHaveLength(1);
    expect((h.notified[0] as any)[1].map((m: any) => m.userId).sort()).toEqual(["a", "c"]);
    expect(h.mailed).toHaveLength(1);
    expect((h.mailed[0] as any)[0].map((m: any) => m.toEmail).sort()).toEqual(["a@x.hu", "c@x.hu"]);
    expect(await ids()).toEqual([]);
    // A second try with one of them refuses, as on Párok.
    expect((await S.pairSeekers("org", LEAGUE, "a", "b")).ok).toBe(false);
  });

  it("lists a seeker again once the pair is dissolved", async () => {
    await S.pairSeekers("org", LEAGUE, "b", "c");
    h.raw.exec(`update pairs set status = 'dissolved'`);
    expect(await ids()).toEqual(["c"]);
  });
});

describe("the league's seekers (D128)", () => {
  it("lists only the league's players (D128): someone who joined another league isn't a seeker here", async () => {
    h.raw.exec(`insert into leagues (id, city, slug, name) values (2, 'mmo', 'mmo', 'Óvár')`);
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values ('d', 'd@x.hu', 'Dóra', 'kezdo', 1)").run();
    h.raw.exec(`insert into league_members (league_id, user_id, source) values (2, 'd', 'chosen')`);
    h.raw.exec(`insert into partner_searches (league_id, user_id, seeking) values (1, 'd', 1), (2, 'd', 1)`);
    expect(await ids()).not.toContain("d");
    expect((await S.leagueSeekers({ id: 2 })).map((s) => s.id)).toEqual(["d"]);
  });
});
