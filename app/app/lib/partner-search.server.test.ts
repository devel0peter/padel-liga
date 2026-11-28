// partner-search.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the "Párt keresek" switch and the Párkeresők list (D59).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, notified: [] as unknown[], mailed: [] as unknown[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({ listedCities: async () => [{ slug: "gyor" }] }));
vi.mock("~/lib/email/outbox.server", () => ({ queuePairCreated: async (...args: unknown[]) => void h.mailed.push(args) }));
vi.mock("~/lib/notifications.server", () => ({
  notifyPlayers: async (...args: unknown[]) => void h.notified.push(args),
  notifyNewSignup: async () => {},
}));

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
    expect(await S.partnerSearchState(user("a"), [GYOR])).toEqual(new Map([[1, { seeking: false, listed: false }]]));
    expect(await S.partnerSearchState(user("b"), [GYOR])).toEqual(new Map([[1, { seeking: false, listed: false }]]));
    expect(await S.partnerSearchState(user("c"), [GYOR])).toEqual(new Map([[1, { seeking: true, listed: false }]]));
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
    expect(await S.partnerSearchState(user("c"), [GYOR])).toEqual(new Map([[1, { seeking: false, listed: false }]]));
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

describe("Párkereső (#398, D177)", () => {
  const finder = (id: string, now = new Date()) => S.partnerFinder(user(id), 1, now);
  const single = async (id: string, now?: Date) => {
    const f = await finder(id, now);
    if (f?.kind !== "single") throw new Error(`not single: ${JSON.stringify(f)}`);
    return f;
  };
  const names = async (id: string) => (await single(id)).seekers.map((s) => s.name);

  beforeEach(() => {
    h.raw.exec(`update users set phone = '+36301234567' where id = 'a'`);
    h.raw.exec(`update users set phone = '+36207654321' where id = 'b'`);
  });

  it("two singles who both switched it on see each other with phone and email", async () => {
    await S.setPartnerSearch(user("a"), 1, true, [GYOR]);
    await S.setPartnerSearch(user("b"), 1, true, [GYOR]);
    const anna = await single("a");
    expect(anna.search).toEqual({ seeking: true, listed: true });
    expect(anna.seekers).toEqual([
      { id: "b", name: "Béla", level: "Kezdő", elo: null, looking: "ma óta keres", contact: { phone: "+36 20 765 4321", email: "b@x.hu" } },
    ]);
    expect((await single("b")).seekers).toEqual([
      expect.objectContaining({ id: "a", name: "Anna", level: "Haladó", contact: { phone: "+36 30 123 4567", email: "a@x.hu" } }),
    ]);
    // Nobody sees themselves; the pair link is the viewer's own, as on Kezdőlap.
    expect(anna.link).toMatch(/^\/pair\/join\/[\w-]+$/);
  });

  it("a single with the switch off sees the seekers without phone or email, and the switch-on lists them", async () => {
    await S.setPartnerSearch(user("a"), 1, true, [GYOR]);
    const bela = await single("b");
    expect(bela.search).toEqual({ seeking: false, listed: false });
    expect(bela.seekers).toEqual([expect.objectContaining({ id: "a", contact: null })]);
    expect(JSON.stringify(bela.seekers)).not.toMatch(/@|\+36|301234567/);
    // "Bekapcsolom a párkeresést" is the player's own switch-on.
    await S.setPartnerSearch(user("b"), 1, true, [GYOR]);
    expect((await single("b")).seekers[0].contact).toEqual({ phone: "+36 30 123 4567", email: "a@x.hu" });
    expect(await names("a")).toEqual(["Béla"]);
  });

  it("a switch from before isn't shown to other players until it's switched on again", async () => {
    // Cecil's row is from before #398: on, not listed.
    await S.setPartnerSearch(user("a"), 1, true, [GYOR]);
    expect(await names("a")).toEqual([]);
    expect(await ids()).toContain("c");
    // He sees the list, but no contact data: he isn't listed himself.
    const cecil = await single("c");
    expect(cecil.search).toEqual({ seeking: true, listed: false });
    expect(cecil.seekers).toEqual([expect.objectContaining({ id: "a", contact: null })]);
    await S.setPartnerSearch(user("c"), 1, true, [GYOR]);
    expect(await names("a")).toEqual(["Cecil"]);
    expect((await single("c")).seekers[0].contact).toEqual({ phone: "+36 30 123 4567", email: "a@x.hu" });
  });

  it("switching it off takes the player off the list and hides the others' contact data", async () => {
    await S.setPartnerSearch(user("a"), 1, true, [GYOR]);
    await S.setPartnerSearch(user("b"), 1, true, [GYOR]);
    await S.setPartnerSearch(user("b"), 1, false, [GYOR]);
    expect(await names("a")).toEqual([]);
    expect((await single("b")).seekers).toEqual([expect.objectContaining({ id: "a", contact: null })]);
    expect(h.raw.prepare("select seeking, listed from partner_searches where user_id = 'b'").get()).toEqual({ seeking: 0, listed: 0 });
  });

  it("an Admin's switch-on lists nobody, their switch-off unlists, and the player's own choice stays otherwise", async () => {
    await S.setPartnerSearch(user("b"), 1, true, [GYOR], "org");
    expect(h.raw.prepare("select seeking, listed from partner_searches where user_id = 'b'").get()).toEqual({ seeking: 1, listed: 0 });
    await S.setPartnerSearch(user("a"), 1, true, [GYOR]);
    expect(await names("a")).toEqual([]);
    // The organizer still sees every seeker on Játékosok.
    expect((await ids()).sort()).toEqual(["a", "b", "c"]);
    // Listed by her own switch, then the Admin switches it on again: still listed.
    await S.setPartnerSearch(user("a"), 1, true, [GYOR], "org");
    expect(await names("b")).toEqual(["Anna"]);
    await S.setPartnerSearch(user("a"), 1, false, [GYOR], "org");
    expect(h.raw.prepare("select seeking, listed from partner_searches where user_id = 'a'").get()).toEqual({ seeking: 0, listed: 0 });
  });

  it("a player with a pair gets no list, and a seeker who gets a pair drops off at once", async () => {
    await S.setPartnerSearch(user("a"), 1, true, [GYOR]);
    await S.setPartnerSearch(user("b"), 1, true, [GYOR]);
    await S.setPartnerSearch(user("c"), 1, true, [GYOR]);
    expect((await names("a")).sort()).toEqual(["Béla", "Cecil"]);
    await S.pairSeekers("org", LEAGUE, "b", "c");
    expect(await finder("b")).toEqual({ kind: "paired" });
    expect(await names("a")).toEqual([]);
    // Dissolved: listed again, as on Játékosok.
    h.raw.exec(`update pairs set status = 'dissolved'`);
    expect((await names("a")).sort()).toEqual(["Béla", "Cecil"]);
  });

  it("is nothing for a player of another league or an unfinished account, and lists no deleted or unregistered account", async () => {
    h.raw.exec(`insert into leagues (id, city, slug, name) values (2, 'gyor', 'gyor2', 'Győr 2')`);
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values ('d', 'd@x.hu', 'Dóra', 'kezdo', 1)").run();
    h.raw.exec(`insert into league_members (league_id, user_id, source) values (2, 'd', 'chosen')`);
    await S.setPartnerSearch(user("a"), 1, true, [GYOR]);
    expect(await finder("d")).toBeNull();
    expect(await S.partnerFinder(user("n", null), 1)).toBeNull();
    // A listed row of an account without the first-login page, and of a deleted one.
    h.raw.exec(`insert into league_members (league_id, user_id, source) values (1, 'n', 'chosen')`);
    h.raw.exec(`insert into partner_searches (league_id, user_id, seeking, listed) values (1, 'n', 1, 1)`);
    await S.setPartnerSearch(user("b"), 1, true, [GYOR]);
    h.raw.exec(`update users set deleted_at = 1 where id = 'b'`);
    expect(await names("a")).toEqual([]);
  });

  it("lists the newest first, with Élő-pont once rated and how long they have been looking", async () => {
    const at = (iso: string) => Date.parse(iso) / 1000;
    h.raw.exec(`insert into partner_searches (league_id, user_id, seeking, listed, updated_at) values
      (1, 'a', 1, 1, ${at("2026-11-24T08:00:00Z")}), (1, 'b', 1, 1, ${at("2026-11-21T08:00:00Z")})`);
    h.raw.exec(`update partner_searches set listed = 1, updated_at = ${at("2026-11-23T08:00:00Z")} where user_id = 'c'`);
    h.raw.exec(`update users set elo = 1234.6 where id = 'b'`);
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values ('e', 'e@x.hu', 'Edit', 'versenyzo', 1)").run();
    h.raw.exec(`insert into league_members (league_id, user_id, source) values (1, 'e', 'chosen')`);
    expect((await single("e", new Date("2026-11-24T12:00:00Z"))).seekers.map((s) => [s.name, s.elo, s.looking])).toEqual([
      ["Anna", null, "ma óta keres"],
      ["Cecil", null, "tegnap óta keres"],
      ["Béla", 1235, "3 napja keres"],
    ]);
  });
});
