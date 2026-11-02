// account-deletion.server.ts (#152) on a real SQLite with every migration
// applied (~/test/sqlite): full removal without history, anonymization with
// history, the running-phase refusal and the Admin guards. The email module
// is a recorder: a deletion queues nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueSeasonEntryDecision: async (...args: any[]) => h.mails.push(args),
  queueGroupsPublished: async (...args: any[]) => h.mails.push(args),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const D = await import("~/lib/account-deletion.server");
const { DELETED_NAME, DELETION_REFUSALS } = await import("~/lib/account-deletion");
const { pairCandidates } = await import("~/lib/pairs.server");
const { findUserIdByEmail } = await import("~/lib/auth/accounts.server");

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
    mail: n("select count(*) from email_messages where to_email = 'a@x.hu'"),
    signups: n("select count(*) from interest_signups where lower(email1) = 'a@x.hu' or lower(email2) = 'a@x.hu'"),
    audit: n("select count(*) from audit_log where target like '%a@x.hu%'"),
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
  mail: 0,
  signups: 0,
  audit: 0,
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
  expect(n("select count(*) from email_messages where to_email = 'b@x.hu'")).toBe(1);
  // The unsubscribe stays, so the address is never mailed again.
  expect(n("select count(*) from email_suppressions where email = 'a@x.hu'")).toBe(1);
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
    expect((await pairCandidates(1)).map((c) => c.id)).toContain("b");
    expect(personalRowsLeft()).toEqual(NONE);
    interestListAfter();
    // Logged by who and when, without the name or email.
    expect(all("select actor_id, action, target, detail from audit_log where action like 'account.%'")).toEqual([
      { actor_id: "admin", action: "account.delete", target: "user:a", detail: null },
    ]);
    // The address is free: a login with it would make a new account.
    expect(await findUserIdByEmail("a@x.hu")).toBeNull();
  });

  it("takes a pair out of a draft group and bumps the draft's revision", async () => {
    h.raw.exec(`insert into groups (id, season_id, phase, number) values (1, 1, 1, 1)`);
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1), (1, 2, 2)`);
    expect(await D.deleteAccount("admin", "a", DURING)).toEqual({ ok: true, mode: "remove" });
    expect(all("select pair_id from group_pairs")).toEqual([{ pair_id: 2 }]);
    expect(one("select revision from groups where id = 1").revision).toBe(1);
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
    expect((await pairCandidates(1)).map((c) => c.id)).not.toContain("a");
    expect(await findUserIdByEmail("a@x.hu")).toBeNull();
    expect(all("select action, target, detail from audit_log where action like 'account.%'")).toEqual([
      { action: "account.anonymize", target: "user:a", detail: null },
    ]);
    // Twice: already gone.
    expect(await D.deleteAccount("admin", "a", AFTER)).toEqual({ ok: false, error: DELETION_REFUSALS.gone });
  });

  it("refuses while their pair plays in a published group whose phase hasn't ended", async () => {
    publishPairOne();
    expect(await D.deleteAccount("admin", "a", DURING)).toEqual({ ok: false, error: DELETION_REFUSALS.playing });
    expect(one("select name, email from users where id = 'a'")).toEqual({ name: "A", email: "a@x.hu" });
    expect(n("select count(*) from sessions where user_id = 'a'")).toBe(1);
    expect(one("select status from pairs where id = 1").status).toBe("active");
    expect(n("select count(*) from interest_signups")).toBe(4);
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
});
