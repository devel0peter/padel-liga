// The local seed (#90) on a real SQLite with every migration applied
// (~/test/sqlite): what it writes, that running it twice leaves the same
// state, that it clears what a walkthrough made, and that the real app code
// can carry the seeded data from registration to published groups.
// Email is stubbed and records what it gets; nothing leaves the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { phaseCalendar } from "@padel-liga/rules";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/background.server", () => import("~/test/background"));
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
const { db } = await import("~/db/client.server");
const { users } = await import("~/db/schema");
const Seed = await import("./seed");
const M = await import("~/lib/league-members.server");
const P = await import("~/lib/pairs.server");
const E = await import("~/lib/season-entries.server");
const G = await import("~/lib/groups.server");

const NOW = new Date("2026-10-24T10:00:00Z");
const LATER = new Date("2026-11-30T10:00:00Z");

const run = (now = NOW) => h.raw.exec(Seed.seedSql(now));
const rows = (sql: string, ...params: unknown[]): any[] => h.raw.prepare(sql).all(...params);
const count = (table: string) => rows(`select count(*) as n from ${table}`)[0].n as number;

const TABLES = [
  "cities", "clubs", "leagues", "users", "league_admins", "league_members", "partner_searches", "seasons", "season_phases",
  "account_invites", "email_messages", "pairs", "pair_invites", "pair_links", "season_entries", "groups", "group_pairs",
  "matches", "sessions", "login_codes", "notifications", "audit_log", "broadcasts", "email_suppressions",
];
const sizes = () => Object.fromEntries(TABLES.map((t) => [t, count(t)]));

beforeEach(() => {
  h.raw = migratedDatabase();
  h.sent = [];
});

describe("the seeded state", () => {
  beforeEach(() => run());

  it("has two listed cities with a league each, 3 clubs, and no interest list (#333)", () => {
    expect(rows("select slug, listed from cities where slug in ('minta', 'pelda') order by slug")).toEqual([
      { slug: "minta", listed: 1 },
      { slug: "pelda", listed: 1 },
    ]);
    expect(rows("select slug from leagues order by slug")).toEqual([{ slug: "minta" }, { slug: "pelda" }]);
    expect(rows("select city from clubs").map((c) => c.city)).toEqual(["minta", "minta", "minta"]);
    expect(rows("select count(*) as n from clubs where active = 1")[0].n).toBe(3);
    expect(count("interest_signups")).toBe(0);
  });

  it("has one Admin and one Szervező of Mintaváros, one player of Példaváros, and no other account", () => {
    expect(rows("select email, platform_role, name <> '' as named, consent_at is not null as consented from users order by email")).toEqual([
      { email: "admin@example.test", platform_role: "superadmin", named: 1, consented: 1 },
      { email: "idegen.ilona@example.test", platform_role: "player", named: 1, consented: 1 },
      { email: "szervezo@example.test", platform_role: "player", named: 1, consented: 1 },
    ]);
    // Who belongs where (D128).
    expect(rows("select l.slug, u.email from league_members m join leagues l on l.id = m.league_id join users u on u.id = m.user_id order by l.slug, u.email")).toEqual([
      { slug: "minta", email: "admin@example.test" },
      { slug: "minta", email: "szervezo@example.test" },
      { slug: "pelda", email: "idegen.ilona@example.test" },
    ]);
    expect(rows("select u.email from league_admins la join users u on u.id = la.user_id")).toEqual([
      { email: "szervezo@example.test" },
    ]);
    expect(count("pairs")).toBe(0);
  });

  it("opens registration now and starts round 1 in about two weeks", () => {
    const [s] = rows("select * from seasons");
    expect(s.registration_opens_at).toBeLessThan(NOW.getTime() / 1000);
    expect(s.registration_closes_at).toBeGreaterThan(NOW.getTime() / 1000);
    const phases = rows("select number, starts_at, deadline from season_phases order by number");
    expect(phases).toHaveLength(4);
    expect(s.registration_closes_at).toBeLessThan(phases[0].starts_at);
    expect(phases[0].starts_at - NOW.getTime() / 1000).toBeLessThanOrEqual(17 * 86400);
    expect(phases[0].starts_at - NOW.getTime() / 1000).toBeGreaterThanOrEqual(10 * 86400);
    const expected = phaseCalendar(s.first_phase_start, []);
    expect(phases.map((p) => [p.starts_at, p.deadline])).toEqual(
      expected.map((p) => [p.startsAt.getTime() / 1000, p.deadline.getTime() / 1000]),
    );
  });

  it("holds nothing yet: no mail, no invite", () => {
    expect(count("email_messages")).toBe(0);
    expect(count("account_invites")).toBe(0);
  });

  it("only knows @example.test addresses", () => {
    const emails = rows("select email from users").map((r) => r.email as string);
    expect(emails.length).toBe(3);
    for (const e of emails) expect(e.endsWith("@example.test"), e).toBe(true);
  });
});

