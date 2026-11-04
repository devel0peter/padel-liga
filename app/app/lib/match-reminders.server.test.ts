// match-reminders.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the digest reminders, the daily digest and "holnap meccs"
// (#31). The real outbox queues the emails (email switch, suppressions); the
// sender is stubbed, nothing leaves the process.
import { budapestTime } from "@padel-liga/rules";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[] }));

// No VAPID keys: notifications are stored, not pushed.
vi.mock("cloudflare:workers", () => ({ env: { EMAIL_DAILY_LIMIT: "100" } }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/send.server", () => ({
  MAX_BATCH: 100,
  relayConfigured: () => false,
  sendEmails: async (emails: any[]) => {
    h.sent.push(...emails);
    return emails.map((_, i) => ({ ok: true, id: `id-${i}` }));
  },
}));
vi.mock("~/lib/cities.server", () => ({ listCities: async () => [{ slug: "gyor", name: "Győr" }] }));

const { migratedDatabase } = await import("~/test/sqlite");
const G = await import("~/lib/groups.server");
const M = await import("~/lib/matches.server");
const R = await import("~/lib/match-reminders.server");
const O = await import("~/lib/email/outbox.server");
const { RunBudget } = await import("~/lib/run-usage");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (day: string, hour: number, minute = 0) => budapestTime(day, hour, minute);

// Phase 1: Mon 9 – Sun 29 Nov 2026. One group of 4 pairs; by seed 1, 2, 3, 4.
// Week 1: 1–4 and 2–3; week 2: 1–3 and 2–4; week 3: 1–2 and 3–4.
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const LEVELS = ["versenyzo", "halado", "kozephalado", "kezdo"];

async function freshDb() {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert into clubs (id, slug, city, name, active) values (1, 'ace', 'gyor', 'Ace Padel', 1)`);
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
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('o', 'o@x.hu', 'Org', 'versenyzo', 1)`);
  LEVELS.forEach((level, i) => {
    const id = i + 1;
    for (const side of ["a", "b"])
      h.raw
        .prepare("insert into users (id, email, name, level, phone, consent_at) values (?, ?, ?, ?, '+36301234567', 1)")
        .run(`p${id}${side}`, `p${id}${side}@x.hu`, `Játékos ${id}${side.toUpperCase()}`, level);
    h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)").run(id, `p${id}a`, `p${id}b`);
    h.raw
      .prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, 'approved', 1, ?)")
      .run(id, sec("2026-11-06T10:00:00Z") + id);
  });
  expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
  expect(await G.publishGroups(1, "o", new Date("2026-11-08T08:00:00Z"))).toEqual({ ok: true });
  h.raw.exec("delete from notifications");
  h.raw.exec("delete from email_messages");
  h.sent = [];
}

const all = (q: string, ...params: unknown[]) => h.raw.prepare(q).all(...params);
const matchOf = (a: number, b: number): number =>
  all("select id from matches where (pair_a = ? and pair_b = ?) or (pair_a = ? and pair_b = ?)", a, b, b, a)[0].id;
const inbox = (kind?: string) =>
  all(`select user_id as user, kind, url from notifications ${kind ? "where kind = ?" : ""} order by id`, ...(kind ? [kind] : []));
const mails = (kind: string) => all("select to_email as \"to\", subject, status from email_messages where kind = ? order by id", kind);
const PLAYERS = (...pairs: number[]) => pairs.flatMap((p) => [`p${p}a`, `p${p}b`]);
const SLOTS = [at("2026-11-12", 18), at("2026-11-13", 19), at("2026-11-14", 10)];

// The digest and "holnap meccs" emails are off for now (#191, D83); the
// tests below keep them working with both switched on, as turning them back
// on would.
// Like the cron: the step, then the delivery step sends the queued emails.
const run = async (now: Date) => {
  await R.runMatchReminders(now, undefined, { digest: true, tomorrow: true });
  await O.deliver(undefined, now);
};
// The items whose push waits for the cron's push step (#183).
const pushQueue = (kind: string) => all("select user_id as user from notifications where kind = ? and push_due_at is not null order by id", kind);

