// partner-search.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the "Párt keresek" switch and the Párkeresők list (D59).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, notified: [] as unknown[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({ listedCities: async () => [{ slug: "gyor" }] }));
vi.mock("~/lib/email/outbox.server", () => ({}));
vi.mock("~/lib/notifications.server", () => ({ notifyAccounts: async (...args: unknown[]) => void h.notified.push(args) }));

const { migratedDatabase } = await import("~/test/sqlite");
const S = await import("~/lib/partner-search.server");

const GYOR = { id: 1, name: "Padelpárbaj Győr" };
const LEAGUE = { id: 1, city: "gyor", name: "Padelpárbaj Győr" };
const user = (id: string, consentAt: Date | null = new Date()) => ({ id, email: `${id}@x.hu`, consentAt }) as any;
const ids = async () => (await S.leagueSeekers(LEAGUE)).map((s) => s.id);

beforeEach(() => {
  h.raw = migratedDatabase();
  h.notified = [];
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  for (const [id, name, level] of [
    ["a", "Anna", "halado"],
    ["b", "Béla", "kezdo"],
    ["c", "Cecil", "kezdo"],
  ])
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, ?, 1)").run(id, `${id}@x.hu`, name, level);
  h.raw.exec(`insert into users (id, email, name) values ('n', 'n@x.hu', ''), ('org', 'org@x.hu', 'Szervező')`);
  // Cecil signed up alone and still waits; Anna signed up as a pair.
  h.raw.exec(`insert into interest_signups (city, mode, name1, email1, level, consent_at, note) values
    ('gyor', 'solo', 'Cecil', 'C@x.hu', 'kezdo', 1, 'hétvégén'),
    ('gyor', 'pair', 'Anna', 'a@x.hu', 'halado', 1, null)`);
});

describe("Párt keresek on real SQLite (D59)", () => {
  it("is on by default for a waiting solo signup only", async () => {
    expect(await S.partnerSearchState(user("a"), [GYOR])).toEqual(new Map([[1, false]]));
    expect(await S.partnerSearchState(user("c"), [GYOR])).toEqual(new Map([[1, true]]));
    expect(await ids()).toEqual(["c"]);
    const [cecil] = await S.leagueSeekers(LEAGUE);
    expect(cecil).toMatchObject({ name: "Cecil", level: "kezdo", fromSignup: true, note: "hétvégén" });
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
    expect(h.raw.prepare("select count(*) as n from partner_searches").get()).toEqual({ n: 0 });
  });

  it("pairs two seekers at once, with a message and no email, and they leave the list", async () => {
    await S.setPartnerSearch(user("a"), 1, true, [GYOR]);
    expect(await S.pairSeekers("org", LEAGUE, "a", "c")).toEqual({ ok: true });
    expect(h.raw.prepare("select player_a, player_b, source, status from pairs").all()).toEqual([
      { player_a: "a", player_b: "c", source: "manual", status: "active" },
    ]);
    expect(h.notified).toHaveLength(1);
    expect((h.notified[0] as any)[1].map((m: any) => m.email).sort()).toEqual(["a@x.hu", "c@x.hu"]);
    expect(await ids()).toEqual([]);
    // A second try with one of them refuses, as on Párok.
    expect((await S.pairSeekers("org", LEAGUE, "a", "b")).ok).toBe(false);
  });

  it("a solo paired by a Szervező waits for the partner, then looks again if they have no pair", async () => {
    h.raw.exec(`insert into interest_signups (id, city, mode, name1, email1, level, consent_at, paired_with, status) values
      (10, 'gyor', 'solo', 'Béla', 'b@x.hu', 'kezdo', 1, 11, 'paired'),
      (11, 'gyor', 'solo', 'Zoli', 'z@x.hu', 'kezdo', 1, 10, 'paired')`);
    expect(await ids()).toEqual(["c"]);
    // Zoli registered and joined someone else: Béla is looking again.
    h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('z', 'z@x.hu', 'Zoli', 'kezdo', 1)`);
    h.raw.exec(`insert into pairs (league_id, player_a, player_b) values (1, 'z', 'a')`);
    expect(await ids()).toEqual(["b", "c"]);
  });

  it("lists a seeker again once the pair is dissolved", async () => {
    await S.pairSeekers("org", LEAGUE, "b", "c");
    h.raw.exec(`update pairs set status = 'dissolved'`);
    expect(await ids()).toEqual(["c"]);
  });
});
