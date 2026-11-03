// /admin/users ("Felhasználók"): the Admin only, with each account's status
// and the last login, which every login records (createSession), on a real
// SQLite (~/test/sqlite) with the real session lookup.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
// Reached through the pair dissolve of an account deletion; nothing is sent.
vi.mock("~/lib/email/outbox.server", () => ({}));

const { migratedDatabase } = await import("~/test/sqlite");
const { createSession } = await import("~/lib/auth/session.server");
const R = await import("~/routes/admin.users");

async function cookieFor(id: string, role: "player" | "superadmin", organizes?: number) {
  h.raw
    .prepare("insert into users (id, email, name, sex, consent_at, platform_role) values (?, ?, ?, 'female', 1, ?)")
    .run(id, `${id}@x.hu`, id, role);
  if (organizes) h.raw.prepare("insert into league_admins (league_id, user_id) values (?, ?)").run(organizes, id);
  return (await createSession(id)).split(";")[0];
}

const args = (request: Request) => ({ request, params: {}, context: {} }) as any;
const get = (cookie: string) => new Request("http://localhost/admin/users", { headers: { Cookie: cookie } });

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e: any) {
    return e?.init?.status ?? e?.status ?? -1;
  }
}

describe("/admin/users", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec("insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')");
    h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('a', 'a@x.hu', 'Anna', 'halado', 1), ('b', 'b@x.hu', 'Béla', 'kezdo', 1)`);
    h.raw.exec(`insert into users (id, email, name) values ('n', 'n@x.hu', '')`);
    h.raw.exec(`insert into pairs (league_id, player_a, player_b) values (1, 'a', 'b')`);
  });

  it("records the login time on every new session", async () => {
    const before = Math.floor(Date.now() / 1000);
    await createSession("a");
    const { last_login_at } = h.raw.prepare("select last_login_at from users where id = 'a'").get();
    expect(last_login_at).toBeGreaterThanOrEqual(before);
    expect(h.raw.prepare("select last_login_at from users where id = 'b'").get().last_login_at).toBeNull();
  });

  it("is for the Admin only: a Szervező gets 403", async () => {
    expect(await status(R.loader(args(get(await cookieFor("szervezo", "player", 1)))))).toBe(403);
  });

  it("shows the Admin each account's status and last login", async () => {
    const page = await R.loader(args(get(await cookieFor("admin", "superadmin"))));
    expect(page.lastLogin).toBe(true);
    const row = (id: string) => page.users.find((u) => u.id === id)!;
    expect(row("a").status.map((c) => c.text)).toEqual(["Regisztrált", "Nincs telefonszáma", "Pár: Béla"]);
    expect(row("n").status.map((c) => c.text)).toEqual(["Félbehagyta a regisztrációt"]);
    expect(row("a").lastLoginAt).toBeNull();
    expect(row("admin").lastLoginAt).toBeInstanceOf(Date);
  });

  // #152: "Törlés" is the Admin's only.
  const post = (cookie: string, user: string) =>
    new Request("http://localhost/admin/users", {
      method: "POST",
      headers: { Cookie: cookie },
      body: new URLSearchParams({ intent: "delete", user }),
    });

  it("refuses a hand-made delete request from a Szervező", async () => {
    expect(await status(R.action(args(post(await cookieFor("szervezo", "player", 1), "n"))))).toBe(403);
    expect(h.raw.prepare("select count(*) as n from users where id = 'n'").get().n).toBe(1);
  });

  it("lets the Admin delete an account; it leaves the list", async () => {
    const cookie = await cookieFor("admin", "superadmin");
    const page = await R.loader(args(get(cookie)));
    expect(page.canDelete).toBe(true);
    const row = (id: string) => page.users.find((u) => u.id === id)!;
    expect(row("n").deletion).toEqual({ mode: "remove" });
    expect(row("admin").deletion).toEqual({ refused: "A saját fiókodat itt nem törölheted." });
    expect(await R.action(args(post(cookie, "n")))).toEqual({ ok: true, message: "A fiók törölve." });
    expect((await R.loader(args(get(cookie)))).users.map((u) => u.id)).not.toContain("n");
  });

  it("doesn't list or count an anonymized account", async () => {
    const cookie = await cookieFor("admin", "superadmin");
    const before = await R.loader(args(get(cookie)));
    h.raw.exec(`update users set name = 'Törölt játékos', deleted_at = 1 where id = 'b'`);
    const page = await R.loader(args(get(cookie)));
    expect(page.users.map((u) => u.id)).not.toContain("b");
    expect(page.total).toBe(before.total - 1);
    const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
    expect(sum(page.counts.role)).toBe(sum(before.counts.role) - 1);
  });

  it("finds a name that starts with an accented capital", async () => {
    h.raw.exec(`insert into users (id, email, name, consent_at) values ('k', 'k@x.hu', 'Ákos Új', 1)`);
    const cookie = await cookieFor("admin", "superadmin");
    const search = async (q: string) =>
      (await R.loader(args(new Request(`http://localhost/admin/users?q=${encodeURIComponent(q)}`, { headers: { Cookie: cookie } })))).users.map((u) => u.id);
    expect(await search("ákos")).toEqual(["k"]);
    expect(await search("új")).toEqual(["k"]);
    expect(await search("BÉLA")).toEqual(["b"]);
    expect(await search("x.hu")).toHaveLength(5);
  });

  it("filters by role, registration, missing data and pair, counts the options and keeps the total (#151)", async () => {
    h.raw.exec(`insert into users (id, email, name, level, phone, consent_at) values ('c', 'c@x.hu', 'Cecil', 'kezdo', '+36301234567', 1)`);
    const cookie = await cookieFor("admin", "superadmin");
    const load = (query: string) =>
      R.loader(args(new Request(`http://localhost/admin/users?${query}`, { headers: { Cookie: cookie } })));
    const ids = async (query: string) => (await load(query)).users.map((u) => u.id).sort();

    expect(await ids("role=admin")).toEqual(["admin"]);
    expect(await ids("registration=unfinished")).toEqual(["n"]);
    expect(await ids("missing=level")).toEqual(["admin"]);
    expect(await ids("missing=phone")).toEqual(["a", "admin", "b"]);
    // Cecil has no pair; Anna and Béla are paired, the admin account has none either.
    expect(await ids("pair=none")).toEqual(["admin", "c"]);
    // With a search term as well.
    expect(await ids("pair=none&q=cec")).toEqual(["c"]);
    // An unknown value is no filter.
    expect(await ids("pair=bogus")).toHaveLength(5);

    const page = await load("pair=none");
    expect(page.total).toBe(5);
    expect(page.counts.pair.none).toBe(2);
    expect(page.counts.role).toEqual({ player: 1, organizer: 0, admin: 1 });
  });
});