// Pair 1 proposes on Tue 10 Nov, pair 4 accepts Thu 12 Nov 18:00.
async function schedule14(): Promise<number> {
  const id = matchOf(1, 4);
  expect(await M.matchStep("p1a", id, { kind: "propose", slots: SLOTS, clubId: null }, at("2026-11-10", 11))).toMatchObject({ ok: true });
  expect(await M.matchStep("p4a", id, { kind: "accept", slot: SLOTS[0]! }, at("2026-11-10", 12))).toMatchObject({ ok: true });
  // The steps' notifications carry the database clock; put them on Tuesday.
  h.raw.exec(`update notifications set created_at = ${sec("2026-11-10T11:00:00Z")}`);
  h.raw.exec("delete from email_messages");
  h.sent = [];
  return id;
}

describe("digest reminders (#31)", () => {
  beforeEach(freshDb);

  it("no proposal on Wednesday of week 1: one reminder to each of the four players of each week-1 match, and their digest", async () => {
    await run(at("2026-11-11", 7));
    const items = inbox("match_no_proposal");
    expect(items.map((n: any) => n.user).sort()).toEqual(PLAYERS(1, 2, 3, 4).sort());
    expect(new Set(items.map((n: any) => n.url))).toEqual(new Set([`/matches/${matchOf(1, 4)}`, `/matches/${matchOf(2, 3)}`]));
    // The same morning's digest: one email each, with the reminder.
    expect(mails("match_digest").map((m: any) => m.to).sort()).toEqual(PLAYERS(1, 2, 3, 4).map((p) => `${p}@x.hu`).sort());
    expect(mails("match_digest")[0]).toMatchObject({ subject: "Még nincs időpont-ajánlat – Padelpárbaj", status: "sent" });
  });

  it("the same reminder never goes twice; a later run that morning sends nothing", async () => {
    await run(at("2026-11-11", 7));
    await run(at("2026-11-11", 7, 30));
    await run(at("2026-11-12", 7));
    expect(inbox("match_no_proposal")).toHaveLength(8);
    expect(mails("match_digest")).toHaveLength(8);
  });

  it("only from 07:00 Budapest until noon; Tuesday has nothing, so no email", async () => {
    await run(at("2026-11-11", 6, 50));
    await run(at("2026-11-11", 12));
    await run(at("2026-11-10", 7));
    expect(inbox()).toEqual([]);
    expect(mails("match_digest")).toEqual([]);
  });

  it("a morning no run finished yet is made by the next run before noon, once (#183)", async () => {
    await run(at("2026-11-11", 9));
    expect(inbox("match_no_proposal")).toHaveLength(8);
    expect(mails("match_digest")).toHaveLength(8);
    await run(at("2026-11-11", 9, 10));
    await run(at("2026-11-11", 11, 50));
    expect(inbox("match_no_proposal")).toHaveLength(8);
    expect(mails("match_digest")).toHaveLength(8);
  });

  it("a morning run with no room left says the reminders are left for the next run, and the next run makes them (#222)", async () => {
    const full = { run: new RunBudget({ queries: 0, calls: 50 }), keep: { queries: 0, calls: 0 } };
    expect(await R.runMatchReminders(at("2026-11-11", 7), full, { digest: true, tomorrow: true })).toBe(
      "match reminders: no room in this run; left for the next one",
    );
    expect(inbox("match_no_proposal")).toEqual([]);
    await run(at("2026-11-11", 7, 10));
    expect(inbox("match_no_proposal")).toHaveLength(8);
    expect(mails("match_digest")).toHaveLength(8);
  });

  it("with no room left to mark the morning done, it says so; the next run marks it and makes nothing twice (#222)", async () => {
    const off = { digest: false, tomorrow: false };
    const measure = new RunBudget();
    await R.runMatchReminders(at("2026-11-11", 7), { run: measure, keep: { queries: 0, calls: 0 } }, off);
    const needed = measure.used().queries;
    await freshDb();
    const short = { run: new RunBudget({ queries: needed - 1, calls: 50 }), keep: { queries: 0, calls: 0 } };
    expect(await R.runMatchReminders(at("2026-11-11", 7), short, off)).toBe(
      "2 match reminders; left for the next run (run limits): the morning's done mark",
    );
    expect(all("select key from job_runs")).toEqual([]);
    expect(await R.runMatchReminders(at("2026-11-11", 7, 10), undefined, off)).toBeNull();
    expect(all("select key from job_runs")).toEqual([{ key: "morning:2026-11-11" }]);
    expect(inbox("match_no_proposal")).toHaveLength(8);
  });

  it("the 07:00 run marks the morning done even with nothing due, so a later item waits for the next day's digest", async () => {
    await run(at("2026-11-10", 7));
    h.raw.exec(
      `insert into notifications (user_id, kind, title, body, url, created_at) values ('p1a', 'match_cancelled', 'Lemondták a meccset', 'x', '/matches/1', ${sec("2026-11-10T07:30:00Z")})`,
    );
    await run(at("2026-11-10", 9));
    expect(mails("match_digest")).toEqual([]);
    await run(at("2026-11-11", 7));
    expect(mails("match_digest").map((m: any) => m.to)).toContain("p1a@x.hu");
  });

  it("a match with a proposal, a scheduled match or a played one gets none", async () => {
    const id = await schedule14();
    await M.matchStep("p2a", matchOf(2, 3), { kind: "propose", slots: SLOTS, clubId: null }, at("2026-11-10", 11));
    h.raw.exec(`update matches set status = 'final' where id = ${matchOf(1, 3)}`);
    h.raw.exec("delete from notifications");
    await run(at("2026-11-11", 7));
    expect(inbox("match_no_proposal")).toEqual([]);
    // Week 2, Wednesday: 1–3 is played (no reminder), 2–4 isn't.
    await run(at("2026-11-18", 7));
    expect(new Set(inbox("match_no_proposal").map((n: any) => n.url))).toEqual(new Set([`/matches/${matchOf(2, 4)}`]));
    expect(id).toBeGreaterThan(0);
  });

  it("end of week 1, still unscheduled: 'pótoljátok' on Monday; a missed Wednesday sends only that one", async () => {
    await run(at("2026-11-16", 7));
    expect(inbox("match_week_end")).toHaveLength(8);
    // The Wednesday reminder was due too but is not sent, now or later.
    expect(inbox("match_no_proposal")).toEqual([]);
    await run(at("2026-11-17", 7));
    expect(inbox("match_no_proposal")).toEqual([]);
  });

  it("3 days before the deadline: every unscheduled match", async () => {
    await schedule14();
    h.raw.exec("delete from notifications");
    await run(at("2026-11-26", 7));
    // 1–4 is scheduled; the other 5 matches aren't.
    expect(inbox("match_deadline_soon")).toHaveLength(5 * 4);
    expect(inbox().filter((n: any) => n.kind !== "match_deadline_soon")).toEqual([]);
  });
});

