// account-deletion.server.ts (#152) on a real SQLite with every migration
// applied (~/test/sqlite): full removal without history, anonymization with
// history, the running-phase refusal and the Admin guards. The email module
// is a recorder: a deletion queues nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[], codes: [] as string[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueSeasonEntryDecision: async (...args: any[]) => h.mails.push(args),
  queueGroupsPublished: async (...args: any[]) => h.mails.push(args),
  // A login code is recorded apart: it is the one mail the tests below expect.
  dailyLimit: () => 100,
  queueLoginCode: async (to: string) => h.codes.push(to),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const D = await import("~/lib/account-deletion.server");
const { DELETED_NAME, DELETION_REFUSALS, PARTNER_NOTICE_SUBJECT_REMOVED } = await import("~/lib/account-deletion");
const { partnerNoticeSubject } = await import("~/lib/email/templates");
const { pairCandidates } = await import("~/lib/pairs.server");
const { leaguePairsAudience } = await import("~/lib/league-pairs-view.server");
const { findUserIdByEmail } = await import("~/lib/auth/accounts.server");
const { sendLoginCode } = await import("~/lib/auth/login-code.server");
const { updateElo } = await import("~/lib/elo.server");
const { ladderPage } = await import("~/lib/ladder.server");
const { pairProfile, playerProfile } = await import("~/lib/profiles.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
// During phase 1 (9–29 Nov) and after it.
const DURING = new Date("2026-11-12T12:00:00Z");
const AFTER = new Date("2026-12-01T12:00:00Z");
const one = (q: string, ...p: any[]) => h.raw.prepare(q).get(...p);
const all = (q: string, ...p: any[]) => h.raw.prepare(q).all(...p);
const n = (q: string, ...p: any[]) => Object.values(one(q, ...p) as object)[0] as number;

function freshDb() {
  h.raw = migratedDatabase();
  h.mails = [];
  h.codes = [];
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  h.raw.exec(`insert into users (id, email, name, platform_role, consent_at) values ('admin', 'admin@x.hu', 'Admin', 'superadmin', 1), ('admin2', 'admin2@x.hu', 'Admin2', 'superadmin', 1)`);
  for (const id of ["a", "b", "c", "d"])
    h.raw
      .prepare("insert into users (id, email, name, level, phone, sex, image_url, consent_at, last_login_at) values (?, ?, ?, 'halado', '+36301234567', 'female', 'http://img', 1, 1)")
      .run(id, `${id}@x.hu`, id.toUpperCase());
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (1, 1, 'a', 'b'), (2, 1, 'c', 'd')`);
  h.raw
    .prepare("insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, 'Tél', ?, ?, '2026-11-09')")
    .run(sec("2026-10-28T23:00:00Z"), sec("2026-11-06T22:59:00Z"));
  h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, ?, ?), (1, 2, ?, ?)").run(
    sec("2026-11-08T23:00:00Z"),
    sec("2026-11-29T22:59:00Z"),
    sec("2026-11-29T23:00:00Z"),
    sec("2026-12-20T22:59:00Z"),
  );
  h.raw.exec(`insert into season_entries (season_id, pair_id, status) values (1, 1, 'pending'), (1, 2, 'approved')`);
  // Everything personal tied to 'a' (and the address a@x.hu).
  h.raw.exec(`insert into sessions (id_hash, user_id, expires_at) values ('s-a', 'a', 9999999999)`);
  h.raw.exec(`insert into oauth_accounts (provider, provider_user_id, user_id) values ('google', 'g-a', 'a')`);
  h.raw.exec(`insert into push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push/a', 'a', 'k', 'x')`);
  h.raw.exec(`insert into notifications (user_id, kind, title, body, url) values ('a', 'test', 't', 'b', '/')`);
  h.raw.exec(`insert into notification_opt_outs (user_id, kind) values ('a', 'channel:email')`);
  h.raw.exec(`insert into pair_links (league_id, owner_id, token) values (1, 'a', 'tok-a')`);
  h.raw.exec(`insert into partner_searches (league_id, user_id, seeking) values (1, 'a', 1)`);
  h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'a')`);
  h.raw.exec(`insert into login_codes (email, code_hash, expires_at, window_start) values ('a@x.hu', 'h', 1, 1)`);
  h.raw.exec(`insert into account_invites (email) values ('a@x.hu')`);
  h.raw.exec(`insert into stuck_reminder_people (season_id, email, situation) values (1, 'a@x.hu', 'C'), (1, 'b@x.hu', 'D')`);
  h.raw.exec(`insert into email_suppressions (email, reason) values ('a@x.hu', 'unsubscribed')`);
  h.raw.exec(`insert into audit_log (actor_id, action, target) values ('admin', 'league_admin.grant', 'a@x.hu')`);
  h.raw.exec(`insert into email_messages (kind, to_email, subject, status) values ('login_code', 'a@x.hu', 's', 'pending'), ('login_code', 'a@x.hu', 's', 'sent'), ('login_code', 'b@x.hu', 's', 'pending')`);
  // Interest list: a's own pair signup (with b), a solo of a's paired with
  // c's solo, and d's pair signup naming a as the partner.
  const signup = h.raw.prepare(
    "insert into interest_signups (id, mode, name1, email1, name2, email2, level, consent_at, paired_with, invited2_at) values (?, ?, ?, ?, ?, ?, 'kezdo', 1, ?, ?)",
  );
  signup.run(10, "pair", "A", "A@x.hu", "B", "b@x.hu", null, null);
  signup.run(11, "solo", "A", "a@x.hu", null, null, 12, null);
  signup.run(12, "solo", "C", "c@x.hu", null, null, 11, null);
  signup.run(13, "pair", "D", "d@x.hu", "A", "a@x.hu", null, 1);
  h.raw.exec(`update interest_signups set status = 'paired' where id in (11, 12)`);
  // Mail stored for other people that names a (review of #152). Goes or
  // changes:
  // - 100: the partner notice a's pair signup sent b (sent: subject only)
  // - 102: a's solo introduction to c (unsent, has a's address)
  // - 103: an entry decision to the partner b (unsent, has a's name)
  // - 104: group mail to c, an opponent and not a's partner (unsent)
  // - 108: a failed match proposal to c naming a
  // Stays:
  // - 101: a partner notice from someone else
  // - 105: a pair intro with anna@x.hu, which merely ends in a@x.hu
  // - 106: a broadcast to another "Anna Teszt", her own name
  // - 107: group mail naming "Anna Tesztelő", a different name
  // - 109: group mail to another "Anna Teszt", her own name only in the greeting
  h.raw.exec(`update users set name = 'Anna Teszt' where id = 'a'`);
  const mail = h.raw.prepare("insert into email_messages (id, kind, to_email, subject, text, status) values (?, ?, ?, ?, ?, ?)");
  mail.run(100, "partner_notice", "b@x.hu", partnerNoticeSubject("A"), null, "sent");
  mail.run(101, "partner_notice", "b@x.hu", partnerNoticeSubject("Zoli"), null, "sent");
  mail.run(102, "pair_intro", "c@x.hu", "Találtunk neked párt", "Az e-mail-címe: a@x.hu\nŐ is megkapta", "pending");
  mail.run(103, "season_entry_decision", "b@x.hu", "Jóváhagyták", "Szia B! Anna Teszt és te nevezhettek.", "pending");
  mail.run(104, "groups_published", "c@x.hu", "Itt a csoportod", "1. hét: Anna Teszt és B ellen", "pending");
  mail.run(105, "pair_intro", "d@x.hu", "Találtunk neked párt", "Az e-mail-címe: anna@x.hu", "pending");
  mail.run(106, "broadcast", "anna.masik@x.hu", "Hírek", "Szia Anna Teszt!", "pending");
  mail.run(107, "groups_published", "d@x.hu", "Itt a csoportod", "1. hét: Anna Tesztelő és Béla ellen", "pending");
  mail.run(108, "match_proposal", "c@x.hu", "Időpontokat ajánlottak", "Anna Teszt és B időpontokat ajánlott.", "failed");
  mail.run(109, "groups_published", "nagy2@x.hu", "Kint a csoportod", "Szia Anna Teszt!\n\n1. hét: Cili és Dóra ellen", "pending");
}

// What is left of other people's mail (ids 100 to 109 above).
function otherPeoplesMailAfter() {
  expect(all("select id, subject from email_messages where id >= 100 order by id")).toEqual([
    { id: 100, subject: PARTNER_NOTICE_SUBJECT_REMOVED },
    { id: 101, subject: partnerNoticeSubject("Zoli") },
    { id: 105, subject: "Találtunk neked párt" },
    { id: 106, subject: "Hírek" },
    { id: 107, subject: "Itt a csoportod" },
    { id: 109, subject: "Kint a csoportod" },
  ]);
}

// Pair 1 (a + b) placed in phase 1's published group 1, with a match.
function publishPairOne() {
  h.raw.exec(`insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, 1)`);
  h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1), (1, 2, 2)`);
  h.raw.exec(`insert into matches (group_id, pair_a, pair_b, week, deadline) values (1, 1, 2, 1, ${sec("2026-11-29T22:59:00Z")})`);
}

