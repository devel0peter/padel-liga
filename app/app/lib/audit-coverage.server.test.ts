// The audit log guard (#225, D91): every organizer, Admin and system action
// is run once, through the same server function its page or job calls, on a
// real SQLite with every migration applied, and must leave exactly one entry
// of its action. Removing an entry write from any of them fails its step.
// A new admin page with an action fails "every admin action is covered" until
// its actions are added to ROUTE_ACTIONS and given a step here.
// Email is captured, never sent.
import { phaseCalendar } from "@padel-liga/rules";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { AUDIT_ACTIONS, isSystemAction, type AuditAction } from "~/lib/audit";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: { EMAIL_DAILY_LIMIT: "100" } }));
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
const CITIES = await import("~/lib/cities.server");
const LEAGUES = await import("~/lib/leagues.server");
const CLUBS = await import("~/lib/clubs.server");
const SEASONS = await import("~/lib/seasons.server");
const REMINDERS = await import("~/lib/reminders.server");
const PAIRS = await import("~/lib/pairs.server");
const ENTRIES = await import("~/lib/season-entries.server");
const GROUPS = await import("~/lib/groups.server");
const RESULTS = await import("~/lib/results.server");
const DECISIONS = await import("~/lib/decisions.server");
const SIGNUPS = await import("~/lib/signups-admin.server");
const SOLO = await import("~/lib/solo-pairing.server");
const OUTBOX = await import("~/lib/email/outbox.server");
const DELETION = await import("~/lib/account-deletion.server");
const DEADLINE = await import("~/lib/deadline.server");
const STRIKES = await import("~/lib/strikes.server");

// Node built-ins: this runs in Vitest (Node) but is type-checked with the
// Workers types, which have no node:fs.
const { readdirSync, readFileSync } = await import(/* @vite-ignore */ `node:${"fs"}`);

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const all = (q: string, ...p: unknown[]) => h.raw.prepare(q).all(...p);
const one = (q: string, ...p: unknown[]) => h.raw.prepare(q).get(...p);
const league = { id: 1, slug: "gyor", city: "gyor", name: "Padelpárbaj Győr" };
const ADMIN = "adm";
const ORG = "o";

// The first season: registration 1-5 Nov, phase 1 Mon 9 - Sun 29 Nov 2026.
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const ENTRY_TIME = new Date("2026-11-03T10:00:00Z");
const PUBLISHED = new Date("2026-11-08T08:00:00Z");
const PLAYED = new Date("2026-11-10T19:00:00Z");
const IN_PHASE = new Date("2026-11-11T10:00:00Z");
const AFTER_48H = new Date("2026-11-13T10:00:00Z");
const AFTER_PHASE = new Date("2026-12-01T10:00:00Z");

