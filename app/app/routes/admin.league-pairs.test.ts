// /admin/leagues/:league/pairs ("Párok", #97) is for that league's Szervező
// and the Admin: everyone else gets 403, page and action alike, with the real
// session lookup on a real SQLite (~/test/sqlite). Email is stubbed; no pair
// change queues any.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueSeasonEntered: async (...args: any[]) => h.mails.push(args),
  queueGroupsPublished: async (...args: any[]) => h.mails.push(args),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { createSession } = await import("~/lib/auth/session.server");
const R = await import("~/routes/admin.league-pairs");

async function cookieFor(id: string, role: "player" | "superadmin", organizes?: number) {
  h.raw
    .prepare("insert into users (id, email, name, sex, consent_at, platform_role) values (?, ?, ?, 'female', 1, ?)")
    .run(id, `${id}@x.hu`, id, role);
  if (organizes) h.raw.prepare("insert into league_admins (league_id, user_id) values (?, ?)").run(organizes, id);
  return (await createSession(id)).split(";")[0];
}

const URL_ = "http://localhost/admin/leagues/gyor/pairs";
const args = (request: Request) => ({ request, params: { league: "gyor" }, context: {} }) as any;
const get = (cookie: string) => new Request(URL_, { headers: { Cookie: cookie } });
const post = (cookie: string, fields: Record<string, string>) =>
  new Request(URL_, { method: "POST", headers: { Cookie: cookie }, body: new URLSearchParams(fields) });

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e: any) {
    return e?.init?.status ?? e?.status ?? -1;
  }
}

describe("/admin/leagues/:league/pairs access (#97)", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.mails = [];
    h.raw.exec("insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'deb', 'deb', 'Padelpárbaj Debrecen')");
    for (const id of ["a", "b"]) h.raw.prepare("insert into users (id, email, name, consent_at) values (?, ?, ?, 1)").run(id, `${id}@x.hu`, id);
    // Győr's players (D128).
    h.raw.exec("insert into league_members (league_id, user_id, source) values (1, 'a', 'chosen'), (1, 'b', 'chosen')");
  });

  it("refuses a Játékos and another league's Szervező with 403, page and action alike", async () => {
    for (const cookie of [await cookieFor("jatekos", "player"), await cookieFor("masik", "player", 2)]) {
      expect(await status(R.loader(args(get(cookie))))).toBe(403);
      expect(await status(R.action(args(post(cookie, { intent: "create", a: "a", b: "b" }))))).toBe(403);
    }
    expect(h.raw.prepare("select * from pairs").all()).toEqual([]);
  });

  it("#154: another league's Szervező can't enter a pair or take one out (403)", async () => {
    const cookie = await cookieFor("masik", "player", 2);
    for (const intent of ["enter", "remove"])
      expect(await status(R.action(args(post(cookie, { intent, pair: "1", season: "1" }))))).toBe(403);
  });

  it("sends a logged-out visitor to the login page", async () => {
    expect(await status(R.loader(args(get(""))))).toBe(302);
  });

  it("lets the league's Szervező and the Admin open the page and create a pair", async () => {
    const szervezo = await cookieFor("szervezo", "player", 1);
    const admin = await cookieFor("admin", "superadmin");
    for (const cookie of [szervezo, admin]) {
      const page = await R.loader(args(get(cookie)));
      expect(page.name).toBe("Padelpárbaj Győr");
    }
    expect(await R.action(args(post(szervezo, { intent: "create", a: "a", b: "b" })))).toEqual({ ok: true });
    expect(h.raw.prepare("select actor_id, action from audit_log where action like 'pair.%'").all()).toEqual([
      { actor_id: "szervezo", action: "pair.create" },
    ]);
    const page = await R.loader(args(get(admin)));
    expect(page.rows.map((r) => r.players.map((x) => x.id))).toEqual([["a", "b"]]);
    expect(JSON.stringify(page)).not.toContain("@");
    expect(h.mails).toEqual([]);
  });

  it("rejects an unknown intent or a bad pair id with 400", async () => {
    const cookie = await cookieFor("admin", "superadmin");
    expect(await status(R.action(args(post(cookie, { intent: "nope" }))))).toBe(400);
    expect(await status(R.action(args(post(cookie, { intent: "dissolve", pair: "x" }))))).toBe(400);
  });
});
