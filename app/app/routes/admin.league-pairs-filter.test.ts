// Párok's search, entry filter and "Levél nekik" (#148, D64) on a real
// SQLite (~/test/sqlite), with the real session lookup. Email sending is
// stubbed: nothing leaves the process, and the broadcast page only lists the
// recipients (nothing is sent from Párok).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
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
const Pairs = await import("~/routes/admin.league-pairs");
const Broadcast = await import("~/routes/admin.broadcast-new");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

async function cookieFor(id: string, role: "player" | "superadmin", organizes?: number) {
  // Staff accounts are registered too, so they are rows without a pair;
  // the checks below leave them out (STAFF).
  h.raw
    .prepare("insert into users (id, email, name, sex, consent_at, platform_role) values (?, ?, ?, 'female', 1, ?)")
    .run(id, `${id}@x.hu`, id, role);
  if (organizes) h.raw.prepare("insert into league_admins (league_id, user_id) values (?, ?)").run(organizes, id);
  return (await createSession(id)).split(";")[0];
}

const args = (url: string, cookie: string, league = "gyor") =>
  ({ request: new Request(url, { headers: { Cookie: cookie } }), params: { league }, context: {} }) as any;
const pairsPage = (query: string, cookie: string) => Pairs.loader(args(`http://localhost/admin/leagues/gyor/pairs${query}`, cookie));

const STAFF = new Set(["admin", "szervezo"]);
const mine = (rows: any[]) => rows.filter((r) => r.kind !== "solo" || !STAFF.has(r.player.id));
const names = (rows: any[]) => mine(rows).map((r) => (r.kind === "solo" ? r.player.name : r.pair.players.map((p: any) => p.name).join(" + ")));

beforeEach(() => {
  h.raw = migratedDatabase();
  h.sent = [];
  h.raw.exec("insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)");
  h.raw.exec("insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')");
  for (const [id, name] of [
    ["a", "Kovács Anna"],
    ["b", "Nagy Béla"],
    ["c", "Szabó Cecil"],
    ["d", "Tóth Dóra"],
    ["e", "Kiss Edit"],
    ["f", "Varga Ferenc"],
    ["g", "Ákos Sándor"],
    ["k", "Pál Boglárka"],
  ])
    h.raw
      .prepare("insert into users (id, email, name, level, phone, consent_at) values (?, ?, ?, 'kezdo', '+36301234567', 1)")
      .run(id, `${id}@x.hu`, name);
  // A finished account is a row; one that left the first-login page isn't.
  h.raw.exec("insert into users (id, email, name) values ('x', 'x@x.hu', 'Félbehagyta')");
  // a+b entered, c+d not entered, e+f dissolved; g and k have no pair, k looks for one.
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status) values (1, 1, 'a', 'b', 'active'), (2, 1, 'c', 'd', 'active'), (3, 1, 'e', 'f', 'dissolved')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, 'Tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2030-11-05T22:59:00Z"));
  h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, ?, ?)").run(sec("2030-11-08T23:00:00Z"), sec("2030-11-29T22:59:00Z"));
  h.raw.exec(`insert into season_entries (season_id, pair_id, status, joins_phase) values (1, 1, 'approved', 1)`);
  h.raw.exec(`insert into partner_searches (league_id, user_id, seeking) values (1, 'k', 1)`);
  h.raw.exec(`insert into email_suppressions (email, reason) values ('d@x.hu', 'bounced')`);
});

