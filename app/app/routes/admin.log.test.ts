// /admin/log, Napló (#226): Admin only (a Szervező and a Játékos get 403),
// newest first, Hungarian action names, filters from the address, deleted
// accounts as "Törölt játékos". Real session lookup on a real SQLite
// (~/test/sqlite).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { createSession } = await import("~/lib/auth/session.server");
const R = await import("~/routes/admin.log");

async function cookieFor(id: string, role: "player" | "superadmin", organizes = false) {
  h.raw
    .prepare("insert into users (id, email, name, sex, consent_at, platform_role) values (?, ?, ?, 'female', 1, ?)")
    .run(id, `${id}@x.hu`, id === "admin" ? "Admin Anna" : id, role);
  if (organizes) h.raw.prepare("insert into league_admins (league_id, user_id) values (1, ?)").run(id);
  return (await createSession(id)).split(";")[0]!;
}

const load = (cookie: string, query = "") =>
  R.loader({ request: new Request(`http://localhost/admin/log${query}`, { headers: { Cookie: cookie } }), params: {}, context: {} } as any);

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e: any) {
    return e?.init?.status ?? e?.status ?? -1;
  }
}

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
function entry(actor: string | null, action: string, target: string, detail: string | null, at: string, league: number | null = 1) {
  h.raw
    .prepare("insert into audit_log (actor_id, action, target, detail, at, league_id) values (?, ?, ?, ?, ?, ?)")
    .run(actor, action, target, detail, sec(at), league);
}

describe("/admin/log (#226)", () => {
  let admin: string;
  beforeEach(async () => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
    h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'gyor', 'gyor2', 'Győr 2')`);
    admin = await cookieFor("admin", "superadmin");
    h.raw.exec(`insert into users (id, email, name, phone) values ('a', 'a@x.hu', 'Anna', '+36301234567'), ('b', 'b@x.hu', 'Béla', null)`);
    // An organizer whose account was anonymized later, and their pair.
    h.raw.exec(`insert into users (id, email, name, deleted_at) values ('gone', 'deleted-gone@deleted.invalid', 'Gábor Régi', 1)`);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status) values (7, 1, 'a', 'b', 'active'), (8, 1, 'a', 'gone', 'dissolved')`);
    entry("admin", "league_admin.grant", "user:a", null, "2026-11-01T09:00:00Z");
    entry("gone", "pair.dissolve", "pair:8", "league:1", "2026-11-02T09:00:00Z");
    entry(null, "result.auto_accept", "match:5", "4:1, 4:2", "2026-11-03T09:00:00Z", 2);
    entry("admin", "pair.create", "pair:7", "league:1; user:a + user:b", "2026-11-04T09:00:00Z");
    // Older rows: an email target, an action this version doesn't know.
    entry("admin", "league_admin.revoke", "b@x.hu", "league:gyor", "2026-10-20T09:00:00Z");
    entry(null, "old.thing", "x", null, "2026-10-19T09:00:00Z", null);
  });

  it("is for the Admin only: a Szervező and a Játékos get 403", async () => {
    expect(await status(load(await cookieFor("org", "player", true)))).toBe(403);
    expect(await status(load(await cookieFor("pl", "player")))).toBe(403);
    expect(await status(load(admin))).toBe(200);
  });

  it("lists the newest first, in Hungarian, with names instead of ids", async () => {
    const page = await load(admin);
    expect(page.total).toBe(6);
    expect(page.rows.map((r: any) => [r.actor, r.actionLabel, r.target, r.detail, r.league])).toEqual([
      ["Admin Anna", "Pár létrehozása", "Anna – Béla", "Padelpárbaj Győr; Anna és Béla", "Padelpárbaj Győr"],
      ["Rendszer", "Eredmény automatikus elfogadása", "Meccs #5", "4:1, 4:2", "Győr 2"],
      ["Törölt játékos", "Pár felbontása", "Anna – Törölt játékos", "Padelpárbaj Győr", "Padelpárbaj Győr"],
      ["Admin Anna", "Szervező kinevezése", "Anna", "", "Padelpárbaj Győr"],
      ["Admin Anna", "Szervező elvétele", "Béla", "Padelpárbaj Győr", "Padelpárbaj Győr"],
      // An unknown old action shows its code; no actor and not a system
      // action: its account is gone.
      ["Törölt játékos", "old.thing", "x", "", null],
    ]);
    // Never an old name, an email or a phone number.
    expect(JSON.stringify(page.rows)).not.toMatch(/@|\+36/);
    expect(page.options.actors.map((o: any) => o.label)).toEqual(["Rendszer", "Törölt játékos", "Admin Anna"]);
    expect(page.options.actions.find((o: any) => o.value === "old.thing")?.label).toBe("old.thing");
  });

  it("filters by action, actor, league and dates, all in the address", async () => {
    const pick = async (q: string) => (await load(admin, q)).rows.map((r: any) => r.action);
    expect(await pick("?action=pair.create")).toEqual(["pair.create"]);
    expect(await pick("?actor=system")).toEqual(["result.auto_accept"]);
    expect(await pick("?actor=deleted")).toEqual(["pair.dissolve", "old.thing"]);
    expect(await pick("?actor=admin&league=1")).toEqual(["pair.create", "league_admin.grant", "league_admin.revoke"]);
    expect(await pick("?league=2")).toEqual(["result.auto_accept"]);
    // Budapest days, both ends included.
    expect(await pick("?from=2026-11-02&to=2026-11-03")).toEqual(["result.auto_accept", "pair.dissolve"]);
    expect((await load(admin, "?from=2026-11-02&to=2026-11-03")).total).toBe(2);
  });

  it("pages by 50", async () => {
    for (let i = 0; i < 60; i++) entry("admin", "city.update", "city:gyor", null, "2026-11-04T10:00:00Z", null);
    const first = await load(admin);
    expect(first.rows).toHaveLength(50);
    expect(first.pages).toBe(2);
    const second = await load(admin, "?page=2");
    expect(second.rows).toHaveLength(16);
    expect(second.rows.at(-1)!.action).toBe("old.thing");
  });

  it("shows no address for an older invite entry nobody accepted", async () => {
    entry("admin", "league_admin.invite", "uj@x.hu", "league:gyor", "2026-11-05T09:00:00Z");
    const [row] = (await load(admin)).rows;
    expect([row.actionLabel, row.target]).toEqual(["Szervező meghívása", "Meghívott, nincs fiókja"]);
  });

  it("has no action: nothing on the page can change an entry", () => {
    expect((R as any).action).toBeUndefined();
  });
});
