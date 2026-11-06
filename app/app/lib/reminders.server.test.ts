// The automatic reminders (#155) on a real SQLite (~/test/sqlite): the switch,
// the backlog the switch page previews, the cron's queueing, once only. The
// sender is stubbed; nothing leaves the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const R = await import("~/lib/reminders.server");
const { anonymizedEmail } = await import("~/lib/account-deletion");
const O = await import("~/lib/email/outbox.server");
const { RunBudget } = await import("~/lib/run-usage");

// Monday 2 Nov 2026, 13:00 Budapest; registration until Fri 6 Nov 23:59.
const NOW = new Date("2026-11-02T12:00:00Z");
const T = NOW.getTime() / 1000;
const DAY = 86_400;
const league = { id: 1, slug: "gyor", city: "gyor", name: "Padelpárbaj Győr" };
const PHONE = "+36301234567";

const all = (q: string, ...p: any[]) => h.raw.prepare(q).all(...p);
const reminderMail = () => all("select to_email, subject, text, headers from email_messages where kind = 'stuck_reminder' order by to_email");

function user(id: string, v: { consent?: number | null; created?: number; role?: string } = {}) {
  h.raw
    .prepare("insert into users (id, email, name, platform_role, level, phone, consent_at, created_at) values (?, ?, ?, ?, 'kezdo', ?, ?, ?)")
    .run(id, `${id}@x.hu`, id.charAt(0).toUpperCase() + id.slice(1), v.role ?? "player", PHONE, v.consent === undefined ? T - 3 * DAY : v.consent, v.created ?? T - 3 * DAY);
  // Everyone here joined the league (D127), unfinished accounts too (the
  // register button joins at login).
  h.raw.prepare("insert into league_members (league_id, user_id, source) values (1, ?, 'register')").run(id);
}

function invited(email: string, v: { name2?: string; email2?: string } = {}) {
  h.raw
    .prepare(
      "insert into interest_signups (mode, name1, email1, name2, email2, city, level, consent_at, invited_at, invited2_at) values (?, ?, ?, ?, ?, 'gyor', 'kezdo', 1, ?, ?)",
    )
    .run(v.name2 ? "pair" : "solo", email.split("@")[0], email, v.name2 ?? null, v.email2 ?? null, T - 3 * DAY, v.email2 ? T - 3 * DAY : null);
}

// Everyone of the issue's situations, and everyone who must get nothing.
function people() {
  invited("eva@x.hu"); // A
  invited("ugo@x.hu"); // A, but unsubscribed
  h.raw.prepare("insert into email_suppressions (email, reason) values ('ugo@x.hu', 'unsubscribed')").run();
  user("bela", { consent: null, created: T - 2 * DAY }); // B
  user("cili"); // C
  user("gabi"); // D with Hedi
  user("hedi");
  h.raw.prepare("insert into pairs (league_id, player_a, player_b, created_at) values (1, 'gabi', 'hedi', ?)").run(T - 3 * DAY);
  user("admin", { role: "superadmin" }); // Admin: nothing
  user("kati"); // email off: nothing
  h.raw.prepare("insert into notification_opt_outs (user_id, kind) values ('kati', 'channel:email')").run();
  user("lili"); // Párt keresek on: nothing
  h.raw.prepare("insert into partner_searches (league_id, user_id, seeking) values (1, 'lili', 1)").run();
  user("mari"); // has a pair with an entry waiting for approval: nothing
  user("nora");
  const pair = h.raw.prepare("insert into pairs (league_id, player_a, player_b) values (1, 'mari', 'nora') returning id").get().id;
  h.raw.prepare("insert into season_entries (season_id, pair_id) values (1, ?)").run(pair);
  // An anonymized account (#152), as anonymize leaves it: no consent, the
  // placeholder address, no opt-outs. Nothing, and not counted.
  user("olga", { consent: null, created: T - 2 * DAY });
  h.raw.prepare("update users set name = 'Törölt játékos', email = ?, phone = null, deleted_at = ? where id = 'olga'").run(anonymizedEmail("olga"), T - DAY);
}

