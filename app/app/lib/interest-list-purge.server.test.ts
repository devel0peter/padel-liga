// The one-time deletion of the interest list (#334, D132) on a real SQLite
// with every migration applied: what goes, what stays, the audit entry and
// the log line with counts only, a second run that does nothing, and a big
// list deleted over several runs within the run limits.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { RunBudget, RUN_LIMITS } = await import("~/lib/run-usage");
const P = await import("~/lib/interest-list-purge.server");
const { deleteCity } = await import("~/lib/cities.server");

const NOW = new Date("2026-11-14T06:00:00Z");
const NO_KEEP = { queries: 0, calls: 0 };
const one = (q: string, ...p: any[]) => h.raw.prepare(q).get(...p);
const all = (q: string, ...p: any[]) => h.raw.prepare(q).all(...p);
const n = (q: string, ...p: any[]) => Object.values(one(q, ...p) as object)[0] as number;

type Line = { level: string; event: string; [k: string]: unknown };
let lines: Line[] = [];

function world() {
  h.raw = migratedDatabase();
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, 'Tél', 1, 2, '2026-11-09')",
    )
    .run();
  // Anna registered after signing up; Béla and Cili never did.
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('anna', 'anna@x.hu', 'Anna', 'kezdo', 1)`);
  h.raw.exec(`insert into interest_signups (id, city, mode, name1, email1, name2, email2, level, consent_at) values
    (1, 'gyor', 'pair', 'Anna', 'Anna@x.hu', 'Béla', 'bela@x.hu', 'kezdo', 1),
    (2, 'gyor', 'solo', 'Cili', 'cili@x.hu', null, null, 'halado', 1)`);
  const mail = h.raw.prepare("insert into email_messages (id, kind, to_email, subject, status) values (?, ?, ?, ?, ?)");
  // From the list, to addresses without an account: go.
  mail.run(1, "signup_confirmation", "cili@x.hu", "Megkaptuk", "sent");
  mail.run(2, "partner_notice", "bela@x.hu", "Anna jelentkeztetett", "sent");
  mail.run(3, "registration_invite", "Cili@x.hu", "Indul", "pending");
  mail.run(4, "pair_intro", "cili@x.hu", "Párt találtunk", "sent");
  mail.run(5, "broadcast", "bela@x.hu", "Hír", "failed");
  mail.run(6, "stuck_reminder", "cili@x.hu", "Emlékeztető", "sent");
  // A partner notice to someone who registered names the signer: goes too.
  mail.run(7, "partner_notice", "anna@x.hu", "Béla jelentkeztetett", "sent");
  // An account's own mail stays, also of the same kinds.
  mail.run(8, "signup_confirmation", "anna@x.hu", "Megkaptuk", "sent");
  mail.run(9, "broadcast", "anna@x.hu", "Hír", "sent");
  mail.run(10, "pair_created", "anna@x.hu", "Van párod", "sent");
  // Not from the list: a login code to a new address stays.
  mail.run(11, "login_code", "dani@x.hu", "Kód", "sent");
  h.raw.exec(`insert into email_suppressions (email, reason) values ('cili@x.hu', 'unsubscribed'), ('bela@x.hu', 'bounced')`);
  h.raw.exec(`insert into stuck_reminders (id, key, situation, league_id, recipients) values
    (1, 'A:cili@x.hu', 'A', 1, 1), (2, 'B:anna', 'B', 1, 1)`);
  h.raw.exec(`insert into stuck_reminder_people (season_id, email, situation) values
    (1, 'cili@x.hu', 'A'), (1, 'bela@x.hu', 'C'), (1, 'anna@x.hu', 'B')`);
}

beforeEach(() => {
  P.forgetPurgeDone();
  world();
  lines = [];
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation((line: Line) => void lines.push(line));
});
afterEach(() => vi.restoreAllMocks());

const purge = (budget = new RunBudget(), keep = NO_KEEP) => P.purgeInterestList(NOW, { run: budget, keep });
const audits = () => all("select actor_id, action, target, detail, at from audit_log where action = 'interest_list.delete'");

describe("purgeInterestList (#334)", () => {
  it("deletes every signup, the list's mail to addresses without an account, every partner notice and the list's reminder records", async () => {
    expect(await purge()).toBeNull();
    expect(n("select count(*) from interest_signups")).toBe(0);
    expect(all("select id from email_messages order by id").map((r: any) => r.id)).toEqual([8, 9, 10, 11]);
    expect(all("select key from stuck_reminders")).toEqual([{ key: "B:anna" }]);
    expect(all("select email from stuck_reminder_people")).toEqual([{ email: "anna@x.hu" }]);
  });

  it("keeps accounts and the unsubscribe and bounce records", async () => {
    await purge();
    expect(all("select id from users")).toEqual([{ id: "anna" }]);
    expect(n("select count(*) from email_suppressions")).toBe(2);
  });

  it("writes one audit entry and one log line with counts only, and marks it done", async () => {
    await purge();
    expect(audits()).toEqual([
      { actor_id: null, action: "interest_list.delete", target: "Jelentkezési lista", detail: "2 signups, 7 emails, 3 reminder records", at: NOW.getTime() / 1000 },
    ]);
    const logged = lines.filter((l) => l.event === "interest list deletion");
    expect(logged).toEqual([expect.objectContaining({ level: "info", signups: 2, messages: 7, reminders: 3, done: true })]);
    expect(JSON.stringify(lines)).not.toMatch(/@/);
    expect(one("select key from job_runs where key = ?", P.DONE_KEY)).toEqual({ key: P.DONE_KEY });
  });

  it("is safe to run again: a second run, also in a fresh isolate, deletes and writes nothing", async () => {
    await purge();
    P.forgetPurgeDone();
    h.raw.exec(`insert into email_messages (kind, to_email, subject) values ('broadcast', 'uj@x.hu', 'Hír')`);
    const budget = new RunBudget();
    expect(await purge(budget)).toBeNull();
    expect(budget.used().queries).toBe(1);
    expect(n("select count(*) from email_messages where to_email = 'uj@x.hu'")).toBe(1);
    expect(audits()).toHaveLength(1);
    // The same isolate doesn't even look.
    const again = new RunBudget();
    expect(await purge(again)).toBeNull();
    expect(again.used().queries).toBe(0);
  });

  it("an empty list is marked done with an entry of zeros", async () => {
    h.raw.exec("delete from interest_signups; delete from email_messages; delete from stuck_reminders; delete from stuck_reminder_people");
    expect(await purge()).toBeNull();
    expect(audits().map((a: any) => a.detail)).toEqual(["0 signups, 0 emails, 0 reminder records"]);
    expect(n("select count(*) from job_runs where key = ?", P.DONE_KEY)).toBe(1);
  });

  it("waits without a query when the run has no room for it beyond what later steps keep", async () => {
    const budget = new RunBudget({ queries: P.PURGE_MIN.queries + 4, calls: 50 });
    expect(await purge(budget, { queries: 5, calls: 0 })).toMatch(/left for the next one/);
    expect(budget.used().queries).toBe(0);
    expect(n("select count(*) from interest_signups")).toBe(2);
  });

  it("deletes a big list over several runs within the run limits, and marks it done only when nothing is left", async () => {
    const add = h.raw.prepare("insert into interest_signups (city, mode, name1, email1, level, consent_at) values ('gyor', 'solo', 'X', ?, 'kezdo', 1)");
    const mail = h.raw.prepare("insert into email_messages (kind, to_email, subject, status) values ('registration_invite', ?, 'Indul', 'sent')");
    const SIGNUPS = 2 + 3000;
    for (let i = 0; i < 3000; i++) {
      add.run(`p${i}@x.hu`);
      mail.run(`p${i}@x.hu`);
    }
    // Each run keeps 47 queries for the steps after it: the first run has
    // room for one batch, the later ones for two.
    const keep = { queries: RUN_LIMITS.queries - P.PURGE_MIN.queries, calls: 0 };
    const results: (string | null)[] = [];
    for (let run = 0; run < 10 && !one("select 1 as x from job_runs where key = ?", P.DONE_KEY); run++) {
      const budget = new RunBudget();
      results.push(await purge(budget, keep));
      expect(budget.used().queries).toBeLessThanOrEqual(RUN_LIMITS.queries - keep.queries);
    }
    expect(n("select count(*) from interest_signups")).toBe(0);
    expect(n("select count(*) from email_messages where kind = 'registration_invite'")).toBe(0);
    expect(results.length).toBeGreaterThan(2);
    expect(results.slice(0, -1).every((r) => /more left for the next run/.test(r ?? ""))).toBe(true);
    expect(results.at(-1)).toMatch(/^interest list deletion finished/);
    // One entry with the totals of the first run, whatever the number of runs.
    expect(audits().map((a: any) => a.detail)).toEqual([`${SIGNUPS} signups, ${3000 + 7} emails, 3 reminder records`]);
    expect(lines.filter((l) => l.event === "interest list deletion")).toHaveLength(1);
  });

  it("a city with signups can be deleted, and the deletion leaves no signup pointing at it", async () => {
    h.raw.exec(`insert into cities (slug, name, listed) values ('pecs', 'Pécs', 0)`);
    h.raw.exec(`insert into interest_signups (city, mode, name1, email1, level, consent_at) values ('pecs', 'solo', 'Dóra', 'dora@x.hu', 'kezdo', 1)`);
    expect(await deleteCity("pecs", "anna")).toBe(true);
    await purge();
    expect(n("select count(*) from interest_signups where city = 'pecs'")).toBe(0);
  });
});