// Every row about 'a' or a@x.hu except the kept unsubscribe.
function personalRowsLeft() {
  return {
    sessions: n("select count(*) from sessions where user_id = 'a'"),
    oauth: n("select count(*) from oauth_accounts where user_id = 'a'"),
    push: n("select count(*) from push_subscriptions where user_id = 'a'"),
    notifications: n("select count(*) from notifications where user_id = 'a'"),
    optOuts: n("select count(*) from notification_opt_outs where user_id = 'a'"),
    pairLinks: n("select count(*) from pair_links where owner_id = 'a'"),
    partnerSearch: n("select count(*) from partner_searches where user_id = 'a'"),
    organizer: n("select count(*) from league_admins where user_id = 'a'"),
    loginCodes: n("select count(*) from login_codes where email = 'a@x.hu'"),
    invites: n("select count(*) from account_invites where email = 'a@x.hu'"),
    reminded: n("select count(*) from stuck_reminder_people where email = 'a@x.hu'"),
    mail: n("select count(*) from email_messages where to_email = 'a@x.hu'"),
    signups: n("select count(*) from interest_signups where lower(email1) = 'a@x.hu' or lower(email2) = 'a@x.hu'"),
    audit: n("select count(*) from audit_log where target like '%a@x.hu%'"),
    suppressions: n("select count(*) from email_suppressions where email = 'a@x.hu'"),
  };
}