describe("automatic reminders (#155)", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.sent = [];
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
    h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
    h.raw
      .prepare(
        "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
      )
      .run(Date.parse("2026-10-28T23:00:00Z") / 1000, Date.parse("2026-11-06T22:59:00Z") / 1000);
    const first = Date.parse("2026-11-08T23:00:00Z") / 1000;
    for (let i = 0; i < 4; i++)
      h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, ?, ?, ?)").run(i + 1, first + i * 21 * DAY, first + (i + 1) * 21 * DAY - 60);
    people();
  });

  it("with the switch off, the page counts the backlog and nothing is sent", async () => {
    const view = await R.reminderOverview(league, NOW);
    expect(view).toMatchObject({ on: false, due: { A: 1, B: 1, C: 1, D: 2 }, season: "2026/27 tél" });
    expect(await R.queueDueReminders(NOW)).toBe(0);
    expect(reminderMail()).toEqual([]);
  });

  it("previews each reminder with a real recipient's data, no address and no pair link token", async () => {
    const { previews } = await R.reminderOverview(league, NOW);
    expect(previews.map((p) => [p.situation, p.subject])).toEqual([
      ["A", "Még nem regisztráltál – Padelpárbaj"],
      ["B", "Fejezd be a regisztrációt – Padelpárbaj"],
      ["C", "Hívd meg a párodat – Padelpárbaj"],
      ["D", "Nevezzetek a szezonra – Padelpárbaj"],
    ]);
    expect(previews[0].text).toContain("Szia eva!");
    expect(previews[3].text).toContain("Hedi pároddal még nem neveztetek");
    for (const p of previews) expect(p.text).not.toMatch(/@|%40|Leiratkozás/);
    expect(previews[2].text).toContain("/pair/join/…");
    expect(all("select count(*) as n from pair_links")).toEqual([{ n: 0 }]);
  });

  it("turned on, the next run queues exactly the previewed backlog, one email per person, then sends it", async () => {
    await R.setReminders("admin", league, true, NOW);
    expect(all("select action from audit_log")).toEqual([{ action: "reminders.on" }]);
    const view = await R.reminderOverview(league, NOW);
    expect(view.on).toBe(true);
    const budget = new RunBudget();
    expect(await R.queueDueReminders(NOW)).toBe(5);
    // Within what the cron keeps for this step (#183).
    expect(budget.used().queries).toBeLessThanOrEqual(R.STUCK_QUERIES);
    const mail = reminderMail();
    expect(mail.map((m: any) => m.to_email)).toEqual(["bela@x.hu", "cili@x.hu", "eva@x.hu", "gabi@x.hu", "hedi@x.hu"]);
    expect(all("select situation, recipients from stuck_reminders order by situation")).toEqual([
      { situation: "A", recipients: 1 },
      { situation: "B", recipients: 1 },
      { situation: "C", recipients: 1 },
      { situation: "D", recipients: 2 },
    ]);
    // Cili's own pair link, made now.
    const [{ token }] = all("select token from pair_links where owner_id = 'cili'");
    expect(mail.find((m: any) => m.to_email === "cili@x.hu").text).toContain(`/pair/join/${token}`);
    // Unsubscribe link and header, like every mail to many.
    for (const m of mail) {
      expect(m.text).toContain("Leiratkozás: ");
      expect(JSON.parse(m.headers)).toHaveProperty("List-Unsubscribe");
    }
    // The cron sends them in the same run, after personal mail.
    await O.deliver();
    expect(h.sent.map((m) => m.to).sort()).toEqual(["bela@x.hu", "cili@x.hu", "eva@x.hu", "gabi@x.hu", "hedi@x.hu"]);
  });

  it("no reminder holds another person's address or phone number", async () => {
    await R.setReminders("admin", league, true, NOW);
    await R.queueDueReminders(NOW);
    for (const m of reminderMail()) {
      const own = m.to_email.replace(".", "\\.").replace("@", "(@|%40)");
      const rest = m.text.replace(new RegExp(own, "g"), "").replace(/\?t=[^\s]+/g, "");
      expect(rest, m.to_email).not.toMatch(/@|%40/);
      expect(m.text).not.toContain(PHONE);
    }
  });

  it("a later run sends nobody a second reminder, and the page shows what went out and when", async () => {
    await R.setReminders("admin", league, true, NOW);
    await R.queueDueReminders(NOW);
    const later = new Date(NOW.getTime() + 3 * 3600_000);
    expect(await R.queueDueReminders(later)).toBe(0);
    const view = await R.reminderOverview(league, later);
    expect(view.due).toEqual({ A: 0, B: 0, C: 0, D: 0 });
    expect(view.sent.D.emails).toBe(2);
    expect(view.sent.A.emails).toBe(1);
    expect(view.sent.A.last).toBeInstanceOf(Date);
  });

  it("two runs at the same time queue each reminder once", async () => {
    await R.setReminders("admin", league, true, NOW);
    const [a, b] = await Promise.all([R.queueDueReminders(NOW), R.queueDueReminders(NOW)]);
    expect(a + b).toBe(5);
    expect(reminderMail()).toHaveLength(5);
  });

  it("someone who leaves the situation before the time passes gets none", async () => {
    await R.setReminders("admin", league, true, NOW);
    // Béla started his account only 20 hours ago; Cili found a partner.
    h.raw.prepare("update users set created_at = ? where id = 'bela'").run(T - 20 * 3600);
    user("zoli");
    h.raw.prepare("insert into pairs (league_id, player_a, player_b, created_at) values (1, 'cili', 'zoli', ?)").run(T - 3600);
    expect(await R.queueDueReminders(NOW)).toBe(3);
    expect(reminderMail().map((m: any) => m.to_email)).toEqual(["eva@x.hu", "gabi@x.hu", "hedi@x.hu"]);
  });

  it("a failure part-way through queueing leaves no email and no record, so the next run sends each once", async () => {
    await R.setReminders("admin", league, true, NOW);
    // Eight more without a pair: 13 emails, more than one insert of 10.
    for (let i = 1; i <= 8; i++) user(`c${i}`);
    // The last email (Hedi's, in the second insert) fails.
    h.raw.exec(
      `create trigger fail_hedi before insert on email_messages when new.to_email = 'hedi@x.hu' begin select raise(abort, 'boom'); end`,
    );
    await expect(R.queueDueReminders(NOW)).rejects.toThrow(/boom/);
    expect(all("select count(*) as n from email_messages")).toEqual([{ n: 0 }]);
    expect(all("select count(*) as n from stuck_reminders")).toEqual([{ n: 0 }]);
    h.raw.exec("drop trigger fail_hedi");
    expect(await R.queueDueReminders(NOW)).toBe(13);
    expect(await R.queueDueReminders(NOW)).toBe(0);
    const to = reminderMail().map((m: any) => m.to_email);
    expect(to).toHaveLength(13);
    expect(new Set(to).size).toBe(13);
  });

  it("switching off stops the next run", async () => {
    await R.setReminders("admin", league, true, NOW);
    await R.setReminders("admin", league, false, NOW);
    expect(await R.queueDueReminders(NOW)).toBe(0);
  });

  it("deleting a signup's mail also forgets its A reminder", async () => {
    await R.setReminders("admin", league, true, NOW);
    await R.queueDueReminders(NOW);
    await O.deleteMessagesTo(["EVA@x.hu"]);
    expect(all("select key from stuck_reminders where situation = 'A'")).toEqual([]);
    expect(all("select email from stuck_reminder_people where email = 'eva@x.hu'")).toEqual([]);
  });

  it("one reminder per person per season (#191): A, then C in the same season sends no second email; a new season can", async () => {
    await R.setReminders("admin", league, true, NOW);
    expect(await R.queueDueReminders(NOW)).toBe(5);
    expect(all("select season_id, email, situation from stuck_reminder_people order by email")).toEqual([
      { season_id: 1, email: "bela@x.hu", situation: "B" },
      { season_id: 1, email: "cili@x.hu", situation: "C" },
      { season_id: 1, email: "eva@x.hu", situation: "A" },
      { season_id: 1, email: "gabi@x.hu", situation: "D" },
      { season_id: 1, email: "hedi@x.hu", situation: "D" },
    ]);
    // Éva (got A) registers, has no pair and switched "Párt keresek" off;
    // Béla (got B) finishes the first-login page. Both are in C now.
    user("eva", { created: T });
    h.raw.prepare("insert into partner_searches (league_id, user_id, seeking, updated_at) values (1, 'eva', 0, ?)").run(T);
    h.raw.prepare("update users set consent_at = ? where id = 'bela'").run(T);
    const later = new Date(NOW.getTime() + 3 * DAY * 1000);
    const view = await R.reminderOverview(league, later);
    // Neither is in the backlog or a preview: both got one this season.
    expect(view.due).toEqual({ A: 0, B: 0, C: 0, D: 0 });
    expect(view.previews).toEqual([]);
    expect(await R.queueDueReminders(later)).toBe(0);
    expect(reminderMail().filter((m: any) => m.to_email === "eva@x.hu")).toHaveLength(1);

    // Season 1 has started its last phase; the league's next season accepts
    // entries: Éva and Béla can get C there (Cili had C already, once ever).
    h.raw.prepare("update season_phases set starts_at = ? where season_id = 1").run(T);
    h.raw
      .prepare(
        "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (2, 1, '2027 tavasz', ?, ?, '2027-03-01')",
      )
      .run(T, T + 30 * DAY);
    h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (2, 1, ?, ?)").run(T + 40 * DAY, T + 60 * DAY);
    const next = await R.reminderOverview(league, later);
    expect(next).toMatchObject({ season: "2027 tavasz" });
    expect(next.due.C).toBe(2);
    await R.queueDueReminders(later);
    const c = reminderMail().filter((m: any) => m.subject === "Hívd meg a párodat – Padelpárbaj");
    expect(c.map((m: any) => m.to_email)).toEqual(["bela@x.hu", "cili@x.hu", "eva@x.hu"]);
    expect(reminderMail().filter((m: any) => m.to_email === "eva@x.hu")).toHaveLength(2);
  });
});