describe("Párok search and filter (#148)", () => {
  it("lists the players without a pair as rows, and Nincs a ligában lists exactly them and the pairs not entered", async () => {
    const cookie = await cookieFor("szervezo", "player", 1);
    const all = await pairsPage("", cookie);
    expect(names(all.rows)).toEqual(["Szabó Cecil + Tóth Dóra", "Kovács Anna + Nagy Béla", "Kiss Edit + Varga Ferenc", "Ákos Sándor", "Kiss Edit", "Pál Boglárka", "Varga Ferenc"]);
    expect(all.rows.find((r: any) => r.kind === "solo" && r.player.id === "k")).toMatchObject({ player: { seeking: true } });
    expect(all.rows.find((r: any) => r.kind === "solo" && r.player.id === "g")).toMatchObject({ player: { seeking: false } });

    const out = await pairsPage("?entry=not_in_league", cookie);
    expect(names(out.rows)).toEqual(["Szabó Cecil + Tóth Dóra", "Ákos Sándor", "Kiss Edit", "Pál Boglárka", "Varga Ferenc"]);
    expect(names((await pairsPage("?entry=entered", cookie)).rows)).toEqual(["Kovács Anna + Nagy Béla"]);
    expect(names((await pairsPage("?entry=dissolved", cookie)).rows)).toEqual(["Kiss Edit + Varga Ferenc"]);
    // The Szervező's own account is a row without a pair too.
    expect(out.counts).toEqual({ entered: 1, not_entered: 1, rejected: 0, withdrawn: 0, no_pair: 5, dissolved: 1, not_in_league: 6 });
  });

  it("searches by name, ignoring case and accents; the counts follow the search", async () => {
    const cookie = await cookieFor("szervezo", "player", 1);
    const page = await pairsPage("?q=kovacs", cookie);
    expect(names(page.rows)).toEqual(["Kovács Anna + Nagy Béla"]);
    expect(page.counts).toMatchObject({ entered: 1, not_in_league: 0 });
    expect(names((await pairsPage("?q=dora&entry=not_entered", cookie)).rows)).toEqual(["Szabó Cecil + Tóth Dóra"]);
    expect(names((await pairsPage("?q=akos", cookie)).rows)).toEqual(["Ákos Sándor"]);
    expect((await pairsPage("?q=kovacs", cookie)).query).toEqual({ entry: null, q: "kovacs" });
  });

  it("shows no email address; phone numbers only on the rows, to call (D123)", async () => {
    for (const cookie of [await cookieFor("admin", "superadmin"), await cookieFor("szervezo", "player", 1)]) {
      const page = await pairsPage("?entry=not_in_league", cookie);
      expect(JSON.stringify(page)).not.toContain("@");
      const phones = page.rows.flatMap((r: any) => (r.kind === "solo" ? [r.player.phone] : r.pair.players.map((p: any) => p.phone)));
      expect(phones).toContain("+36 30 123 4567");
      // The player choices of "Pár létrehozása" and "Csere" carry none.
      expect(JSON.stringify(page.candidates)).not.toContain("+36");
    }
  });

  it("offers Levél nekik to the Admin only (the broadcast page is theirs)", async () => {
    expect((await pairsPage("?entry=no_pair", await cookieFor("admin", "superadmin"))).canMail).toBe(true);
    expect((await pairsPage("?entry=no_pair", await cookieFor("szervezo", "player", 1))).canMail).toBe(false);
  });
});

describe("Levél nekik from Párok opens the broadcast page with those players (#148)", () => {
  it("Nincs a ligában: exactly those players, each address once, minus suppressed ones; nothing sent", async () => {
    const admin = await cookieFor("admin", "superadmin");
    const page = await Broadcast.loader(args("http://localhost/admin/broadcasts/new?pairs=gyor&entry=not_in_league", admin));
    // Cecil + Dóra (Dóra bounced), Ákos, and the solos Edit, Boglárka, Ferenc (their pair is dissolved).
    expect(page.recipients.map((r: any) => r.email).sort()).toEqual(["admin@x.hu", "c@x.hu", "e@x.hu", "f@x.hu", "g@x.hu", "k@x.hu"]);
    expect(page.suppressed).toBe(1);
    expect(page.label).toBe("Párok, Padelpárbaj Győr · Nincs a ligában");
    expect(page.back).toEqual({ to: "/admin/leagues/gyor/pairs?entry=not_in_league", note: expect.any(String) });
    expect(h.sent).toEqual([]);
    expect(h.raw.prepare("select count(*) as n from email_messages").get().n).toBe(0);
  });

  it("with a search: the players of the rows the search shows", async () => {
    const admin = await cookieFor("admin", "superadmin");
    const page = await Broadcast.loader(args("http://localhost/admin/broadcasts/new?pairs=gyor&q=kovacs", admin));
    expect(page.recipients).toEqual([
      { email: "a@x.hu", name: "Kovács Anna" },
      { email: "b@x.hu", name: "Nagy Béla" },
    ]);
  });

  it("refuses a Szervező (403) and an unknown league (404)", async () => {
    const szervezo = await cookieFor("szervezo", "player", 1);
    const admin = await cookieFor("admin", "superadmin");
    const status = async (p: Promise<unknown>) => p.then(() => 200, (e: any) => e?.status ?? e?.init?.status ?? -1);
    expect(await status(Broadcast.loader(args("http://localhost/admin/broadcasts/new?pairs=gyor", szervezo)))).toBe(403);
    expect(await status(Broadcast.loader(args("http://localhost/admin/broadcasts/new?pairs=nope", admin)))).toBe(404);
  });
});