const NONE = {
  sessions: 0,
  oauth: 0,
  push: 0,
  notifications: 0,
  optOuts: 0,
  pairLinks: 0,
  partnerSearch: 0,
  organizer: 0,
  loginCodes: 0,
  invites: 0,
  reminded: 0,
  mail: 0,
  signups: 0,
  audit: 0,
  suppressions: 0,
};

function interestListAfter() {
  // a's own signups are gone; c's solo is back on the waiting list; d's
  // pair signup stays without a's name and address; b's mail is untouched.
  expect(all("select id from interest_signups order by id").map((r: any) => r.id)).toEqual([12, 13]);
  expect(one("select paired_with, status from interest_signups where id = 12")).toEqual({ paired_with: null, status: "new" });
  expect(one("select name1, email1, name2, email2, invited2_at from interest_signups where id = 13")).toEqual({
    name1: "D",
    email1: "d@x.hu",
    name2: null,
    email2: null,
    invited2_at: null,
  });
  expect(n("select count(*) from email_messages where to_email = 'b@x.hu' and kind = 'login_code'")).toBe(1);
  otherPeoplesMailAfter();
  // No row has a's address as a whole any more.
  expect(n("select count(*) from email_messages where instr(' ' || lower(coalesce(text, '') || ' ' || subject || ' ' || to_email), ' a@x.hu') > 0")).toBe(0);
}