describe("the daily digest (#31)", () => {
  beforeEach(freshDb);

  it("several items on one day: one email with all of them; one item: that one", async () => {
    // Accepted on Tuesday: the proposing pair (1) got match_scheduled then.
    await schedule14();
    // Pair 2 had a cancellation on Tuesday evening, and gets Wednesday's reminder.
    h.raw.exec(
      `insert into notifications (user_id, kind, title, body, url, created_at) values ('p2a', 'match_cancelled', 'Lemondták a meccset', 'x', '/matches/1', ${sec("2026-11-10T18:00:00Z")})`,
    );
    await run(at("2026-11-11", 7));
    const toP2a = h.sent.filter((m) => m.to === "p2a@x.hu");
    expect(toP2a).toHaveLength(1);
    expect(toP2a[0].subject).toBe("Napi összefoglaló: 2 újdonság – Padelpárbaj");
    expect(toP2a[0].text).toContain("Lemondták a meccset");
    expect(toP2a[0].text).toContain("Még nincs időpont-ajánlat");
    const toP1a = h.sent.filter((m) => m.to === "p1a@x.hu");
    expect(toP1a.map((m) => m.subject)).toEqual(["Lefixálva a meccsetek – Padelpárbaj"]);
  });

  it("only items not opened in the app; nothing left, no email", async () => {
    await schedule14();
    h.raw.exec("update notifications set read_at = unixepoch() where user_id = 'p1a'");
    await run(at("2026-11-11", 7));
    expect(h.sent.filter((m) => m.to === "p1a@x.hu")).toEqual([]);
    // The partner didn't open it.
    expect(h.sent.filter((m) => m.to === "p1b@x.hu")).toHaveLength(1);
  });

  it("email switched off: no digest email, the items still in the app", async () => {
    h.raw.exec("insert into notification_opt_outs (user_id, kind) values ('p1a', 'channel:email')");
    await run(at("2026-11-11", 7));
    expect(inbox("match_no_proposal").filter((n: any) => n.user === "p1a")).toHaveLength(1);
    expect(mails("match_digest").map((m: any) => m.to)).not.toContain("p1a@x.hu");
    expect(mails("match_digest")).toHaveLength(7);
  });

  it("a deleted account (#152) gets no digest, even with an item left", async () => {
    h.raw.exec("update users set deleted_at = unixepoch() where id = 'p1a'");
    await run(at("2026-11-11", 7));
    expect(mails("match_digest").map((m: any) => m.to)).not.toContain("p1a@x.hu");
    expect(mails("match_digest")).toHaveLength(7);
  });

  it("takes each item once, and only from the last day", async () => {
    h.raw.exec(
      `insert into notifications (user_id, kind, title, body, url, created_at) values ('p1a', 'match_cancelled', 'Régi', 'x', '/matches/1', ${sec("2026-11-09T05:00:00Z")})`,
    );
    h.raw.exec(
      `insert into notifications (user_id, kind, title, body, url, created_at) values ('p1a', 'match_cancelled', 'Lemondták a meccset', 'x', '/matches/1', ${sec("2026-11-10T18:00:00Z")})`,
    );
    // Not a digest kind: never in the digest.
    h.raw.exec(
      `insert into notifications (user_id, kind, title, body, url, created_at) values ('p1a', 'match_proposal', 'Időpontokat ajánlottak', 'x', '/matches/1', ${sec("2026-11-10T18:00:00Z")})`,
    );
    await run(at("2026-11-11", 7));
    const toP1a = h.sent.filter((m) => m.to === "p1a@x.hu");
    expect(toP1a).toHaveLength(1);
    expect(toP1a[0].text).toContain("Lemondták a meccset");
    expect(toP1a[0].text).not.toContain("Régi");
    expect(toP1a[0].text).not.toContain("Időpontokat ajánlottak");
    await run(at("2026-11-12", 7));
    expect(h.sent.filter((m) => m.to === "p1a@x.hu")).toHaveLength(1);
  });
});