function world() {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  PHASES.forEach((start, i) =>
    h.raw
      .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, ?, ?, ?)")
      .run(i + 1, sec(start), sec(start) + 21 * 86400 - 60),
  );
  h.raw.exec(`insert into users (id, email, name, platform_role, level, consent_at) values ('adm', 'adm@x.hu', 'Admin', 'superadmin', 'halado', 1)`);
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('o', 'o@x.hu', 'Org', 'halado', 1), ('o2', 'o2@x.hu', 'Org Kettő', 'halado', 1)`);
  h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'o')`);
  // Pairs 1-7 entered for season 1 (a 4 and a 3 group); players with phones.
  for (let id = 1; id <= 7; id++) {
    for (const side of ["a", "b"])
      h.raw
        .prepare("insert into users (id, email, name, level, phone, consent_at) values (?, ?, ?, 'halado', ?, 1)")
        .run(`p${id}${side}`, `p${id}${side}@x.hu`, `Játékos ${id}${side}`, `+3630${id}00000${side === "a" ? 1 : 2}`);
    h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)").run(id, `p${id}a`, `p${id}b`);
    h.raw
      .prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, 'approved', 1, ?)")
      .run(id, sec("2026-11-02T10:00:00Z") + id);
  }
  // Free players for new pairs, and an account to delete with no history.
  for (const id of ["q1", "q2", "r1", "r2", "r3", "gone"])
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, 'halado', 1)").run(id, `${id}@x.hu`, `Játékos ${id}`);
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (9, 1, 'r1', 'r2')`);
  // Interest list: two solos to pair, one to edit and delete, one to invite.
  const signup = h.raw.prepare("insert into interest_signups (id, mode, name1, email1, level, consent_at) values (?, ?, ?, ?, 'halado', 1)");
  signup.run(1, "solo", "Solo Egy", "s1@x.hu");
  signup.run(2, "solo", "Solo Kettő", "s2@x.hu");
  signup.run(3, "pair", "Jel Entkező", "j1@x.hu");
  signup.run(4, "pair", "Meg Hívott", "inv@x.hu");
}

const lastId = () => (one("select coalesce(max(id), 0) as n from audit_log").n as number);
let mark = 0;

// Runs `run` and returns the entries it added.
async function added(run: () => Promise<unknown>): Promise<{ actor_id: string | null; action: string; target: string; detail: string | null; league_id: number | null }[]> {
  mark = lastId();
  await run();
  return all("select actor_id, action, target, detail, league_id from audit_log where id > ? order by id", mark);
}

type Step = { action: AuditAction; actor: string | null; run: () => Promise<unknown>; also?: AuditAction[] };

// In order: later steps build on earlier ones.
const STEPS: Step[] = [
  { action: "city.create", actor: ADMIN, run: () => CITIES.createCity({ slug: "pecs", name: "Pécs", listed: false }, ADMIN) },
  { action: "city.update", actor: ADMIN, run: () => CITIES.updateCity("pecs", { name: "Pécs!", listed: false }, ADMIN) },
  { action: "city.delete", actor: ADMIN, run: () => CITIES.deleteCity("pecs", ADMIN) },
  { action: "league.create", actor: ADMIN, run: () => LEAGUES.createLeague({ city: "gyor", name: "Győr 2", slug: "gyor2" }, ADMIN) },
  { action: "league_admin.grant", actor: ADMIN, run: () => LEAGUES.grantOrganizer(league, "o2@x.hu", ADMIN) },
  { action: "league_admin.revoke", actor: ADMIN, run: () => LEAGUES.revokeOrganizer(league, "o2", ADMIN) },
  { action: "league_admin.invite", actor: ADMIN, run: () => LEAGUES.grantOrganizer(league, "new@x.hu", ADMIN) },
  { action: "league_admin.invite_cancel", actor: ADMIN, run: () => LEAGUES.cancelOrganizerInvite(league, "new@x.hu", ADMIN) },
  { action: "club.create", actor: ORG, run: () => CLUBS.createClub({ slug: "ace", city: "gyor", name: "Ace", adminNote: null }, ORG) },
  { action: "club.update", actor: ORG, run: () => CLUBS.updateClub(clubId(), { slug: "ace", city: "gyor", name: "Ace Padel", adminNote: null }, ORG) },
  { action: "club.deactivate", actor: ORG, run: () => CLUBS.setClubActive(clubId(), false, ORG) },
  { action: "club.activate", actor: ORG, run: () => CLUBS.setClubActive(clubId(), true, ORG) },
  { action: "club.delete", actor: ORG, run: () => CLUBS.deleteClub(clubId(), ORG) },
  { action: "season.create", actor: ORG, run: () => SEASONS.createSeason(1, SPRING, phaseCalendar(SPRING.firstPhaseStart, []), ORG) },
  { action: "season.update", actor: ORG, run: () => SEASONS.updateSeason(springId(), { ...SPRING, name: "Tavasz!" }, phaseCalendar(SPRING.firstPhaseStart, []), ORG) },
  { action: "season.delete", actor: ORG, run: () => SEASONS.deleteSeason(springId(), ORG) },
  { action: "reminders.on", actor: ORG, run: () => REMINDERS.setReminders(ORG, league, true) },
  { action: "reminders.off", actor: ORG, run: () => REMINDERS.setReminders(ORG, league, false) },
  { action: "pair.create", actor: ORG, run: () => expectOk(PAIRS.createPair(ORG, 1, "q1", "q2")) },
  { action: "season_entry.enter", actor: ORG, run: () => expectOk(ENTRIES.enterPairByOrganizer({ id: ORG }, 1, pairOf("q1"), 1, ENTRY_TIME)) },
  { action: "season_entry.remove", actor: ORG, run: () => expectOk(ENTRIES.removePairFromSeason({ id: ORG }, 1, pairOf("q1"), 1, ENTRY_TIME)) },
  { action: "pair.dissolve", actor: ORG, run: () => expectOk(PAIRS.dissolvePair(ORG, 1, pairOf("q1"), ENTRY_TIME)) },
  { action: "pair.change", actor: ORG, run: () => expectOk(PAIRS.changePartner(ORG, 1, 9, "r1", "r3", ENTRY_TIME)) },
  { action: "groups.draft", actor: ORG, run: () => expectOk(GROUPS.generateDraft(1, ORG)) },
  { action: "groups.move", actor: ORG, run: () => expectOk(GROUPS.moveDraftPair(1, firstPairOfGroup(1), 2, ORG)) },
  { action: "groups.publish", actor: ORG, run: () => expectOk(GROUPS.publishGroups(1, ORG, PUBLISHED)) },
  {
    action: "match.decide",
    actor: ORG,
    run: () => expectOk(DECISIONS.decideMatch(ORG, 1, matchIds()[0]!, { kind: "walkover", winner: "a" }, "Nem jöttek el.", IN_PHASE)),
  },
  {
    action: "result.auto_accept",
    actor: null,
    run: async () => {
      const id = matchIds()[1]!;
      const [pa] = all("select p.player_a from matches m join pairs p on p.id = m.pair_a where m.id = ?", id);
      expect(await RESULTS.resultStep(pa.player_a, id, { kind: "record", score: { sets: [[4, 1], [4, 2]] } }, PLAYED)).toMatchObject({ ok: true });
      mark = lastId();
      expect(await RESULTS.autoAcceptResults(AFTER_48H)).toBe(1);
    },
  },
  { action: "season_entry.withdraw", actor: ORG, run: () => expectOk(ENTRIES.withdrawPairMidPhase({ id: ORG }, 1, 7, 1, "Sérülés.", IN_PHASE)) },
  // One match resolved after the deadline (#11): nobody scheduled it, so both
  // pairs' players get a strike (#294), which the organizer then cancels.
  { action: "match.deadline", actor: null, run: () => DEADLINE.resolveDeadlines(AFTER_PHASE, undefined, 1).then((r) => expect(r.resolved).toBe(1)) },
  {
    action: "strike.cancel",
    actor: ORG,
    run: () => expectOk(STRIKES.cancelStrike(ORG, 1, one("select min(id) as id from strikes").id, "Beteg volt.", AFTER_PHASE)),
  },
  { action: "signup.update", actor: ADMIN, run: () => SIGNUPS.updateSignup(3, { status: "contacted", adminNote: "hívd fel" }, ADMIN) },
  { action: "signup.delete", actor: ADMIN, run: () => SIGNUPS.deleteSignup(3, ADMIN) },
  { action: "solo.pair", actor: ORG, run: () => SOLO.pairSolos(ORG, 1, 1, 2, "gyor", "Győr").then((e) => expect(e).toBeNull()) },
  { action: "solo.unpair", actor: ORG, run: () => SOLO.unpairSolo(ORG, 1, 1, "gyor") },
  {
    action: "broadcast.send",
    actor: ADMIN,
    run: () =>
      OUTBOX.createBroadcast({ subject: "Hír", body: "Szia {név}!", audience: "Jelentkezők · „anna@x.hu”", recipients: [{ email: "p1a@x.hu", name: "Játékos 1a" }], createdBy: "adm@x.hu", actorId: ADMIN }),
  },
  { action: "registration_invites.send", actor: ADMIN, run: () => OUTBOX.queueRegistrationInvites(ENTRY_TIME, undefined, ADMIN).then((n) => expect(n).toBeGreaterThan(0)) },
  { action: "account.delete", actor: ADMIN, run: () => DELETION.deleteAccount(ADMIN, "gone", IN_PHASE).then((r) => expect(r).toEqual({ ok: true, mode: "remove" })) },
  {
    action: "account.anonymize",
    actor: ADMIN,
    also: ["pair.dissolve"],
    run: () => DELETION.deleteAccount(ADMIN, "p5a", AFTER_PHASE).then((r) => expect(r).toEqual({ ok: true, mode: "anonymize" })),
  },
];

const SPRING = { name: "Tavasz", registrationOpens: "2027-03-01", registrationCloses: "2027-03-20", firstPhaseStart: "2027-03-22", breaks: [] };
const clubId = () => one("select id from clubs where slug = 'ace'").id as number;
const springId = () => one("select id from seasons where name like 'Tavasz%'").id as number;
const pairOf = (player: string) => one("select id from pairs where player_a = ? order by id desc", player).id as number;
const firstPairOfGroup = (n: number) => one("select gp.pair_id from group_pairs gp join groups g on g.id = gp.group_id where g.number = ? order by gp.seed", n).pair_id as number;
const matchIds = () => all("select id from matches order by id").map((r: any) => r.id as number);
async function expectOk(p: Promise<{ ok: boolean; error?: string }>) {
  expect(await p).toMatchObject({ ok: true });
}

// The actions written by scripts and players, outside this guard: the CLI
// (scripts/superadmin.mjs, scripts/invite.mjs) and a player's own pair link
// and partner search (their own tests check the entry).
const OUTSIDE: AuditAction[] = ["superadmin.grant", "superadmin.revoke", "account_invite.create", "pair.link", "partner_search.on", "partner_search.off"];

// Every admin page with an action, and the audit actions its action writes.
const ROUTE_ACTIONS: Record<string, AuditAction[]> = {
  "admin.broadcast-new.tsx": ["broadcast.send"],
  "admin.cities.tsx": ["city.create", "city.update", "city.delete"],
  "admin.clubs.tsx": ["club.create", "club.update", "club.activate", "club.deactivate", "club.delete"],
  "admin.league-clubs.tsx": ["club.create", "club.update", "club.activate", "club.deactivate", "club.delete"],
  "admin.league-pairs.tsx": ["pair.create", "pair.dissolve", "pair.change", "season_entry.enter", "season_entry.remove", "season_entry.withdraw", "strike.cancel"],
  "admin.league-reminders.tsx": ["reminders.on", "reminders.off"],
  "admin.league-seasons.tsx": ["season.create", "season.update", "season.delete"],
  "admin.league-solos.tsx": ["pair.create", "solo.pair", "solo.unpair"],
  "admin.leagues.tsx": ["league.create", "league_admin.grant", "league_admin.invite", "league_admin.revoke", "league_admin.invite_cancel"],
  "admin.match-decide.tsx": ["match.decide"],
  "admin.season-groups.tsx": ["groups.draft", "groups.move", "groups.publish"],
  "admin.signups.tsx": ["signup.update", "signup.delete", "registration_invites.send"],
  "admin.users.tsx": ["account.delete", "account.anonymize"],
};

describe("every organizer and system change leaves one audit entry (#225)", () => {
  beforeAll(world);

  for (const step of STEPS)
    it(`${step.action}`, async () => {
      const entries = await added(async () => {
        await step.run();
        await settleBackground();
      });
      // auto-accept moves the mark past the player's own result first.
      const own = entries.filter((e) => e.action === step.action);
      expect(own, `${step.action} wrote ${own.length} entries`).toHaveLength(1);
      expect(own[0]!.actor_id).toBe(step.actor);
      // Napló shows an entry without an actor as "Rendszer" only for these (#226).
      expect(isSystemAction(step.action), "actor null needs SYSTEM_ACTIONS").toBe(step.actor === null);
      expect(entries.map((e) => e.action).sort()).toEqual([step.action, ...(step.also ?? [])].sort());
    });

  it("no entry names an email address or a phone number, and league entries carry their league", () => {
    const rows = all("select action, target, detail, league_id from audit_log");
    expect(rows.length).toBeGreaterThanOrEqual(STEPS.length);
    for (const r of rows) {
      expect(`${r.target} ${r.detail}`, r.action).not.toMatch(/@/);
      expect(`${r.target} ${r.detail}`, r.action).not.toMatch(/\+?36\d{6,}/);
    }
    const leagueActions = rows.filter((r: any) => /^(pair|season|season_entry|groups|match|result|reminders|league_admin|league|solo|strike)\./.test(r.action));
    for (const r of leagueActions) expect(r.league_id, r.action).not.toBeNull();
  });

  it("every admin action is covered: each page's actions have a step here", () => {
    const routes = new URL("../routes/", import.meta.url);
    const withAction = (readdirSync(routes) as string[])
      .filter((f) => /^admin\..*\.tsx?$/.test(f) && !f.includes(".test."))
      .filter((f) => /export (async )?function action\b/.test(readFileSync(new URL(f, routes), "utf8")))
      .sort();
    expect(withAction).toEqual(Object.keys(ROUTE_ACTIONS).sort());
    const stepped = new Set(STEPS.flatMap((s) => [s.action, ...(s.also ?? [])]));
    for (const action of Object.values(ROUTE_ACTIONS).flat()) expect(stepped, action).toContain(action);
    // And every action Napló knows is either stepped here or written outside.
    for (const action of Object.keys(AUDIT_ACTIONS) as AuditAction[]) expect(stepped.has(action) || OUTSIDE.includes(action), action).toBe(true);
  });
});
