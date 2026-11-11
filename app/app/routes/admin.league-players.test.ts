// Játékosok (#301, D155) on a real SQLite (~/test/sqlite) with the real
// session lookup: every registered player of the league once, the filters
// that replace Párkeresők and Párok's rows without a pair, "Párba teszem",
// "Levél nekik", and the old addresses' redirects. Email is captured, never
// sent; the broadcast page only lists the recipients.
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
const { settleBackground } = await import("~/test/background");
const { createSession } = await import("~/lib/auth/session.server");
const Players = await import("~/routes/admin.league-players");
const Solos = await import("~/routes/admin.league-solos");
const Broadcast = await import("~/routes/admin.broadcast-new");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

async function cookieFor(id: string, role: "player" | "superadmin", organizes?: number) {
  // Staff haven't joined the league here: they aren't rows.
  h.raw
    .prepare("insert into users (id, email, name, sex, consent_at, platform_role) values (?, ?, ?, 'female', 1, ?)")
    .run(id, `${id}@x.hu`, id, role);
  if (organizes) h.raw.prepare("insert into league_admins (league_id, user_id) values (?, ?)").run(organizes, id);
  return (await createSession(id)).split(";")[0];
}

const URL_ = "http://localhost/admin/leagues/gyor/players";
const args = (url: string, cookie: string, init: RequestInit = {}, league = "gyor") =>
  ({ request: new Request(url, { ...init, headers: { Cookie: cookie } }), params: { league }, context: {} }) as any;
const page = (query: string, cookie: string) => Players.loader(args(`${URL_}${query}`, cookie));
const post = (cookie: string, users: string[]) => {
  const body = new URLSearchParams({ intent: "pair" });
  for (const u of users) body.append("user", u);
  return Players.action(args(URL_, cookie, { method: "POST", body }));
};
const ids = (rows: any[]) => rows.map((r) => r.id);

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
  h.raw.exec("insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'gyor', 'gyor2', 'Győr 2')");
  for (const [id, name] of [
    ["a", "Kovács Anna"],
    ["b", "Nagy Béla"],
    ["c", "Szabó Cecil"],
    ["d", "Tóth Dóra"],
    ["g", "Ákos Sándor"],
    ["k", "Pál Boglárka"],
    ["m", "Molnár Márk"],
  ])
    h.raw
      .prepare("insert into users (id, email, name, level, phone, consent_at) values (?, ?, ?, 'kezdo', '+36301234567', 1)")
      .run(id, `${id}@x.hu`, name);
  // No level, no phone; one left the first-login page; one anonymized.
  h.raw.exec("insert into users (id, email, name, consent_at) values ('n', 'n@x.hu', 'Új Nóra', 1)");
  h.raw.exec("insert into users (id, email, name) values ('x', 'x@x.hu', 'Félbehagyta')");
  h.raw.exec("insert into users (id, email, name, consent_at, deleted_at) values ('z', 'z@deleted.invalid', 'Törölt játékos', 1, 1)");
  // a+b entered, c+d not; g, k, m, n without a pair; k and m look for one.
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status) values (1, 1, 'a', 'b', 'active'), (2, 1, 'c', 'd', 'active')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, 'Tél', ?, ?, '2030-11-11')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2030-11-05T22:59:00Z"));
  h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, ?, ?)").run(sec("2030-11-10T23:00:00Z"), sec("2030-12-01T22:59:00Z"));
  h.raw.exec(`insert into season_entries (season_id, pair_id, status, joins_phase) values (1, 1, 'approved', 1)`);
  h.raw.exec(`insert into partner_searches (league_id, user_id, seeking) values (1, 'k', 1), (1, 'm', 1), (1, 'g', 0)`);
  // Everyone above joined Győr (D128); Márk also Győr 2.
  h.raw.exec(`insert into league_members (league_id, user_id, source) select 1, id, 'carried' from users`);
  h.raw.exec(`insert into league_members (league_id, user_id, source) values (2, 'm', 'chosen')`);
  h.raw.exec(`insert into email_suppressions (email, reason) values ('g@x.hu', 'bounced')`);
});