describe("holnap meccs (#31)", () => {
  beforeEach(freshDb);

  it("the evening before the slot: email and in-app item to all four players, once", async () => {
    const id = await schedule14();
    await M.matchStep("p4b", id, { kind: "venue", clubId: 1, court: "2-es pálya" }, at("2026-11-10", 13));
    h.raw.exec("delete from notifications");
    await run(at("2026-11-11", 17));
    expect(mails("match_tomorrow")).toEqual([]);
    await run(at("2026-11-11", 18));
    await run(at("2026-11-11", 19));
    expect(mails("match_tomorrow").map((m: any) => m.to).sort()).toEqual(PLAYERS(1, 4).map((p) => `${p}@x.hu`).sort());
    expect(inbox("match_tomorrow").map((n: any) => n.user).sort()).toEqual(PLAYERS(1, 4).sort());
    const toP1a = h.sent.find((m) => m.to === "p1a@x.hu");
    expect(toP1a.subject).toBe("Holnap meccs: nov. 12., csütörtök 18:00 – Padelpárbaj");
    expect(toP1a.text).toContain("Holnap játszotok Játékos 4A és Játékos 4B ellen");
    expect(toP1a.text).toContain("Helyszín: Ace Padel, 2-es pálya");
    // "Holnap meccs" isn't a digest item: the next morning's digest (pairs 2
    // and 3 get one for their own match) has nothing for these four.
    await run(at("2026-11-12", 7));
    const digests = mails("match_digest").map((m: any) => m.to);
    expect(digests.length).toBeGreaterThan(0);
    for (const p of PLAYERS(1, 4)) expect(digests).not.toContain(`${p}@x.hu`);
  });

  it("rescheduled to another day: the new slot gets its own reminder", async () => {
    const id = await schedule14();
    await run(at("2026-11-11", 18));
    expect(mails("match_tomorrow")).toHaveLength(4);
    // Cancelled on Thursday morning (late), then a time on Saturday is agreed and confirmed.
    await M.matchStep("p1a", id, { kind: "cancel" }, at("2026-11-12", 9));
    await M.matchStep("p1a", id, { kind: "agreed", slot: at("2026-11-14", 10), clubId: null }, at("2026-11-12", 9, 5));
    await M.matchStep("p4a", id, { kind: "confirm" }, at("2026-11-12", 9, 10));
    await run(at("2026-11-13", 20));
    expect(mails("match_tomorrow")).toHaveLength(8);
  });

  it("email switched off: no email, still the in-app item", async () => {
    await schedule14();
    h.raw.exec("insert into notification_opt_outs (user_id, kind) values ('p4a', 'channel:email')");
    h.raw.exec("delete from notifications");
    await run(at("2026-11-11", 18));
    expect(mails("match_tomorrow").map((m: any) => m.to)).not.toContain("p4a@x.hu");
    expect(inbox("match_tomorrow").map((n: any) => n.user)).toContain("p4a");
  });
});