describe("running it twice", () => {
  it("leaves the same state", () => {
    run();
    const first = sizes();
    const members = rows("select l.slug, m.user_id, m.source from league_members m join leagues l on l.id = m.league_id order by 1, 2");
    run();
    expect(sizes()).toEqual(first);
    expect(rows("select l.slug, m.user_id, m.source from league_members m join leagues l on l.id = m.league_id order by 1, 2")).toEqual(members);
    // Still exactly one season, with its four phases.
    expect(first.seasons).toBe(1);
    expect(first.season_phases).toBe(4);
  });

  it("moves the season dates to the new day", () => {
    run();
    const before = rows("select first_phase_start from seasons")[0].first_phase_start;
    run(LATER);
    const after = rows("select first_phase_start from seasons")[0].first_phase_start;
    expect(before).toBe("2026-11-09");
    expect(after).toBe("2026-12-14");
    expect(count("season_phases")).toBe(4);
  });

  it("clears what a walkthrough made on top, and leaves other data alone", () => {
    h.raw.exec(`
      insert into users (id, email, name, level, consent_at) values
        ('real', 'real@example.com', 'Valódi', 'kezdo', 1), ('real2', 'real2@example.com', 'Valódi2', 'kezdo', 1);
      insert into leagues (id, city, slug, name) values (900, 'gyor', 'gyor', 'Padelpárbaj Győr');
      insert into email_messages (kind, to_email, subject, status) values ('pair_invite', 'real@example.com', 's', 'sent');
      insert into account_invites (email, note) values ('real@example.com', 'x');
    `);
    const baseline = sizes();
    run();
    const seeded = sizes();

    // A walkthrough: players register, pair up, enter, groups
    // are drafted and published, mail goes out, they log in, ...
    h.raw.exec(`
      insert into users (id, email, name, level, consent_at) values
        ('w1', 'kovacs.anna@example.test', 'Kovács Anna', 'halado', 1), ('w2', 'nagy.bence@example.test', 'Nagy Bence', 'halado', 1);
      insert into sessions (id_hash, user_id, expires_at) values ('h1', 'w1', 9999999999), ('h2', 'seed-organizer', 9999999999);
      insert into login_codes (email, code_hash, expires_at, window_start) values ('kovacs.anna@example.test', 'c', 9999999999, 1);
      insert into account_invites (email, note) values ('kovacs.anna@example.test', 'Jelentkező');
      insert into notifications (user_id, kind, title, body, url) values ('w1', 'test', 't', 'b', '/');
      insert into pair_invites (league_id, inviter_id, invitee_email, token_hash) select id, 'w1', 'valaki@example.test', 'tok' from leagues where slug = 'minta';
      insert into pairs (league_id, player_a, player_b) select id, 'w1', 'w2' from leagues where slug = 'minta';
      insert into season_entries (season_id, pair_id, status, decided_by) select (select id from seasons), (select id from pairs), 'approved', 'seed-organizer';
      insert into groups (season_id, phase, number) select id, 1, 1 from seasons;
      insert into group_pairs (group_id, pair_id, seed) select (select id from groups), (select id from pairs), 1;
      insert into email_messages (kind, to_email, subject, status) values
        ('registration_invite', 'kovacs.anna@example.test', 's', 'pending'), ('login_code', 'admin@example.test', 's', 'sent');
      insert into broadcasts (subject, body, audience, recipients, created_by) values ('s', 'b', 'a', 1, 'admin@example.test');
      insert into audit_log (actor_id, action, target) values ('seed-admin', 'x', 'league:minta'), ('seed-organizer', 'y', 'kovacs.anna@example.test');
      insert into email_suppressions (email, reason) values ('nagy.bence@example.test', 'bounced');
      insert into users (id, email, name, level, consent_at) values
        ('u1', 'jatekos1@example.test', 'Egy', 'kezdo', 1), ('u2', 'jatekos2@example.test', 'Kettő', 'kezdo', 1);
      insert into pairs (league_id, player_a, player_b) values (900, 'u1', 'u2');
      insert into clubs (slug, city, name) values ('uj-klub', 'minta', 'Új klub');
    `);
    // A second pair that matches the first one's group, so matches exist too.
    h.raw.exec(`
      insert into users (id, email, name, level, consent_at) values
        ('w3', 'szabo.eszter@example.test', 'Szabó Eszter', 'kezdo', 1), ('w4', 'toth.gergo@example.test', 'Tóth Gergő', 'kezdo', 1);
      insert into pairs (league_id, player_a, player_b) select id, 'w3', 'w4' from leagues where slug = 'minta';
      insert into matches (group_id, pair_a, pair_b, week, deadline) select (select id from groups), (select min(id) from pairs), (select max(id) from pairs), 1, 1;
    `);

    run();
    expect(sizes()).toEqual(seeded);
    // The unrelated rows are still there.
    expect(rows("select email from users where email like '%example.com' order by email").map((u) => u.email)).toEqual([
      "real2@example.com",
      "real@example.com",
    ]);
    expect(rows("select slug from leagues where slug = 'gyor'")).toHaveLength(1);
    // A pair of example users in another league is gone too (pairs have no cascade from users).
    expect(count("pairs")).toBe(0);
    expect(rows("select to_email from email_messages")).toEqual([{ to_email: "real@example.com" }]);
    expect(rows("select email from account_invites")).toEqual([{ email: "real@example.com" }]);
    // What was added inside the fake city goes too: a club.
    expect(rows("select slug from clubs where slug = 'uj-klub'")).toHaveLength(0);
    expect(count("cities")).toBe(baseline.cities + 2);
    expect(count("leagues")).toBe(baseline.leagues + 2);
  });
});