describe("Játékosok (#301)", () => {
  it("lists every registered player of the league once, by name in Hungarian order; not the unfinished or deleted accounts", async () => {
    const all = await page("", await cookieFor("szervezo", "player", 1));
    expect(ids(all.rows)).toEqual(["g", "a", "m", "b", "k", "c", "d", "n"]);
    expect(all.total).toBe(8);
    expect(all.rows.find((r: any) => r.id === "a")).toMatchObject({ pair: { id: 1, partnerId: "b", partner: "Nagy Béla" }, entered: true });
    expect(all.rows.find((r: any) => r.id === "c")).toMatchObject({ entered: false, entryChip: { text: "Nem nevezett (Tél)" } });
    expect(all.rows.find((r: any) => r.id === "n")?.missing.map((c: any) => c.text)).toEqual(["Nincs szintje", "Nincs telefonszáma"]);
  });

  it("the filters cover what Párkeresők and Párok's rows without a pair showed", async () => {
    const cookie = await cookieFor("szervezo", "player", 1);
    const seekers = (await page("?filter=seeking", cookie)).rows;
    expect(ids(seekers)).toEqual(["m", "k"]);
    // Since when they look, as Párkeresők showed it.
    expect(seekers.every((r: any) => r.seekingSince instanceof Date)).toBe(true);
    expect((await page("", cookie)).rows.find((r: any) => r.id === "g")?.seekingSince).toBeNull();
    expect(ids((await page("?filter=no_pair", cookie)).rows)).toEqual(["g", "m", "k", "n"]);
    expect(ids((await page("?filter=entered", cookie)).rows)).toEqual(["a", "b"]);
    expect(ids((await page("?filter=not_entered&q=dora", cookie)).rows)).toEqual(["c", "d"]);
    expect((await page("", cookie)).counts).toEqual({ no_pair: 4, seeking: 2, paired: 4, entered: 2, not_entered: 6, missing: 1 });
  });

  it("shows no email address; phone numbers to call (D126)", async () => {
    for (const cookie of [await cookieFor("admin", "superadmin"), await cookieFor("szervezo", "player", 1)]) {
      const all = await page("", cookie);
      expect(JSON.stringify(all)).not.toContain("@");
      expect(all.rows.find((r: any) => r.id === "a")?.phone).toBe("+36 30 123 4567");
    }
  });

  it("refuses a Játékos and another league's Szervező (403); offers Levél nekik to the Admin only", async () => {
    for (const cookie of [await cookieFor("jatekos", "player"), await cookieFor("masik", "player", 2)]) {
      expect(await status(page("", cookie))).toBe(403);
      expect(await status(post(cookie, ["g", "k"]))).toBe(403);
    }
    expect((await page("", await cookieFor("admin", "superadmin"))).canMail).toBe(true);
    expect((await page("", await cookieFor("szervezo", "player", 1))).canMail).toBe(false);
  });

  it("Párba teszem: two seekers make a search pair (D113), anyone else a manual one; both get told", async () => {
    const cookie = await cookieFor("szervezo", "player", 1);
    expect(await post(cookie, ["m", "k"])).toEqual({ ok: true });
    expect(await post(cookie, ["g", "n"])).toEqual({ ok: true });
    await settleBackground();
    expect(h.raw.prepare("select player_a, player_b, source from pairs where id > 2 order by id").all()).toEqual([
      { player_a: "m", player_b: "k", source: "search" },
      { player_a: "g", player_b: "n", source: "manual" },
    ]);
    expect(h.raw.prepare("select actor_id, action from audit_log where action = 'pair.create'").all()).toHaveLength(2);
    // g's address bounced: no email to g; the other three get one each.
    expect(h.sent.map((m) => m.to).sort()).toEqual(["k@x.hu", "m@x.hu", "n@x.hu"]);
  });

  it("refuses a player who already has a pair, and a player of another league", async () => {
    const cookie = await cookieFor("szervezo", "player", 1);
    expect(await post(cookie, ["a", "g"])).toEqual({ error: expect.any(String) });
    h.raw.exec("insert into users (id, email, name, consent_at) values ('o', 'o@x.hu', 'Máshonnan', 1)");
    expect(await post(cookie, ["o", "g"])).toEqual({ error: expect.any(String) });
    expect(h.raw.prepare("select count(*) as n from pairs").get().n).toBe(2);
  });
});

describe("the retired addresses (#301 requirement 5)", () => {
  it("Párkeresők opens Játékosok with Párt keres", async () => {
    const res = await Promise.resolve()
      .then(() => Solos.loader({ request: new Request("http://localhost/admin/leagues/gyor/solos"), params: { league: "gyor" }, context: {} } as any))
      .then(
        () => null,
        (r: Response) => r,
      );
    expect(res?.status).toBe(302);
    expect(res?.headers.get("Location")).toBe("/admin/leagues/gyor/players?filter=seeking");
  });
});

describe("Levél nekik from Játékosok", () => {
  it("writes to exactly the players shown, each once, minus suppressed addresses; nothing is sent", async () => {
    const admin = await cookieFor("admin", "superadmin");
    const found = await Broadcast.loader(args("http://localhost/admin/broadcasts/new?players=gyor&filter=no_pair", admin));
    expect(found.recipients.map((r: any) => r.email)).toEqual(["m@x.hu", "k@x.hu", "n@x.hu"]);
    expect(found.suppressed).toBe(1);
    expect(found.label).toBe("Játékosok, Padelpárbaj Győr · Nincs párja");
    expect(found.back).toEqual({ to: "/admin/leagues/gyor/players?filter=no_pair", label: "Szűrők módosítása", note: expect.any(String) });
    expect(h.sent).toEqual([]);
  });

  it("refuses a Szervező (403) and an unknown league (404)", async () => {
    expect(await status(Broadcast.loader(args("http://localhost/admin/broadcasts/new?players=gyor", await cookieFor("szervezo", "player", 1))))).toBe(403);
    expect(await status(Broadcast.loader(args("http://localhost/admin/broadcasts/new?players=nope", await cookieFor("admin", "superadmin"))))).toBe(404);
  });
});