describe("the emails switched off (#191, D83)", () => {
  beforeEach(freshDb);

  it("both are off by default", async () => {
    const { MATCH_REMINDER_EMAILS } = await import("~/lib/match-reminders");
    expect(MATCH_REMINDER_EMAILS).toEqual({ digest: false, tomorrow: false });
  });

  it("the 07:00 run makes the reminder items (in the app, by push) and queues no digest email", async () => {
    await schedule14();
    await R.runMatchReminders(at("2026-11-11", 7));
    expect(pushQueue("match_no_proposal").map((n: any) => n.user).sort()).toEqual(PLAYERS(2, 3).sort());
    // Pairs 2 and 3 have had no proposal by Wednesday: their reminder is in the app.
    expect(inbox("match_no_proposal").map((n: any) => n.user).sort()).toEqual(PLAYERS(2, 3).sort());
    expect(mails("match_digest")).toEqual([]);
    expect(h.sent).toEqual([]);
    // The items stay untaken; a digest switched back on takes only the last day's.
    expect(all("select count(*) as n from notifications where digested_at is not null")[0].n).toBe(0);
  });

  it("the evening run gives 'holnap meccs' in the app and by push, and queues no email", async () => {
    await schedule14();
    h.raw.exec("delete from notifications");
    await R.runMatchReminders(at("2026-11-11", 18));
    expect(pushQueue("match_tomorrow").map((n: any) => n.user).sort()).toEqual(PLAYERS(1, 4).sort());
    expect(inbox("match_tomorrow").map((n: any) => n.user).sort()).toEqual(PLAYERS(1, 4).sort());
    expect(mails("match_tomorrow")).toEqual([]);
    expect(h.sent).toEqual([]);
    // Still claimed once: a later evening run tells nobody again.
    await R.runMatchReminders(at("2026-11-11", 19));
    expect(inbox("match_tomorrow")).toHaveLength(4);
  });
});