describe("deleting an account (#152)", () => {
  beforeEach(freshDb);
  afterEach(() => expect(h.mails).toEqual([]));

  it("removes an account without history with everything tied to it", async () => {
    expect(await D.deleteAccount("admin", "a", DURING)).toEqual({ ok: true, mode: "remove" });
    expect(n("select count(*) from users where id = 'a'")).toBe(0);
    // The pair and its entry are gone; the partner is a player without a pair.
    expect(n("select count(*) from pairs where id = 1")).toBe(0);
    expect(n("select count(*) from season_entries where pair_id = 1")).toBe(0);
    expect((await pairCandidates({ id: 1, city: "gyor" })).map((c) => c.id)).toContain("b");
    expect(personalRowsLeft()).toEqual(NONE);
    interestListAfter();
    // Logged by who and when, without the name or email.
    expect(all("select actor_id, action, target, detail from audit_log where action like 'account.%'")).toEqual([
      { actor_id: "admin", action: "account.delete", target: "user:a", detail: null },
    ]);
    // The address is free: a login with it would make a new account.
    expect(await findUserIdByEmail("a@x.hu")).toBeNull();
  });

  it("removes the address's unsubscribe, bounce and complaint, and nobody else's (#193)", async () => {
    // a@x.hu has one row (the primary key is the address); the others stay.
    h.raw.exec(`update email_suppressions set reason = 'bounced' where email = 'a@x.hu'`);
    h.raw.exec(`insert into email_suppressions (email, reason) values ('b@x.hu', 'complained'), ('c@x.hu', 'unsubscribed')`);
    expect(await D.deleteAccount("admin", "a", DURING)).toEqual({ ok: true, mode: "remove" });
    expect(all("select email, reason from email_suppressions order by email")).toEqual([
      { email: "b@x.hu", reason: "complained" },
      { email: "c@x.hu", reason: "unsubscribed" },
    ]);
  });

  it("removes the unsubscribe of an anonymized account too (#193)", async () => {
    publishPairOne();
    h.raw.exec(`insert into email_suppressions (email, reason) values ('b@x.hu', 'unsubscribed')`);
    expect(await D.deleteAccount("admin", "a", AFTER)).toEqual({ ok: true, mode: "anonymize" });
    expect(all("select email from email_suppressions")).toEqual([{ email: "b@x.hu" }]);
  });

  it("keeps the unsubscribe when the deletion is refused (#193)", async () => {
    publishPairOne();
    expect(await D.deleteAccount("admin", "a", DURING)).toEqual({ ok: false, error: DELETION_REFUSALS.playing });
    expect(n("select count(*) from email_suppressions where email = 'a@x.hu'")).toBe(1);
  });

  it.each(["unsubscribed", "bounced", "complained"])(
    "sends a login code to a deleted address that was %s, as to a new player (#193)",
    async (reason) => {
      h.raw.exec(`update email_suppressions set reason = '${reason}' where email = 'a@x.hu'`);
      expect(await D.deleteAccount("admin", "a", DURING)).toEqual({ ok: true, mode: "remove" });
      expect(await sendLoginCode("A@x.hu")).toEqual({ ok: true, email: "a@x.hu" });
      expect(h.codes).toEqual(["a@x.hu"]);
    },
  );

  it("takes a pair out of a draft group and bumps the draft's revision", async () => {
    h.raw.exec(`insert into groups (id, season_id, phase, number) values (1, 1, 1, 1)`);
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1), (1, 2, 2)`);
    expect(await D.deleteAccount("admin", "a", DURING)).toEqual({ ok: true, mode: "remove" });
    expect(all("select pair_id from group_pairs")).toEqual([{ pair_id: 2 }]);
    expect(one("select revision from groups where id = 1").revision).toBe(1);
  });

  it("anonymizing takes the organizer's substitute reasons off the player's pairs' requests (#37)", async () => {
    publishPairOne();
    h.raw.exec(`insert into users (id, email, name, consent_at) values ('s', 's@x.hu', 'S', 1)`);
    h.raw.exec(`insert into match_substitutes (match_id, pair_id, absent_id, substitute_id, status, requested_at, reason)
      values (1, 1, 'b', 's', 'rejected', 1, 'Lábsérülés miatt nem.'), (1, 2, 'd', 's', 'rejected', 1, 'Másik pár oka.')`);
    expect(await D.deleteAccount("admin", "a", AFTER)).toEqual({ ok: true, mode: "anonymize" });
    expect(all("select pair_id, reason from match_substitutes order by pair_id")).toEqual([
      { pair_id: 1, reason: null },
      { pair_id: 2, reason: "Másik pár oka." },
    ]);
  });

  it("anonymizes, never removes, an approved substitute, so the Elo replay still rates who played (#37)", async () => {
    publishPairOne();
    h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('s', 's@x.hu', 'S', 'kezdo', 1)`);
    h.raw.exec(`update matches set status = 'final', outcome = '{"kind":"played","score":{"sets":[[4,1],[4,2]]}}' where id = 1`);
    h.raw.exec(`insert into match_substitutes (match_id, pair_id, absent_id, substitute_id, status, requested_at) values (1, 1, 'b', 's', 'approved', 1)`);
    expect(await D.deleteAccount("admin", "s", AFTER)).toEqual({ ok: true, mode: "anonymize" });
    expect(one("select substitute_id, status from match_substitutes")).toEqual({ substitute_id: "s", status: "approved" });
    expect(one("select name, email from users where id = 's'")).toEqual({ name: DELETED_NAME, email: "deleted-s@deleted.invalid" });
    await updateElo(AFTER);
    expect(all("select user_id from elo_changes order by user_id")).toEqual(["a", "c", "d", "s"].map((user_id) => ({ user_id })));
    expect(n("select elo from users where id = 'b'")).toBeNull();
    expect(n("select elo from users where id = 's'")).toBeGreaterThan(1000);
  });

  it("removes a substitute who was never approved, with their requests (#37)", async () => {
    publishPairOne();
    h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('s', 's@x.hu', 'S', 'kezdo', 1)`);
    h.raw.exec(`insert into match_substitutes (match_id, pair_id, absent_id, substitute_id, status, requested_at)
      values (1, 1, 'b', 's', 'requested', 1), (1, 2, 'd', 's', 'rejected', 1)`);
    expect(await D.deleteAccount("admin", "s", DURING)).toEqual({ ok: true, mode: "remove" });
    expect(n("select count(*) from match_substitutes")).toBe(0);
    expect(n("select count(*) from users where id = 's'")).toBe(0);
  });

  it("anonymizes an account with history; groups and matches stay", async () => {
    publishPairOne();
    expect(await D.deleteAccount("admin", "a", AFTER)).toEqual({ ok: true, mode: "anonymize" });
    expect(one("select name, email, phone, sex, image_url, consent_at, last_login_at, deleted_at, level from users where id = 'a'")).toEqual({
      name: DELETED_NAME,
      email: "deleted-a@deleted.invalid",
      phone: null,
      sex: null,
      image_url: null,
      consent_at: null,
      last_login_at: null,
      deleted_at: sec(AFTER.toISOString()),
      level: "halado",
    });
    // The history stays as it was; the active pair is dissolved.
    expect(all("select group_id, pair_id from group_pairs order by pair_id")).toEqual([
      { group_id: 1, pair_id: 1 },
      { group_id: 1, pair_id: 2 },
    ]);
    expect(n("select count(*) from matches")).toBe(1);
    expect(one("select status, dissolved_by from pairs where id = 1")).toEqual({ status: "dissolved", dissolved_by: "admin" });
    expect(one("select status from season_entries where pair_id = 1").status).toBe("withdrawn");
    // No contact data, no way to log in, gone from lists.
    expect(personalRowsLeft()).toEqual(NONE);
    interestListAfter();
    expect((await pairCandidates({ id: 1, city: "gyor" })).map((c) => c.id)).not.toContain("a");
    expect(await findUserIdByEmail("a@x.hu")).toBeNull();
    // Párok still lists the dissolved pair, but "Levél nekik" doesn't write to them.
    const audience = (await leaguePairsAudience({ id: 1, city: "gyor", name: "Padelpárbaj Győr" }, { entry: null, q: "" })).people;
    expect(audience.map((p) => p.email)).toContain("b@x.hu");
    expect(audience.map((p) => p.email).filter((e) => e.endsWith("@deleted.invalid"))).toEqual([]);
    expect(all("select action, target, detail from audit_log where action like 'account.%' or action like 'pair.%' order by id")).toEqual([
      { action: "account.anonymize", target: "user:a", detail: null },
      { action: "pair.dissolve", target: "pair:1", detail: "league:1; account deleted" },
    ]);
    // Twice: already gone.
    expect(await D.deleteAccount("admin", "a", AFTER)).toEqual({ ok: false, error: DELETION_REFUSALS.gone });
  });

  it("refuses while their pair plays in a published group whose phase hasn't ended", async () => {
    publishPairOne();
    expect(await D.deleteAccount("admin", "a", DURING)).toEqual({ ok: false, error: DELETION_REFUSALS.playing });
    expect(one("select name, email from users where id = 'a'")).toEqual({ name: "Anna Teszt", email: "a@x.hu" });
    expect(n("select count(*) from sessions where user_id = 'a'")).toBe(1);
    expect(one("select status from pairs where id = 1").status).toBe("active");
    expect(n("select count(*) from interest_signups")).toBe(4);
    expect(all("select subject from email_messages where id = 100")).toEqual([{ subject: partnerNoticeSubject("A") }]);
    expect(n("select count(*) from email_messages where id >= 100")).toBe(10);
  });

  it("refuses the Admin's own account and another Admin's", async () => {
    expect(await D.deleteAccount("admin", "admin", DURING)).toEqual({ ok: false, error: DELETION_REFUSALS.self });
    expect(await D.deleteAccount("admin", "admin2", DURING)).toEqual({ ok: false, error: DELETION_REFUSALS.admin });
    expect(await D.deleteAccount("admin", "nobody", DURING)).toEqual({ ok: false, error: DELETION_REFUSALS.gone });
    expect(n("select count(*) from users where id in ('admin', 'admin2')")).toBe(2);
  });

  it("knows who has history and who plays now, for the user list", async () => {
    publishPairOne();
    const during = await D.deletionFacts(DURING);
    expect([...during.history].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...during.playing].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...(await D.deletionFacts(AFTER)).playing]).toEqual([]);
  });

  it("plans one account with the same answer as the user list's facts (#38)", async () => {
    publishPairOne();
    // 'c' was an approved substitute once: history without a pair of theirs there.
    h.raw.exec(`delete from group_pairs where pair_id = 2`);
    h.raw.exec(`insert into match_substitutes (match_id, pair_id, absent_id, substitute_id, status, requested_by, requested_at)
      select id, 1, 'b', 'c', 'approved', 'a', 1 from matches limit 1`);
    for (const at of [DURING, AFTER]) {
      const facts = await D.deletionFacts(at);
      for (const id of ["a", "b", "c", "d"]) {
        const expected = facts.playing.has(id)
          ? { ok: false, refusal: "playing" }
          : { ok: true, mode: facts.history.has(id) ? "anonymize" : "remove" };
        expect(await D.planDeletion("admin", id, at), `${id} ${at.toISOString()}`).toEqual(expected);
      }
    }
    expect(await D.planDeletion("admin", "c", AFTER)).toEqual({ ok: true, mode: "anonymize" });
    expect(await D.planDeletion("admin", "d", AFTER)).toEqual({ ok: true, mode: "remove" });
  });
});

// "Fiók törlése" on the player's own profile (#38): the same deletion, the
// account itself as the actor, every session gone.
describe("a player deleting their own account (#38)", () => {
  const OLD = { name: "Anna Teszt", email: "a@x.hu", phone: "+36309999999" };

  beforeEach(() => {
    freshDb();
    // A second device, and a phone number nobody else has.
    h.raw.exec(`insert into sessions (id_hash, user_id, expires_at) values ('s-a2', 'a', 9999999999)`);
    h.raw.prepare("update users set phone = ? where id = 'a'").run(OLD.phone);
  });
  afterEach(() => expect(h.mails).toEqual([]));

  // Every row of every table, without the mail that is someone else's
  // (105: anna@x.hu; 106, 109: a namesake's own; 107: a longer name).
  function everything(): string {
    const tables = all("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'") as { name: string }[];
    return tables
      .flatMap((t) => all(`select * from "${t.name}"`).filter((r: any) => !(t.name === "email_messages" && [105, 106, 107, 109].includes(r.id))))
      .map((r) => JSON.stringify(r))
      .join("\n");
  }

  function nowhere(text: string) {
    expect(text).not.toContain(OLD.name);
    expect(text).not.toMatch(/(^|[^a-z0-9._%+-])a@x\.hu/i);
    expect(text).not.toContain(OLD.phone);
  }

  it("removes an account without history; every device is logged out; the account is the actor", async () => {
    expect(await D.planOwnDeletion("a", DURING)).toEqual({ ok: true, mode: "remove" });
    expect(await D.deleteOwnAccount("a", DURING)).toEqual({ ok: true, mode: "remove" });
    expect(n("select count(*) from users where id = 'a'")).toBe(0);
    expect(personalRowsLeft()).toEqual(NONE);
    interestListAfter();
    // Written by the account before it went; the row's delete cleared the
    // actor, so Napló shows "Törölt játékos".
    expect(all("select actor_id, action, target, detail from audit_log where action like 'account.%'")).toEqual([
      { actor_id: null, action: "account.delete", target: "user:a", detail: null },
    ]);
    nowhere(everything());
    // Logging in again finds no account: the address starts a new registration.
    expect(await findUserIdByEmail(OLD.email)).toBeNull();
  });

  it("anonymizes an account with history: tables and results unchanged, old name, email and phone nowhere", async () => {
    publishPairOne();
    // Pair 1 (a + b) won its match by walkover.
    h.raw.exec(`update matches set status = 'final', outcome = '{"kind":"walkover","winner":"a"}' where pair_a = 1 and pair_b = 2`);
    const table = async () => {
      const page = await ladderPage("gyor", AFTER);
      if (page?.kind !== "ladder") throw new Error("no ladder");
      return page;
    };
    const points = (page: Awaited<ReturnType<typeof table>>) =>
      page.bands.flatMap((b) => b.groups.flatMap((g) => g.rows.map((r) => [r.points, r.matches])));
    const before = await table();
    expect(JSON.stringify(before)).toContain(OLD.name);

    expect(await D.planOwnDeletion("a", AFTER)).toEqual({ ok: true, mode: "anonymize" });
    expect(await D.deleteOwnAccount("a", AFTER)).toEqual({ ok: true, mode: "anonymize" });

    const after = await table();
    expect(points(after)).toEqual(points(before));
    expect(points(after)).toContainEqual([3, 1]);
    expect(JSON.stringify(after)).toContain(DELETED_NAME);
    expect(n("select count(*) from matches where status = 'final'")).toBe(1);
    const pair = JSON.stringify(await pairProfile(1, AFTER));
    expect(pair).toContain(DELETED_NAME);
    expect(await playerProfile("a", AFTER)).toBeNull();
    // No session on any device, no login, no Szervező rights, no contact data.
    expect(personalRowsLeft()).toEqual(NONE);
    expect(await findUserIdByEmail(OLD.email)).toBeNull();
    for (const text of [JSON.stringify(after), pair, everything()]) nowhere(text);
    expect(one("select status, dissolved_by from pairs where id = 1")).toEqual({ status: "dissolved", dissolved_by: "a" });
    expect(all("select actor_id, action, target from audit_log where action like 'account.%' or action like 'pair.%' order by id")).toEqual([
      { actor_id: "a", action: "account.anonymize", target: "user:a" },
      { actor_id: "a", action: "pair.dissolve", target: "pair:1" },
    ]);
  });

  it("is refused like the Admin's while the pair plays, said to the player; nothing changes", async () => {
    publishPairOne();
    expect(await D.planOwnDeletion("a", DURING)).toEqual({ ok: false, refusal: "ownPlaying" });
    expect(await D.deleteOwnAccount("a", DURING)).toEqual({ ok: false, error: DELETION_REFUSALS.ownPlaying });
    expect(one("select name, email, phone from users where id = 'a'")).toEqual(OLD);
    expect(n("select count(*) from sessions where user_id = 'a'")).toBe(2);
    expect(n("select count(*) from audit_log where action like 'account.%'")).toBe(0);
  });

  it("is refused for the Admin", async () => {
    expect(await D.deleteOwnAccount("admin", DURING)).toEqual({ ok: false, error: DELETION_REFUSALS.ownAdmin });
    expect(n("select count(*) from users where id = 'admin' and deleted_at is null")).toBe(1);
  });
});
