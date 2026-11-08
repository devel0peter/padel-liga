// The profile page's level lock and Élő-pont (#135) on a real SQLite
// (~/test/sqlite) with the real session lookup.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as unknown[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
// Deleting the account (#38) must queue no mail.
vi.mock("~/lib/email/outbox.server", () => ({
  queueSeasonEntryDecision: async (...a: unknown[]) => h.mails.push(a),
  queueGroupsPublished: async (...a: unknown[]) => h.mails.push(a),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { createSession } = await import("~/lib/auth/session.server");
const P = await import("~/routes/profile");

const args = (request: Request) => ({ request, params: {}, context: {} }) as any;
const get = (cookie: string) => new Request("http://localhost/profile", { headers: { Cookie: cookie } });
const post = (cookie: string, fields: Record<string, string>) =>
  new Request("http://localhost/profile", {
    method: "POST",
    headers: { Cookie: cookie },
    body: new URLSearchParams({ intent: "profile", name: "Nagy Anna", phone: "+36 30 123 4567", sex: "female", ...fields }),
  });
const level = (id: string) => h.raw.prepare("select level from users where id = ?").get(id).level as string;

describe("Profil: level lock and Élő-pont", () => {
  let placed: string;
  let free: string;

  beforeEach(async () => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győr')`);
    h.raw.exec(`insert into users (id, email, name, level, phone, sex, consent_at) values
      ('placed', 'p@x.hu', 'Nagy Anna', 'halado', '+36301234567', 'female', 1),
      ('mate', 'm@x.hu', 'Kis Béla', 'kezdo', '+36301234568', 'male', 1),
      ('free', 'f@x.hu', 'Nagy Anna', 'kozephalado', '+36301234569', 'female', 1),
      ('nolevel', 'n@x.hu', 'Nagy Anna', null, '+36301234570', 'female', 1)`);
    h.raw.exec(`insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start)
      values (1, 1, 'Tél', 1, 2, '2026-11-09')`);
    h.raw.exec(`insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, 1000), (2, 1, 1, 2, null)`);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status) values (1, 1, 'placed', 'mate', 'active'), (2, 1, 'free', 'nolevel', 'active')`);
    // Only the first pair sits in a published group; the second in a draft.
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1), (2, 2, 1)`);
    placed = (await createSession("placed")).split(";")[0]!;
    free = (await createSession("free")).split(";")[0]!;
  });

  it("a player who hasn't taken part changes the level, and it is saved", async () => {
    expect(await P.action(args(post(free, { level: "versenyzo" })))).toMatchObject({ saved: true });
    expect(level("free")).toBe("versenyzo");
  });

  it("a player placed in a published group sees the level read-only", async () => {
    expect(await P.loader(args(get(placed)))).toMatchObject({ level: "halado", levelLocked: true });
    expect(await P.loader(args(get(free)))).toMatchObject({ levelLocked: false });
  });

  it("refuses a hand-made post that changes a locked level, in Hungarian, and keeps it", async () => {
    const refused: any = await P.action(args(post(placed, { level: "versenyzo" })));
    expect(refused.init.status).toBe(400);
    expect(refused.data.saved).toBe(false);
    expect(refused.data.errors.level).toMatch(/nem módosíthatod/);
    expect(level("placed")).toBe("halado");
  });

  it("saves the other fields of a locked player, without a level in the form or with the same one", async () => {
    expect(await P.action(args(post(placed, { name: "Új Anna" })))).toMatchObject({ saved: true });
    expect(await P.action(args(post(placed, { name: "Újabb Anna", level: "halado" })))).toMatchObject({ saved: true });
    expect(h.raw.prepare("select name, level from users where id = 'placed'").get()).toEqual({ name: "Újabb Anna", level: "halado" });
  });

  it("shows the starting Élő-pont of the level, nothing without one", async () => {
    expect(await P.loader(args(get(placed)))).toMatchObject({ rating: 1400 });
    expect(await P.loader(args(get(free)))).toMatchObject({ rating: 1200 });
    const nolevel = (await createSession("nolevel")).split(";")[0]!;
    expect(await P.loader(args(get(nolevel)))).toMatchObject({ rating: null });
  });
});