// The walkthrough, run by the real app code on the seeded rows: registration
// invite, registration (users appear), pairs form, entries, approval, group
// draft and publishing. What the browser steps add on top is checked by hand.
describe("the seed carries the walkthrough", () => {
  beforeEach(() => run());

  const userRow = async (email: string) => (await db.select().from(users)).find((u) => u.email === email)!;

  it("lets the players join through the register button, pair up, enter, and publishes the groups", async () => {
    // Everyone registers through Mintaváros's register button (D128) and
    // finishes the first-login page.
    const people = [
      ...Seed.PAIR_PLAYERS.flatMap((p) => [
        { ...p.a, level: p.level },
        { ...p.b, level: p.level },
      ]),
      { ...Seed.SOLO_PLAYERS[0]!.who, level: Seed.SOLO_PLAYERS[0]!.level },
      { ...Seed.SOLO_PLAYERS[1]!.who, level: Seed.SOLO_PLAYERS[1]!.level },
    ];
    for (const [i, p] of people.entries()) {
      h.raw
        .prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, ?, 1)")
        .run(`player-${i}`, p.email, p.name, p.level);
      await M.joinFromRegisterButton(`player-${i}`, Seed.LEAGUE.slug);
    }
    const [league] = rows("select id from leagues where slug = 'minta'");
    const organizer = await userRow(Seed.ORGANIZER.email);
    // Only Mintaváros's players are offered on its Párok, never Idegen Ilona (#331).
    const candidates = (await P.pairCandidates(league)).map((c) => c.id);
    expect(candidates).toHaveLength(24);
    expect(candidates).not.toContain(Seed.OUTSIDER.id);
    // The Szervező pairs them on Párok, as the walkthrough's pair links would.
    for (let i = 0; i < people.length; i += 2) expect(await P.createPair(organizer.id, league.id, `player-${i}`, `player-${i + 1}`)).toEqual({ ok: true });
    expect(rows("select count(*) as n from pairs where status = 'active'")[0].n).toBe(11);
    // The emails go after the response (D150): let them finish first.
    await settleBackground();
    h.raw.exec("delete from email_messages where kind = 'pair_created'");

    // Either player of each pair enters ("Nevezünk"): it counts at once, for round 1 (#153).
    const [season] = rows("select id from seasons");
    for (const pair of rows("select player_a from pairs")) {
      const user = (await db.select().from(users)).find((u) => u.id === pair.player_a)!;
      expect(await E.applyToSeason(user, season.id, NOW)).toMatchObject({ ok: true, joins: { phase: 1 } });
    }
    await settleBackground();
    expect(count("season_entries")).toBe(11);
    expect(rows("select distinct status, joins_phase from season_entries")).toEqual([{ status: "approved", joins_phase: 1 }]);
    // Both players of every pair got the notice, with nothing else to do (#112).
    expect(rows("select status, count(*) as n from email_messages where kind = 'season_entry_decision' group by status")).toEqual([
      { status: "sent", n: 22 },
    ]);

    // Draft and publish: 11 pairs split into groups of 3 or 4.
    expect(await G.generateDraft(season.id, organizer.id)).toEqual({ ok: true });
    const sizes = rows("select count(*) as n from group_pairs group by group_id").map((r) => r.n).sort();
    expect(sizes.every((n) => n === 3 || n === 4)).toBe(true);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(11);
    expect(await G.publishGroups(season.id, organizer.id, NOW)).toEqual({ ok: true });
    expect(count("matches")).toBeGreaterThan(0);
    // One email per player, sent right after the response (#112, D150).
    await settleBackground();
    expect(rows("select status, count(*) as n from email_messages where kind = 'groups_published' group by status")).toEqual([
      { status: "sent", n: 22 },
    ]);

    // Every email the walkthrough produced went out by itself (#112).
    const kinds = rows("select kind, status, count(*) as n from email_messages group by kind, status");
    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) expect(k.status, k.kind).toBe("sent");
    expect(kinds.map((k) => k.kind)).toEqual(expect.arrayContaining(["season_entry_decision", "groups_published"]));
    for (const m of rows("select to_email from email_messages")) expect(m.to_email.endsWith("@example.test")).toBe(true);
    for (const m of h.sent) expect(m.to.endsWith("@example.test")).toBe(true);
  });
});
