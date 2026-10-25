// The local seed (#90) on a real SQLite with every migration applied
// (~/test/sqlite): what it writes, that running it twice leaves the same
// state, that it clears what a walkthrough made, and that the real app code
// can carry the seeded data from the registration invite to published groups.
// Email is stubbed and fails the test if anything is actually sent.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { phaseCalendar } from "@padel-liga/rules";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/resend.server", () => ({
  MAX_BATCH: 100,
  sendBatch: async () => {
    throw new Error("nothing may be sent");
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { db } = await import("~/db/client.server");
const { users } = await import("~/db/schema");
const Seed = await import("./seed");
const O = await import("~/lib/email/outbox.server");
const SP = await import("~/lib/signup-partners.server");
const E = await import("~/lib/season-entries.server");
const G = await import("~/lib/groups.server");

const NOW = new Date("2026-10-24T10:00:00Z");
const LATER = new Date("2026-11-30T10:00:00Z");

const run = (now = NOW) => h.raw.exec(Seed.seedSql(now));
const rows = (sql: string, ...params: unknown[]): any[] => h.raw.prepare(sql).all(...params);
const count = (table: string) => rows(`select count(*) as n from ${table}`)[0].n as number;

const TABLES = [
  "cities", "clubs", "leagues", "users", "league_admins", "seasons", "season_phases", "interest_signups",
  "account_invites", "email_messages", "pairs", "pair_invites", "season_entries", "groups", "group_pairs",
  "matches", "sessions", "login_codes", "notifications", "audit_log", "broadcasts", "email_suppressions",
];
const sizes = () => Object.fromEntries(TABLES.map((t) => [t, count(t)]));

beforeEach(() => {
  h.raw = migratedDatabase();
});

describe("the seeded state", () => {
  beforeEach(() => run());

  it("has a listed city with a league, 3 clubs and 14 signups", () => {
    expect(rows("select slug, listed from cities where slug = 'minta'")).toEqual([{ slug: "minta", listed: 1 }]);
    expect(rows("select slug from leagues")).toEqual([{ slug: "minta" }]);
    expect(rows("select city from clubs").map((c) => c.city)).toEqual(["minta", "minta", "minta"]);
    expect(rows("select count(*) as n from clubs where active = 1")[0].n).toBe(3);
    expect(rows("select mode, count(*) as n from interest_signups group by mode order by mode")).toEqual([
      { mode: "pair", n: 10 },
      { mode: "solo", n: 4 },
    ]);
    expect(rows("select count(*) as n from interest_signups where city <> 'minta'")[0].n).toBe(0);
  });

  it("has one Admin and one Szervező, and no player accounts", () => {
    expect(rows("select email, platform_role, name <> '' as named, consent_at is not null as consented from users order by email")).toEqual([
      { email: "admin@example.test", platform_role: "superadmin", named: 1, consented: 1 },
      { email: "szervezo@example.test", platform_role: "player", named: 1, consented: 1 },
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

  it("pairs two solos with each other and leaves two waiting", () => {
    const solos = rows("select id, name1, status, paired_with from interest_signups where mode = 'solo' order by id");
    expect(solos.map((s) => s.status)).toEqual(["paired", "paired", "new", "new"]);
    expect(solos[0].paired_with).toBe(solos[1].id);
    expect(solos[1].paired_with).toBe(solos[0].id);
    expect(solos[2].paired_with).toBeNull();
    expect(solos[3].paired_with).toBeNull();
  });

  it("holds nothing yet: no mail, no invite, nobody invited", () => {
    expect(count("email_messages")).toBe(0);
    expect(count("account_invites")).toBe(0);
    expect(rows("select count(*) as n from interest_signups where invited_at is not null or invited2_at is not null")[0].n).toBe(0);
  });

  it("only knows @example.test addresses", () => {
    const emails = [
      ...rows("select email from users"),
      ...rows("select email1 as email from interest_signups"),
      ...rows("select email2 as email from interest_signups where email2 is not null"),
    ].map((r) => r.email as string);
    expect(emails.length).toBe(2 + 20 + 4);
    for (const e of emails) expect(e.endsWith("@example.test"), e).toBe(true);
  });
});

describe("running it twice", () => {
  it("leaves the same state", () => {
    run();
    const first = sizes();
    const signups = rows("select name1, email1, email2, level, status from interest_signups order by email1");
    run();
    expect(sizes()).toEqual(first);
    expect(rows("select name1, email1, email2, level, status from interest_signups order by email1")).toEqual(signups);
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
      insert into interest_signups (mode, name1, email1, level, consent_at) values ('solo', 'Valódi', 'real@example.com', 'kezdo', 1);
      insert into email_messages (kind, to_email, subject, status) values ('pair_invite', 'real@example.com', 's', 'held');
      insert into account_invites (email, note) values ('real@example.com', 'x');
    `);
    const baseline = sizes();
    run();
    const seeded = sizes();

    // A walkthrough: players register, pair up, enter, get approved, groups
    // are drafted and published, mail is held, they log in, ...
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
        ('registration_invite', 'kovacs.anna@example.test', 's', 'held'), ('login_code', 'admin@example.test', 's', 'sent');
      insert into broadcasts (subject, body, audience, recipients, created_by) values ('s', 'b', 'a', 1, 'admin@example.test');
      insert into audit_log (actor_id, action, target) values ('seed-admin', 'x', 'league:minta'), ('seed-organizer', 'y', 'kovacs.anna@example.test');
      insert into email_suppressions (email, reason) values ('nagy.bence@example.test', 'bounced');
      insert into users (id, email, name, level, consent_at) values
        ('u1', 'jatekos1@example.test', 'Egy', 'kezdo', 1), ('u2', 'jatekos2@example.test', 'Kettő', 'kezdo', 1);
      insert into pairs (league_id, player_a, player_b) values (900, 'u1', 'u2');
      insert into interest_signups (mode, name1, email1, level, consent_at) values ('solo', 'Kézi', 'kezi@example.test', 'kezdo', 1);
      insert into interest_signups (mode, name1, email1, level, city, consent_at) values ('solo', 'Kézi', 'kezi@valodi.example.org', 'kezdo', 'minta', 1);
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
    expect(rows("select email1 from interest_signups where email1 = 'real@example.com'")).toHaveLength(1);
    expect(rows("select to_email from email_messages")).toEqual([{ to_email: "real@example.com" }]);
    expect(rows("select email from account_invites")).toEqual([{ email: "real@example.com" }]);
    // What was added inside the fake city goes too: a club, a signup from the public form.
    expect(rows("select slug from clubs where slug = 'uj-klub'")).toHaveLength(0);
    expect(rows("select email1 from interest_signups where email1 like 'kezi%'")).toHaveLength(0);
    expect(count("cities")).toBe(baseline.cities + 1);
    expect(count("leagues")).toBe(baseline.leagues + 1);
  });
});

// The walkthrough, run by the real app code on the seeded rows: registration
// invite, registration (users appear), pairs form, entries, approval, group
// draft and publishing. What the browser steps add on top is checked by hand.
describe("the seed carries the walkthrough", () => {
  beforeEach(() => run());

  const userRow = async (email: string) => (await db.select().from(users)).find((u) => u.email === email)!;

  it("queues the registration invite held, for the 20 pair players and all 4 solos (#96)", async () => {
    expect(await O.queueRegistrationInvites()).toBe(24);
    const held = rows("select to_email, status, text from email_messages where kind = 'registration_invite'");
    expect(held).toHaveLength(24);
    expect(new Set(held.map((m) => m.status))).toEqual(new Set(["held"]));
    // The two solos still waiting for a partner get the solo text.
    const waiting = ["pal.boglarka@example.test", "sandor.akos@example.test"];
    for (const m of held) expect(m.text.includes("Még keresünk neked párt"), m.to_email).toBe(waiting.includes(m.to_email));
    // They can register before 2 Nov because of the account invites.
    expect(count("account_invites")).toBe(24);
    // Nothing goes out until an Admin releases it, and a second run adds nothing.
    expect(await O.queueRegistrationInvites()).toBe(0);
  });

  it("forms the pairs from the signups, lets them enter, and publishes the groups", async () => {
    // Everyone registers (the first-login page done) and logs in.
    const people = [
      ...Seed.PAIR_SIGNUPS.flatMap((p) => [
        { ...p.a, level: p.level },
        { ...p.b, level: p.level },
      ]),
      { ...Seed.SOLO_SIGNUPS[0]!.who, level: Seed.SOLO_SIGNUPS[0]!.level },
      { ...Seed.SOLO_SIGNUPS[1]!.who, level: Seed.SOLO_SIGNUPS[1]!.level },
    ];
    for (const [i, p] of people.entries()) {
      h.raw
        .prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, ?, 1)")
        .run(`player-${i}`, p.email, p.name, p.level);
      await SP.formSignupPairs(`player-${i}`);
    }
    expect(rows("select count(*) as n from pairs where status = 'active'")[0].n).toBe(11);

    // Either player of each pair applies ("Nevezünk").
    const [season] = rows("select id from seasons");
    for (const pair of rows("select player_a from pairs")) {
      const user = (await db.select().from(users)).find((u) => u.id === pair.player_a)!;
      expect(await E.applyToSeason(user, season.id, NOW)).toEqual({ ok: true });
    }
    expect(count("season_entries")).toBe(11);

    // The Szervező approves all of them: they join round 1.
    const organizer = await userRow(Seed.ORGANIZER.email);
    for (const e of rows("select id from season_entries order by id"))
      expect(await E.decideEntry(organizer, season.id, e.id, "approve", null, NOW)).toEqual({ ok: true });
    expect(rows("select distinct joins_phase from season_entries")).toEqual([{ joins_phase: 1 }]);

    // Draft and publish: 11 pairs split into groups of 3 or 4.
    expect(await G.generateDraft(season.id, organizer.id)).toEqual({ ok: true });
    const sizes = rows("select count(*) as n from group_pairs group by group_id").map((r) => r.n).sort();
    expect(sizes.every((n) => n === 3 || n === 4)).toBe(true);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(11);
    expect(await G.publishGroups(season.id, organizer.id, NOW)).toEqual({ ok: true });
    expect(count("matches")).toBeGreaterThan(0);

    // Every email the walkthrough produced is held for the Admin; none was sent.
    const kinds = rows("select kind, status, count(*) as n from email_messages group by kind, status");
    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) expect(k.status, k.kind).toBe("held");
    expect(kinds.map((k) => k.kind)).toEqual(expect.arrayContaining(["season_entry_decision", "groups_published"]));
    for (const m of rows("select to_email from email_messages")) expect(m.to_email.endsWith("@example.test")).toBe(true);
  });
});