// Fiók törlése (#38): the dialog's text comes from the loader; the action
// runs the Admin's deletion (#152) on the player's own account, ends every
// session and lands logged out on the home page.
describe("Profil: Fiók törlése", () => {
  const del = (cookie: string) =>
    new Request("http://localhost/profile", { method: "POST", headers: { Cookie: cookie }, body: new URLSearchParams({ intent: "delete-account" }) });
  const count = (q: string) => h.raw.prepare(q).get().n as number;
  let free: string;
  let placed: string;

  afterEach(() => expect(h.mails).toEqual([]));

  beforeEach(async () => {
    h.raw = migratedDatabase();
    h.mails = [];
    h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győr')`);
    h.raw.exec(`insert into users (id, email, name, level, phone, sex, consent_at, platform_role) values
      ('free', 'f@x.hu', 'Kis Fanni', 'kezdo', '+36301234569', 'female', 1, 'player'),
      ('placed', 'p@x.hu', 'Nagy Anna', 'halado', '+36301234567', 'female', 1, 'player'),
      ('mate', 'm@x.hu', 'Kis Béla', 'kezdo', '+36301234568', 'male', 1, 'player'),
      ('admin', 'a@x.hu', 'Admin', 'halado', '+36301234560', 'male', 1, 'superadmin')`);
    h.raw.exec(`insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start)
      values (1, 1, 'Tél', 1, 2, '2026-11-09')`);
    // Phase 1 ended long ago: a pair placed in it is history, not playing.
    h.raw.exec(`insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, 1, 2)`);
    h.raw.exec(`insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, 1000)`);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status) values (1, 1, 'placed', 'mate', 'active')`);
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1)`);
    // 'free' is a Szervező.
    h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'free')`);
    free = (await createSession("free")).split(";")[0]!;
    placed = (await createSession("placed")).split(";")[0]!;
  });

  it("says what happens: everything goes without history, the name stays anonymized with it", async () => {
    const f: any = await P.loader(args(get(free)));
    expect(f.deletion.effect).toMatch(/^Még nem szerepeltél a ligában, ezért minden adatod törlődik/);
    expect(f.deletion.effect).toContain("A szervezői jogaid is megszűnnek.");
    expect(f.deletion.effect).toContain("Nem vonható vissza.");
    const p: any = await P.loader(args(get(placed)));
    expect(p.deletion.effect).toMatch(/^Már szerepeltél a ligában, ezért a fiókod névtelen lesz: a neved helyén „Törölt játékos” áll/);
    expect(p.deletion.effect).not.toContain("szervezői");
  });

  it("deletes the account, ends every session and lands logged out on the home page", async () => {
    const other = (await createSession("free")).split(";")[0]!;
    const res = (await P.action(args(del(free)))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/?accountDeleted=1");
    expect(res.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    expect(count("select count(*) n from users where id = 'free'")).toBe(0);
    expect(count("select count(*) n from league_admins")).toBe(0);
    // Neither device is logged in any more.
    for (const cookie of [free, other]) {
      const thrown: any = await P.loader(args(get(cookie))).catch((e) => e);
      expect(thrown).toBeInstanceOf(Response);
      expect(thrown.headers.get("Location")).toMatch(/^\/login\?/);
    }
  });

  it("anonymizes an account with history; the pair's group place stays", async () => {
    // A second device: only the batch's session delete logs it out.
    const other = (await createSession("placed")).split(";")[0]!;
    const res = (await P.action(args(del(placed)))) as Response;
    expect(res.headers.get("Location")).toBe("/?accountDeleted=1");
    expect(h.raw.prepare("select name, email, phone from users where id = 'placed'").get()).toEqual({
      name: "Törölt játékos",
      email: "deleted-placed@deleted.invalid",
      phone: null,
    });
    expect(count("select count(*) n from group_pairs where pair_id = 1")).toBe(1);
    expect(count("select count(*) n from sessions where user_id = 'placed'")).toBe(0);
    const thrown: any = await P.loader(args(get(other))).catch((e) => e);
    expect(thrown.headers.get("Location")).toMatch(/^\/login\?/);
  });

  it("refuses the Admin, in Hungarian, and changes nothing", async () => {
    const admin = (await createSession("admin")).split(";")[0]!;
    const shown: any = await P.loader(args(get(admin)));
    expect(shown.deletion).toEqual({ refused: "Adminként a saját fiókodat nem törölheted." });
    const refused: any = await P.action(args(del(admin)));
    expect(refused.init.status).toBe(409);
    expect(refused.data.deleteError).toBe("Adminként a saját fiókodat nem törölheted.");
    expect(count("select count(*) n from sessions where user_id = 'admin'")).toBe(1);
  });
});

// Párod (D141, #346: the Párom page before) and Korábbi párjaid (D142, #347)
// on the Játékosprofil tab: the loader's data and the section's own posts.
describe("Profil: Párod and Korábbi párjaid", () => {
  let anna: string;
  let lone: string;
  const form = (cookie: string, fields: Record<string, string>) =>
    new Request("http://localhost/profile", { method: "POST", headers: { Cookie: cookie }, body: new URLSearchParams(fields) });

  beforeEach(async () => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
    h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'gyor', 'gyor2', 'Padelpárbaj Győr 2')`);
    h.raw.exec(`insert into users (id, email, name, level, phone, sex, consent_at) values
      ('anna', 'anna@x.hu', 'Nagy Anna', 'halado', '+36301234567', 'female', 1),
      ('bela', 'bela@x.hu', 'Kis Béla', 'kezdo', '+36301234568', 'male', 1),
      ('cili', 'cili@x.hu', 'Kovács Cili', 'kezdo', '+36301234569', 'female', 1),
      ('lone', 'lone@x.hu', 'Magányos Lili', 'kezdo', null, 'female', 1)`);
    h.raw.exec(`insert into league_members (league_id, user_id, source) values (1, 'lone', 'chosen')`);
    h.raw.exec(`insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start)
      values (1, 1, '2026/27 tél', 1, 2, '2026-11-09')`);
    h.raw.exec(`insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, 1762642800, 1764456000)`);
    h.raw.exec(`insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, 1000)`);
    // Anna played round 1 with Cili, then the organizer changed her partner to Béla.
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status, dissolved_at) values (1, 1, 'anna', 'cili', 'dissolved', 1765000000)`);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status) values (2, 1, 'anna', 'bela', 'active')`);
    h.raw.exec(`insert into audit_log (actor_id, action, target, detail, league_id) values ('anna', 'pair.change', 'pair:2', 'league:1; from pair:1; user:cili -> user:bela', 1)`);
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1)`);
    anna = (await createSession("anna")).split(";")[0]!;
    lone = (await createSession("lone")).split(";")[0]!;
  });

  it("Párod: one league, the active partner with email and phone", async () => {
    const d: any = await P.loader(args(get(anna)));
    expect(d.pair.multi).toBe(false);
    expect(d.pair.overview).toEqual([
      expect.objectContaining({
        league: expect.objectContaining({ id: 1, name: "Padelpárbaj Győr" }),
        pair: { id: 2, partnerName: "Kis Béla", partnerEmail: "bela@x.hu", partnerPhone: "+36 30 123 4568" },
        link: null,
        seeking: null,
      }),
    ]);
  });

  it("Korábbi párjaid: the old pair as Partnercsere, without the former partner's email or phone", async () => {
    const d: any = await P.loader(args(get(anna)));
    expect(d.former).toEqual([
      {
        pairId: 1,
        partner: { id: "cili", name: "Kovács Cili" },
        link: "/pairs/1",
        league: "Padelpárbaj Győr",
        rounds: "2026/27 tél, 1. kör",
        end: "Partnercsere",
        endedOn: "2025. 12. 06.",
      },
    ]);
    expect(JSON.stringify(d.former)).not.toMatch(/cili@x\.hu|\+36|3012345/);
  });

  it("two leagues: a card for each, without a pair the pair link and Párt keresek", async () => {
    h.raw.exec(`insert into league_members (league_id, user_id, source) values (2, 'lone', 'chosen')`);
    const d: any = await P.loader(args(get(lone)));
    expect(d.pair.multi).toBe(true);
    expect(d.pair.overview.map((o: any) => [o.league.name, o.pair, o.seeking])).toEqual([
      ["Padelpárbaj Győr", null, false],
      ["Padelpárbaj Győr 2", null, false],
    ]);
    expect(d.pair.overview.every((o: any) => /\/pair\/join\/[\w-]+$/.test(o.link))).toBe(true);
    expect(d.former).toEqual([]);
  });

  it("Párt keresek posts to Profil and is saved per league", async () => {
    expect(await P.action(args(form(lone, { intent: "partner_search", league: "1", seeking: "1" })))).toEqual({ intent: "partner_search", ok: true });
    expect(h.raw.prepare("select seeking from partner_searches where user_id = 'lone' and league_id = 1").get().seeking).toBe(1);
    const d: any = await P.loader(args(get(lone)));
    expect(d.pair.overview[0].seeking).toBe(true);
    // Not a league of hers: refused.
    const refused: any = await P.action(args(form(lone, { intent: "partner_search", league: "2", seeking: "1" }))).catch((e) => e);
    expect(refused.status).toBe(400);
  });

  it("the old address's ?joined=1 shows the accepted pair link's line", async () => {
    const d: any = await P.loader(args(new Request("http://localhost/profile?joined=1", { headers: { Cookie: anna } })));
    expect(d.pair.joined).toBe(true);
    expect(((await P.loader(args(get(anna)))) as any).pair.joined).toBe(false);
  });
});