describe("two leagues in two cities: each Párok has only its players (#175, D93)", () => {
  beforeEach(() => {
    h.raw.exec("insert or replace into cities (slug, name, listed) values ('deb', 'Debrecen', 1)");
    h.raw.exec("insert into leagues (id, city, slug, name) values (2, 'deb', 'deb', 'Padelpárbaj Debrecen')");
    h.raw.exec("insert into users (id, email, name, consent_at) values ('h', 'h@x.hu', 'Hegedűs Hanna', 1)");
    // Ákos and Hanna signed up in Debrecen (Hanna as the partner of a pair
    // signup), Boglárka in Győr; Edit and Ferenc have no signup.
    h.raw.exec(`insert into interest_signups (city, mode, name1, email1, name2, email2, level, consent_at) values
      ('deb', 'solo', 'Ákos', 'G@x.hu', null, null, 'kezdo', 1),
      ('deb', 'pair', 'Valaki', 'valaki@x.hu', 'Hanna', 'h@x.hu', 'kezdo', 1),
      ('gyor', 'solo', 'Boglárka', 'k@x.hu', null, null, 'kezdo', 1)`);
  });
  const solos = (rows: any[]) => rows.filter((r) => r.kind === "solo").map((r) => r.player.id);

  it("lists, counts and offers for a new pair only the league's players; staff without a signup in both", async () => {
    const admin = await cookieFor("admin", "superadmin");
    const gyor = await Pairs.loader(args("http://localhost/admin/leagues/gyor/pairs", admin));
    expect(solos(gyor.rows)).toEqual(["admin", "e", "k", "f"]);
    expect(gyor.counts.no_pair).toBe(4);
    expect(gyor.candidates.map((c: any) => c.id)).toEqual(["admin", "e", "k", "f"]);
    const deb = await Pairs.loader(args("http://localhost/admin/leagues/deb/pairs", admin, "deb"));
    // No pair in Debrecen yet: everyone from Győr's pairs without a signup counts there too.
    expect(solos(deb.rows)).toEqual(["admin", "g", "h", "e", "a", "b", "c", "d", "f"]);
    expect(deb.candidates.map((c: any) => c.id)).not.toContain("k");
  });

  it("Levél nekik addresses only the league's players", async () => {
    const admin = await cookieFor("admin", "superadmin");
    const gyor = await Broadcast.loader(args("http://localhost/admin/broadcasts/new?pairs=gyor&entry=no_pair", admin));
    expect(gyor.recipients.map((r: any) => r.email).sort()).toEqual(["admin@x.hu", "e@x.hu", "f@x.hu", "k@x.hu"]);
    const deb = await Broadcast.loader(args("http://localhost/admin/broadcasts/new?pairs=deb&entry=no_pair", admin));
    expect(deb.recipients.map((r: any) => r.email)).toEqual(expect.arrayContaining(["g@x.hu", "h@x.hu"]));
    expect(deb.recipients.map((r: any) => r.email)).not.toContain("k@x.hu");
    expect(h.sent).toEqual([]);
  });
});
