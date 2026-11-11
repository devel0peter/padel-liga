// The Admin's player profile, /admin/users/:id (#301, D156), on a real
// SQLite (~/test/sqlite) with the real session lookup: Admin only, page and
// action alike; the facts, pairs and Napló entries about the player; the
// edit (audited, D79's level lock kept); "Párt keresek"; "Levél neki".
// Email is captured, never sent.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/background.server", () => import("~/test/background"));
vi.mock("~/lib/cities.server", async (orig) => ({ ...(await orig<any>()), listedCities: async () => [{ slug: "gyor" }] }));
vi.mock("~/lib/email/send.server", () => ({
  MAX_BATCH: 100,
  relayConfigured: () => false,
  sendEmails: async (emails: any[]) => {
    h.sent.push(...emails);
    return emails.map((_, i) => ({ ok: true, id: `id-${i}` }));
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { createSession } = await import("~/lib/auth/session.server");
const R = await import("~/routes/admin.user");
const Broadcast = await import("~/routes/admin.broadcast-new");

async function cookieFor(id: string, role: "player" | "superadmin", organizes?: number) {
  h.raw
    .prepare("insert into users (id, email, name, sex, consent_at, platform_role) values (?, ?, ?, 'female', 1, ?)")
    .run(id, `${id}@x.hu`, id, role);
  if (organizes) h.raw.prepare("insert into league_admins (league_id, user_id) values (?, ?)").run(organizes, id);
  return (await createSession(id)).split(";")[0];
}

const args = (cookie: string, id: string, init: RequestInit = {}) =>
  ({ request: new Request(`http://localhost/admin/users/${id}`, { ...init, headers: { Cookie: cookie } }), params: { id }, context: {} }) as any;
const load = (cookie: string, id = "a") => R.loader(args(cookie, id));
const act = (cookie: string, fields: Record<string, string>, id = "a") => R.action(args(cookie, id, { method: "POST", body: new URLSearchParams(fields) }));
const edit = (cookie: string, o: Record<string, string> = {}) =>
  act(cookie, { intent: "edit", name: "Kovács Anna", phone: "+36 30 123 4567", level: "kezdo", sex: "female", ...o });
const one = (q: string, ...p: unknown[]) => h.raw.prepare(q).get(...p);

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e: any) {
    return e?.init?.status ?? e?.status ?? -1;
  }
}

beforeEach(() => {
  h.raw = migratedDatabase();
  h.sent = [];
  h.raw.exec("insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)");
  h.raw.exec("insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')");
  h.raw.exec(`insert into users (id, email, name, level, phone, sex, consent_at) values
    ('a', 'a@x.hu', 'Kovács Anna - Nagy Bence', 'kezdo', '+36301234567', 'female', 1),
    ('b', 'b@x.hu', 'Nagy Béla', 'kezdo', '+36301234568', 'male', 1),
    ('c', 'c@x.hu', 'Szabó Cecil', 'halado', null, null, 1)`);
  h.raw.exec("insert into users (id, email, name, consent_at, deleted_at) values ('z', 'z@deleted.invalid', 'Törölt játékos', 1, 1)");
  // a and b were a pair, dissolved; c has none and looks for one.
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status, dissolved_at) values (1, 1, 'a', 'b', 'dissolved', 100)`);
  h.raw.exec(`insert into league_members (league_id, user_id, source) select 1, id, 'carried' from users where id in ('a', 'b', 'c')`);
  h.raw.exec(`insert into audit_log (actor_id, action, target, detail) values (null, 'pair.dissolve', 'pair:1', 'league:1'), ('b', 'partner_search.on', 'league:1', null)`);
});

describe("/admin/users/:id access (#301, D156)", () => {
  it("refuses a Játékos and a Szervező (403), page and action alike; no change made", async () => {
    for (const cookie of [await cookieFor("jatekos", "player"), await cookieFor("szervezo", "player", 1)]) {
      expect(await status(load(cookie))).toBe(403);
      expect(await status(edit(cookie, { name: "Más Név" }))).toBe(403);
      expect(await status(act(cookie, { intent: "seeking", league: "1", seeking: "1" }))).toBe(403);
    }
    expect(one("select name from users where id = 'a'").name).toBe("Kovács Anna - Nagy Bence");
    expect(one("select count(*) as n from audit_log where action = 'user.update'").n).toBe(0);
  });

  it("has no profile for a deleted or unknown account (404)", async () => {
    const admin = await cookieFor("admin", "superadmin");
    expect(await status(load(admin, "z"))).toBe(404);
    expect(await status(load(admin, "nope"))).toBe(404);
  });
});

describe("the profile (#301)", () => {
  it("shows the facts, the league, every pair with its entries, and the Napló entries about them", async () => {
    const page = await load(await cookieFor("admin", "superadmin"));
    expect(page.profile).toMatchObject({
      name: "Kovács Anna - Nagy Bence",
      email: "a@x.hu",
      phone: "+36 30 123 4567",
      editable: { level: "kezdo", sex: "female" },
      role: "Játékos",
      registered: true,
      levelLocked: false,
    });
    expect(page.profile.leagues).toEqual([expect.objectContaining({ slug: "gyor", pair: null, seeking: false })]);
    expect(page.profile.pairs).toEqual([expect.objectContaining({ id: 1, status: "dissolved", partner: { id: "b", name: "Nagy Béla", deleted: false } })]);
    // The dissolve of their pair is about them; b's own switch is not.
    expect(page.log.rows.map((r: any) => r.action)).toEqual(["pair.dissolve"]);
    expect(page.canEdit).toBe(true);
  });

  it("saves the name, phone, level and sex, with one audit entry naming the fields, not the values", async () => {
    const admin = await cookieFor("admin", "superadmin");
    expect(await edit(admin, { name: "Kovács Anna", sex: "female", level: "halado", phone: "06 20 111 2222" })).toEqual({ intent: "edit", ok: true, changed: 3 });
    expect(one("select name, phone, level, sex from users where id = 'a'")).toEqual({ name: "Kovács Anna", phone: "+36201112222", level: "halado", sex: "female" });
    expect(h.raw.prepare("select actor_id, action, target, detail from audit_log where action = 'user.update'").all()).toEqual([
      { actor_id: "admin", action: "user.update", target: "user:a", detail: "Módosítva: név, telefonszám, szint" },
    ]);
    // Nothing changed: no entry.
    expect(await edit(admin, { name: "Kovács Anna", level: "halado", phone: "+36201112222" })).toEqual({ intent: "edit", ok: true, changed: 0 });
    expect(one("select count(*) as n from audit_log where action = 'user.update'").n).toBe(1);
    // The profile's Napló lists the edit.
    expect((await load(admin)).log.rows.map((r: any) => r.action)).toContain("user.update");
    expect(h.sent).toEqual([]);
  });

  it("refuses a bad value with the field's error and saves nothing", async () => {
    const admin = await cookieFor("admin", "superadmin");
    expect(await edit(admin, { phone: "123" })).toEqual({ intent: "edit", errors: { phone: expect.any(String) } });
    expect(await edit(admin, { name: "" })).toEqual({ intent: "edit", errors: { name: "Add meg a nevét." } });
    expect(one("select name, phone from users where id = 'a'")).toEqual({ name: "Kovács Anna - Nagy Bence", phone: "+36301234567" });
  });

  it("keeps a locked level (D79): a player who took part in a season", async () => {
    h.raw.exec(`insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, 'Tél', 1, 2, '2026-11-09')`);
    h.raw.exec(`insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, 5)`);
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1)`);
    const admin = await cookieFor("admin", "superadmin");
    expect((await load(admin)).profile.levelLocked).toBe(true);
    expect(await edit(admin, { level: "versenyzo" })).toEqual({ intent: "edit", errors: { level: expect.stringMatching(/lezárult/) } });
    expect(await edit(admin, { level: "", name: "Kovács Anna" })).toEqual({ intent: "edit", ok: true, changed: 1 });
    expect(one("select level from users where id = 'a'").level).toBe("kezdo");
  });

  it("switches Párt keresek for a player without a pair, audited with the Admin as actor", async () => {
    const admin = await cookieFor("admin", "superadmin");
    expect(await act(admin, { intent: "seeking", league: "1", seeking: "1" }, "c")).toEqual({ intent: "seeking", ok: true });
    expect(one("select seeking from partner_searches where user_id = 'c'").seeking).toBe(1);
    expect(one("select actor_id, target, detail from audit_log where action = 'partner_search.on' and actor_id = 'admin'")).toEqual({
      actor_id: "admin",
      target: "user:c",
      detail: "league:1",
    });
    // Not in a league they never joined.
    expect(await status(act(admin, { intent: "seeking", league: "9", seeking: "1" }, "c"))).toBe(400);
  });

  it("Levél neki writes to that one player only", async () => {
    const admin = await cookieFor("admin", "superadmin");
    const found = await Broadcast.loader({
      request: new Request("http://localhost/admin/broadcasts/new?user=c", { headers: { Cookie: admin } }),
      params: {},
      context: {},
    } as any);
    expect(found.recipients).toEqual([{ email: "c@x.hu", name: "Szabó Cecil" }]);
    expect(found.back).toMatchObject({ to: "/admin/users/c" });
    expect(h.sent).toEqual([]);
  });
});
