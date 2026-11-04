// pairs.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the organizer's create, dissolve and change partner (#97),
// with the one-pair-per-league rule checked inside the SQL. Email is stubbed:
// a new pair (create, change partner) queues one per player (#260), nothing
// else does.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

// No VAPID keys: notifications are stored, not pushed.
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({ listedCities: async () => [{ slug: "gyor" }] }));
vi.mock("~/lib/email/outbox.server", () => ({
  queueSeasonEntered: async (...args: any[]) => h.mails.push(args),
  queueGroupsPublished: async (...args: any[]) => h.mails.push(args),
  queuePairCreated: async (...args: any[]) => h.mails.push(["pair_created", ...args]),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const P = await import("~/lib/pairs.server");
const { NEW_PAIR_REFUSALS } = await import("~/lib/pairs");

// Node built-ins: this file runs in Vitest (Node) but is type-checked with the
// Workers types, which have no node:fs.
const { readdirSync, readFileSync, statSync } = await import(/* @vite-ignore */ `node:${"fs"}`);

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const NOW = new Date("2026-11-03T12:00:00Z");
const GYOR = { id: 1, city: "gyor" };
const DEB = { id: 2, city: "deb" };
const one = (q: string) => h.raw.prepare(q).get();
const all = (q: string) => h.raw.prepare(q).all();
const inbox = () => all("select user_id, kind, url from notifications order by user_id");
const pairMails = () => h.mails.filter((m) => m[0] === "pair_created").flatMap((m) => m[1]);
const audits = () => all("select actor_id, action, target from audit_log where action like 'pair.%' order by id");

function freshDb() {
  h.raw = migratedDatabase();
  h.mails = [];
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('deb', 'Debrecen', 0)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'deb', 'deb', 'Padelpárbaj Debrecen')`);
  for (const [id, name, level] of [
    ["a", "Anna", "halado"],
    ["b", "Béla", "kezdo"],
    ["c", "Cecil", "kozephalado"],
    ["d", "Dóra", "versenyzo"],
    ["o", "Org", null],
  ])
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, ?, 1)").run(id, `${id}@x.hu`, name, level);
  // Has an account but hasn't finished the first-login page.
  h.raw.exec(`insert into users (id, email, name) values ('n', 'n@x.hu', 'Nándor')`);
}

describe("pairs.server on real SQLite (#97)", () => {
  beforeEach(freshDb);

  it("lists only leagues in listed cities", async () => {
    expect(await P.pairLeagues()).toEqual([{ id: 1, name: "Padelpárbaj Győr" }]);
  });

  it("creates a manual pair, audited, and both players see it on /pair", async () => {
    expect(await P.createPair("o", 1, "a", "b")).toEqual({ ok: true });
    expect(one("select league_id, player_a, player_b, source, status from pairs")).toEqual({
      league_id: 1,
      player_a: "a",
      player_b: "b",
      source: "manual",
      status: "active",
    });
    const id = one("select id from pairs").id;
    expect(audits()).toEqual([{ actor_id: "o", action: "pair.create", target: `pair:${id}` }]);
    const [oa] = await P.pairOverview({ id: "b" } as any, [{ id: 1, name: "Padelpárbaj Győr" }]);
    expect(oa.pair).toEqual({ id, partnerName: "Anna" });
  });

  it("tells both players of a new pair, in the app and by email, with the partner's name (#260)", async () => {
    await P.createPair("o", 1, "a", "b");
    expect(inbox()).toEqual([
      { user_id: "a", kind: "pair_intro", url: "/pair" },
      { user_id: "b", kind: "pair_intro", url: "/pair" },
    ]);
    expect(pairMails()).toEqual([
      { toEmail: "a@x.hu", input: { to: "Anna", partnerName: "Béla", league: "Padelpárbaj Győr" } },
      { toEmail: "b@x.hu", input: { to: "Béla", partnerName: "Anna", league: "Padelpárbaj Győr" } },
    ]);
  });

  it("a refused pair tells nobody", async () => {
    await P.createPair("o", 1, "a", "a");
    await P.createPair("o", 1, "a", "n");
    expect(inbox()).toEqual([]);
    expect(h.mails).toEqual([]);
  });

  it("refuses a player twice, an unregistered one, or one already paired in the league", async () => {
    expect(await P.createPair("o", 1, "a", "a")).toEqual({ ok: false, error: NEW_PAIR_REFUSALS.same });
    expect(await P.createPair("o", 1, "a", "n")).toEqual({ ok: false, error: NEW_PAIR_REFUSALS.unknown });
    expect(await P.createPair("o", 1, "a", "nobody")).toEqual({ ok: false, error: NEW_PAIR_REFUSALS.unknown });
    await P.createPair("o", 1, "a", "b");
    expect(await P.createPair("o", 1, "c", "a")).toEqual({ ok: false, error: NEW_PAIR_REFUSALS.paired });
    expect(await P.createPair("o", 1, "b", "d")).toEqual({ ok: false, error: NEW_PAIR_REFUSALS.paired });
    expect(all("select id from pairs")).toHaveLength(1);
    // Another league doesn't count.
    expect(await P.createPair("o", 2, "a", "c")).toEqual({ ok: true });
    expect(audits().map((r: any) => r.action)).toEqual(["pair.create", "pair.create"]);
  });

  it("the insert itself refuses a player paired in the meantime (two organizers at once)", async () => {
    // The check passes; right before the insert runs, someone pairs Anna.
    const prepare = h.raw.prepare.bind(h.raw);
    let raced = false;
    h.raw.prepare = (q: string) => {
      if (!raced && /^insert into "pairs"/.test(q)) {
        raced = true;
        prepare(`insert into pairs (league_id, player_a, player_b) values (1, 'c', 'a')`).run();
      }
      return prepare(q);
    };
    expect(await P.createPair("o", 1, "a", "b")).toEqual({ ok: false, error: NEW_PAIR_REFUSALS.paired });
    expect(raced).toBe(true);
    expect(all("select player_a, player_b from pairs")).toEqual([{ player_a: "c", player_b: "a" }]);
    expect(audits()).toEqual([]);
  });

  it("offers registered players without an active pair in the league as candidates", async () => {
    await P.createPair("o", 1, "a", "b");
    expect((await P.pairCandidates(GYOR)).map((c) => c.id)).toEqual(["c", "d", "o"]);
    // A dissolved pair frees them.
    await P.dissolvePair("o", 1, one("select id from pairs").id, NOW);
    expect((await P.pairCandidates(GYOR)).map((c) => c.id)).toEqual(["a", "b", "c", "d", "o"]);
    expect((await P.pairCandidates(DEB)).map((c) => c.id)).toEqual(["a", "b", "c", "d", "o"]);
  });

  it("offers only the league's players: by their signups' city, everyone without a signup (D93)", async () => {
    const signup = (city: string, email1: string, email2: string | null = null) =>
      h.raw
        .prepare("insert into interest_signups (city, mode, name1, email1, email2, level, consent_at) values (?, ?, 'x', ?, ?, 'kezdo', 1)")
        .run(city, email2 ? "pair" : "solo", email1, email2);
    signup("gyor", "A@x.hu");
    signup("deb", "b@x.hu", "C@X.HU");
    signup("other", "d@x.hu");
    expect((await P.pairCandidates(GYOR)).map((c) => c.id)).toEqual(["a", "o"]);
    expect((await P.pairCandidates(DEB)).map((c) => c.id)).toEqual(["b", "c", "o"]);
    // No address leaves the server.
    expect((await P.pairCandidates(GYOR))[0]).toEqual({ id: "a", name: "Anna", level: "halado" });
  });

  it("counts staff accounts like anyone else once they finished the first-login page (D93)", async () => {
    h.raw.exec(`update users set platform_role = 'superadmin' where id = 'o'`);
    h.raw.exec(`insert into users (id, email, name, consent_at) values ('s', 's@x.hu', 'Szervező', 1), ('t', 't@x.hu', 'Tóbiás', null)`);
    h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 's'), (1, 't')`);
    h.raw.exec(`insert into interest_signups (city, mode, name1, email1, level, consent_at) values ('deb', 'solo', 'x', 's@x.hu', 'kezdo', 1)`);
    // The Admin without a signup: every league. The Szervező signed up in
    // Debrecen: only there, although they organize Győr. Unfinished: nowhere.
    expect((await P.pairCandidates(GYOR)).map((c) => c.id)).toEqual(["a", "b", "c", "d", "o"]);
    expect((await P.pairCandidates(DEB)).map((c) => c.id)).toEqual(["a", "b", "c", "d", "o", "s"]);
  });

  it("dissolves a pair, audited, without any email; a second dissolve is refused", async () => {
    await P.createPair("o", 1, "a", "b");
    h.mails = []; // the create's own emails (#260)
    const id = one("select id from pairs").id;
    expect(await P.dissolvePair("o", 1, id, NOW)).toEqual({ ok: true });
    expect(one("select status, dissolved_by from pairs")).toEqual({ status: "dissolved", dissolved_by: "o" });
    expect(await P.dissolvePair("o", 1, id, NOW)).toMatchObject({ ok: false });
    expect(audits().map((r: any) => [r.action, r.target])).toEqual([
      ["pair.create", `pair:${id}`],
      ["pair.dissolve", `pair:${id}`],
    ]);
    expect(h.mails).toEqual([]);
  });

  it("refuses a pair of another league (the URL's league decides)", async () => {
    await P.createPair("o", 2, "a", "b");
    const id = one("select id from pairs").id;
    expect(await P.dissolvePair("o", 1, id, NOW)).toMatchObject({ ok: false });
    expect(await P.changePartner("o", 1, id, "a", "c", NOW)).toMatchObject({ ok: false });
    expect(one("select status from pairs").status).toBe("active");
  });

  it("changes the partner in one step: old pair dissolved, new manual pair, audited", async () => {
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (7, 1, 'a', 'b')`);
    expect(await P.changePartner("o", 1, 7, "a", "c", NOW)).toEqual({ ok: true });
    expect(all("select id, player_a, player_b, source, status from pairs order by id")).toEqual([
      { id: 7, player_a: "a", player_b: "b", source: "signup", status: "dissolved" },
      { id: 8, player_a: "a", player_b: "c", source: "manual", status: "active" },
    ]);
    expect(audits()).toEqual([{ actor_id: "o", action: "pair.change", target: "pair:8" }]);
    // The new pair hears of it (#260); Béla, who left, doesn't.
    expect(inbox().map((n: any) => n.user_id)).toEqual(["a", "c"]);
    expect(pairMails().map((m: any) => [m.toEmail, m.input.partnerName])).toEqual([
      ["a@x.hu", "Cecil"],
      ["c@x.hu", "Anna"],
    ]);
  });

  it("refuses a change to the same pair, to an unregistered or a paired player, and changes nothing", async () => {
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (7, 1, 'a', 'b'), (8, 1, 'c', 'd')`);
    for (const partner of ["a", "b"])
      expect(await P.changePartner("o", 1, 7, "a", partner, NOW)).toEqual({ ok: false, error: P.NEW_PARTNER_REFUSED });
    expect(await P.changePartner("o", 1, 7, "a", "n", NOW)).toEqual({ ok: false, error: NEW_PAIR_REFUSALS.unknown });
    expect(await P.changePartner("o", 1, 7, "a", "c", NOW)).toEqual({ ok: false, error: NEW_PAIR_REFUSALS.paired });
    // `keep` must be one of the pair's players.
    expect(await P.changePartner("o", 1, 7, "c", "o", NOW)).toMatchObject({ ok: false });
    expect(all("select status from pairs").map((r: any) => r.status)).toEqual(["active", "active"]);
    expect(audits()).toEqual([]);
  });

  it("a change whose new partner got paired in the meantime changes nothing at all (one transaction)", async () => {
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (7, 1, 'a', 'b')`);
    // Right before the batch starts, someone pairs Cecil.
    const exec = h.raw.exec.bind(h.raw);
    let raced = false;
    h.raw.exec = (q: string) => {
      if (q === "BEGIN" && !raced) {
        raced = true;
        exec(`insert into pairs (id, league_id, player_a, player_b) values (9, 1, 'c', 'd')`);
      }
      return exec(q);
    };
    expect(await P.changePartner("o", 1, 7, "b", "c", NOW)).toEqual({ ok: false, error: NEW_PAIR_REFUSALS.paired });
    expect(all("select id, player_a, player_b, status from pairs order by id")).toEqual([
      { id: 7, player_a: "a", player_b: "b", status: "active" },
      { id: 9, player_a: "c", player_b: "d", status: "active" },
    ]);
    expect(audits()).toEqual([]);
  });

  it("dissolve and change withdraw the old pair's entries it hasn't played in (D19)", async () => {
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (7, 1, 'a', 'b'), (8, 1, 'c', 'd')`);
    h.raw
      .prepare(
        "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, 'Tél', ?, ?, '2026-11-09')",
      )
      .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
    h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, ?, ?)").run(sec("2026-11-08T23:00:00Z"), sec("2026-11-29T22:59:00Z"));
    h.raw.exec(`insert into season_entries (season_id, pair_id, status, joins_phase) values (1, 7, 'approved', 1), (1, 8, 'pending', null)`);
    expect(await P.changePartner("o", 1, 7, "b", "o", NOW)).toEqual({ ok: true });
    expect(await P.dissolvePair("o", 1, 8, NOW)).toEqual({ ok: true });
    expect(all("select pair_id, status from season_entries order by pair_id")).toEqual([
      { pair_id: 7, status: "withdrawn" },
      { pair_id: 8, status: "withdrawn" },
    ]);
  });

  it("lists the league's pairs with names, levels, average starting Elo, source, status and entry", async () => {
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status) values (7, 1, 'a', 'b', 'dissolved')`);
    await P.createPair("o", 1, "c", "d");
    h.raw
      .prepare(
        "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, 'Tél', ?, ?, '2026-11-09')",
      )
      .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
    h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, ?, ?)").run(sec("2026-11-08T23:00:00Z"), sec("2026-11-29T22:59:00Z"));
    h.raw.exec(`insert into season_entries (season_id, pair_id, status) values (1, 8, 'pending')`);
    h.raw.exec(`update users set phone = '+36301234567' where id = 'c'`);
    const rows = await P.leaguePairs(1, NOW);
    expect(rows).toEqual([
      {
        id: 8,
        players: [
          { id: "c", name: "Cecil", level: "kozephalado", phone: true },
          { id: "d", name: "Dóra", level: "versenyzo", phone: false },
        ],
        elo: 1400,
        source: "manual",
        status: "active",
        locked: false,
        lockedIn: [],
        entry: { seasonId: 1, season: "Tél", status: "pending", joinsPhase: null },
        // #154: an entered pair can be taken out.
        entryAction: { kind: "remove", seasonId: 1, season: "Tél" },
        season: "Tél",
      },
      {
        id: 7,
        players: [
          { id: "a", name: "Anna", level: "halado", phone: false },
          { id: "b", name: "Béla", level: "kezdo", phone: false },
        ],
        elo: 1200,
        source: "signup",
        status: "dissolved",
        locked: false,
        lockedIn: [],
        entry: null,
        entryAction: null,
        season: "Tél",
      },
    ]);
    // Never an email address or phone on the page's data.
    expect(JSON.stringify(rows)).not.toContain("@");
    expect(JSON.stringify(rows)).not.toContain("+36");
  });
});

describe("the player-side pair invite is gone (#97)", () => {
  // Every app source file except tests and the files that only name the
  // kinds and the table for rows already stored (schema, budget, outbox
  // labels, the local seed reset, and the account deletion that removes a
  // deleted person's old rows, #152).
  const ROOT = new URL("../", import.meta.url);
  const KEEP = new Set(["db/schema.ts", "lib/email/budget.ts", "lib/email/outbox-view.ts", "lib/seed.ts", "lib/account-deletion.server.ts"]);
  function sources(dir: URL, prefix = ""): string[] {
    return (readdirSync(dir) as string[]).flatMap((name) => {
      const url = new URL(name, dir);
      const path = prefix + name;
      if (statSync(url).isDirectory()) return name === "test" ? [] : sources(new URL(`${name}/`, dir), `${path}/`);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !KEEP.has(path) ? [path] : [];
    });
  }

  it("no code path queues pair_invite, pair_answer or pair_dissolved, or reads pair_invites", () => {
    const files = sources(ROOT);
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      const text: string = readFileSync(new URL(f, ROOT), "utf8");
      expect(text, f).not.toMatch(/pair_invite|pair_answer|pair_dissolved|pairInvites|queuePair(Invite|Answer|Dissolved)/);
    }
  });
});
