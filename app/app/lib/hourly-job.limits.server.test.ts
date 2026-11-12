// The cron within the Workers Free run limits (#183): a league of 200
// players, each with 2 matches due a reminder, 150 of them with a push
// device. The real job runs every 10 minutes from 07:00 on a real SQLite;
// push and email are stubbed, nothing leaves the process. Each run is
// measured with the same counters the Worker uses (lib/run-usage.ts).
import { budapestTime } from "@padel-liga/rules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[], pushes: [] as string[] }));

vi.mock("cloudflare:workers", () => ({
  env: { EMAIL_DAILY_LIMIT: "5000", EMAIL_SECRET: "test-secret", VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" },
}));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/background.server", () => import("~/test/background"));
// One relay connection per batch of emails: one outgoing call.
vi.mock("~/lib/email/send.server", async () => {
  const { countCall } = await import("~/lib/run-usage");
  return {
    MAX_BATCH: 100,
    relayConfigured: () => true,
    sendEmails: async (emails: any[]) => {
      countCall();
      h.sent.push(...emails);
      return emails.map((_, i) => ({ ok: true, id: `id-${h.sent.length}-${i}` }));
    },
  };
});
// The push request without real keys; the fetch below answers it.
vi.mock("~/lib/push/webpush", async (original) => ({
  ...(await original<typeof import("~/lib/push/webpush")>()),
  pushRequest: async (s: { endpoint: string }, payload: string) => new Request(s.endpoint, { method: "POST", body: payload }),
}));
// Both emails on, as switching them back on would (#191 has them off).
vi.mock("~/lib/match-reminders", async (original) => ({
  ...(await original<typeof import("~/lib/match-reminders")>()),
  MATCH_REMINDER_EMAILS: { digest: true, tomorrow: true },
}));
vi.mock("~/lib/cities.server", () => ({ listCities: async () => [{ slug: "gyor", name: "Győr" }] }));

const { migratedDatabase } = await import("~/test/sqlite");
const { settleBackground } = await import("~/test/background");
const { RunBudget, RUN_LIMITS } = await import("~/lib/run-usage");
const G = await import("~/lib/groups.server");
const { INLINE_PUSH_CALLS, MAX_PUSH_DEVICES } = await import("~/lib/notifications.server");
const { beginInvocation } = await import("~/lib/log");
const { DELIVER_MIN } = await import("~/lib/email/outbox.server");
const { runCron } = await import("~/lib/hourly-job.server");
const { forgetMorningDone } = await import("~/lib/match-reminders.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const PAIRS = 100;
const DEVICES = 150;
const LEVELS = ["versenyzo", "halado", "kozephalado", "kezdo"];
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];

// 100 pairs in 25 groups of 4. On Wednesday of week 2 every pair has two
// matches due a reminder: its week-1 match, still not scheduled ("pótoljátok
// a kör végéig"), and its week-2 match, with no proposal yet.
async function bigLeague() {
  await enteredLeague();
  expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
  expect(await G.publishGroups(1, "o", new Date("2026-11-08T08:00:00Z"))).toEqual({ ok: true });
  await settleBackground();
  h.raw.exec("delete from notifications");
  h.raw.exec("delete from email_messages");
  const device = h.raw.prepare("insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (?, ?, 'k', 'a')");
  const players = h.raw.prepare("select id from users where id != 'o' order by id").all() as { id: string }[];
  players.slice(0, DEVICES).forEach((p, i) => device.run(`https://push.example/${i}`, p.id));
  h.sent = [];
  h.pushes = [];
}

// The league's 100 pairs entered for the season, no groups yet.
async function enteredLeague() {
  forgetMorningDone();
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
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('o', 'o@x.hu', 'Org', 'versenyzo', 1)`);
  const user = h.raw.prepare("insert into users (id, email, name, level, phone, consent_at) values (?, ?, ?, ?, '+36301234567', 1)");
  const pair = h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)");
  const entry = h.raw.prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, 'approved', 1, ?)");
  for (let id = 1; id <= PAIRS; id++) {
    for (const side of ["a", "b"]) user.run(`p${id}${side}`, `p${id}${side}@x.hu`, `Játékos ${id}${side.toUpperCase()}`, LEVELS[id % 4]);
    pair.run(id, `p${id}a`, `p${id}b`);
    entry.run(id, sec("2026-11-06T10:00:00Z") + id);
  }
}

const count = (q: string) => (h.raw.prepare(q).get() as { n: number }).n;

describe("the cron within the run limits (#183)", () => {
  let lines: { event: string; result?: string }[] = [];

  beforeEach(async () => {
    await bigLeague();
    vi.stubGlobal("fetch", async (req: Request) => {
      h.pushes.push(`${req.url} ${JSON.parse(await req.text()).url}`);
      return new Response(null, { status: 201 });
    });
    lines = [];
    for (const method of ["log", "warn", "error"] as const)
      vi.spyOn(console, method).mockImplementation((line: { event: string; result?: string }) => void lines.push(line));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reaches every player the same morning, once, with no run over 50 queries or 50 outgoing calls", async () => {
    expect(count("select count(*) as n from matches")).toBe(150);
    const runs: { at: string; queries: number; calls: number; pushes: number }[] = [];
    // Wednesday of week 2, every 10 minutes from 07:00 until noon.
    for (let minutes = 0; minutes < 5 * 60; minutes += 10) {
      const at = budapestTime("2026-11-18", 7 + Math.floor(minutes / 60), minutes % 60);
      const budget = new RunBudget();
      const pushesBefore = h.pushes.length;
      await runCron(at);
      runs.push({ at: at.toISOString(), ...budget.used(), pushes: h.pushes.length - pushesBefore });
    }

    // No run over the limits, and the first one did real work.
    for (const r of runs) {
      expect(r.queries, r.at).toBeLessThanOrEqual(RUN_LIMITS.queries);
      expect(r.calls, r.at).toBeLessThanOrEqual(RUN_LIMITS.calls);
    }
    expect(runs[0].calls).toBeGreaterThan(40);

    // Every player: two reminders in the app.
    expect(count("select count(*) as n from notifications where kind in ('match_week_end', 'match_no_proposal')")).toBe(400);
    expect(
      count(
        "select count(*) as n from (select user_id from notifications where kind in ('match_week_end', 'match_no_proposal') group by user_id having count(*) = 2)",
      ),
    ).toBe(200);
    // Every device: each of its player's two reminders, once.
    expect(h.pushes).toHaveLength(DEVICES * 2);
    expect(new Set(h.pushes).size).toBe(DEVICES * 2);
    expect(count("select count(*) as n from notifications where push_due_at is not null")).toBe(0);
    // Every player: one digest email, sent once.
    const digests = h.sent.filter((m) => m.subject.startsWith("Napi összefoglaló"));
    expect(digests).toHaveLength(200);
    expect(new Set(digests.map((m) => m.to)).size).toBe(200);
    expect(count("select count(*) as n from email_messages where status != 'sent'")).toBe(0);
    // All of it before 09:00 (13 runs), and the last runs had nothing to do.
    expect(runs.findIndex((r) => r.pushes === 0)).toBeLessThan(13);

    // A run that left work logs how much.
    const results = lines.filter((l) => l.event === "cron step").map((l) => l.result ?? "");
    expect(results.some((l) => /^pushed \d+ notifications; \d+ left for the next run \(run limits\)$/.test(l))).toBe(true);
  });

  it("one item's devices (capped, #222) always fit a run with the email step's room kept", () => {
    expect(MAX_PUSH_DEVICES).toBeLessThanOrEqual(RUN_LIMITS.calls - DELIVER_MIN.calls);
  });

  it("the round switch: every unplayed match is resolved from 06:00 Monday, within the limits, each once (#11)", async () => {
    // Nobody scheduled anything: 150 matches, both pairs lose, 200 players get a strike each per match.
    await runCron(budapestTime("2026-11-30", 5, 50));
    expect(count("select count(*) as n from matches where status = 'final'")).toBe(0);
    const runs: { at: string; queries: number; calls: number }[] = [];
    // The first hour from 06:00: 6 runs of 25.
    for (let minutes = 0; minutes < 60; minutes += 10) {
      const at = budapestTime("2026-11-30", 6, minutes);
      const budget = new RunBudget();
      await runCron(at);
      runs.push({ at: at.toISOString(), ...budget.used() });
    }
    for (const r of runs) {
      expect(r.queries, r.at).toBeLessThanOrEqual(RUN_LIMITS.queries);
      expect(r.calls, r.at).toBeLessThanOrEqual(RUN_LIMITS.calls);
    }
    expect(count("select count(*) as n from matches where status = 'final'")).toBe(150);
    expect(count("select count(*) as n from match_decisions where kind = 'deadline'")).toBe(150);
    // 3 matches per pair in a group of 4: 3 strikes for each of the 200 players.
    expect(count("select count(*) as n from strikes")).toBe(600);
    expect(count("select count(*) as n from email_messages where kind = 'strike_warning'")).toBe(200);
    expect(count("select count(*) as n from audit_log where action = 'match.deadline'")).toBe(150);
    // Before 06:00 nothing is resolved (a late result may still come in).
    const results = lines.filter((l) => l.event === "cron step").map((l) => l.result ?? "");
    expect(results.filter((l) => /^resolved 25 matches at the deadline; more left for the next run$/.test(l))).toHaveLength(5);
  });

  it("a second morning run makes nothing again", async () => {
    await runCron(budapestTime("2026-11-18", 7, 0));
    const items = count("select count(*) as n from notifications");
    const claims = count("select count(*) as n from match_reminders");
    await runCron(budapestTime("2026-11-18", 7, 10));
    expect(count("select count(*) as n from notifications")).toBe(items);
    expect(count("select count(*) as n from match_reminders")).toBe(claims);
    expect(count("select count(*) as n from email_messages where kind = 'match_digest'")).toBe(200);
  });
});

// #126: a fan-out in a request (the group publish) pushes its first devices
// itself (INLINE_PUSH_CALLS); the rest wait in the queue and the cron delivers
// every one of them, over as many runs as it takes; the emails as before (D158).
describe("a fan-out in a request reaches every device (#126)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (req: Request) => {
      h.pushes.push(`${req.url} ${JSON.parse(await req.text()).url}`);
      return new Response(null, { status: 201 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("publishing the groups with 100 devices on: all 100 get the push, the first at once and the rest from the cron, and every group email goes out", async () => {
    await enteredLeague();
    h.sent = [];
    h.pushes = [];
    // 100 devices: 50 players with one each, 25 with two.
    const device = h.raw.prepare("insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (?, ?, 'k', 'a')");
    const players = h.raw.prepare("select id from users where id != 'o' order by id").all() as { id: string }[];
    players.slice(0, 75).forEach((p, i) => {
      device.run(`https://push.example/${i}`, p.id);
      if (i >= 50) device.run(`https://push.example/${i}-2`, p.id);
    });
    expect(count("select count(*) as n from push_subscriptions")).toBe(100);

    expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
    // The publish as a request (workers/app.ts marks it so).
    const request = new RunBudget();
    const end = beginInvocation("publish");
    try {
      expect(await G.publishGroups(1, "o", new Date("2026-11-08T08:00:00Z"))).toEqual({ ok: true });
      // The emails go after the response (D150), within the invocation's calls.
      await settleBackground();
    } finally {
      end();
    }
    expect(request.used().calls).toBeLessThanOrEqual(RUN_LIMITS.calls);
    // The request pushed its first devices itself, at most its budget; the
    // rest waits in the queue.
    const inline = h.pushes.length;
    expect(inline).toBeGreaterThan(0);
    expect(inline).toBeLessThanOrEqual(INLINE_PUSH_CALLS);
    expect(count("select count(*) as n from notifications where kind = 'groups_published'")).toBe(200);
    expect(count("select count(*) as n from notifications where push_due_at is not null")).toBeGreaterThan(100);
    // The group emails as before: one per player, stored by the request, the
    // first ones sent right after the response.
    expect(count("select count(*) as n from email_messages where kind = 'groups_published'")).toBe(200);
    expect(h.sent.length).toBeGreaterThan(0);

    // The cron's runs, every 10 minutes, until nothing is left.
    const left = () =>
      count("select count(*) as n from notifications where push_due_at is not null") +
      count("select count(*) as n from email_messages where status = 'pending'");
    const runs: { queries: number; calls: number }[] = [];
    for (let minutes = 0; minutes < 60 && left() > 0; minutes += 10) {
      const budget = new RunBudget();
      await runCron(budapestTime("2026-11-08", 9, minutes));
      runs.push(budget.used());
    }
    for (const r of runs) {
      expect(r.queries).toBeLessThanOrEqual(RUN_LIMITS.queries);
      expect(r.calls).toBeLessThanOrEqual(RUN_LIMITS.calls);
    }
    // More than one run: one run alone could not have pushed to 100 devices.
    expect(runs.length).toBeGreaterThan(1);
    expect(count("select count(*) as n from notifications where push_due_at is not null")).toBe(0);
    const groupPushes = h.pushes.filter((p) => / \/notifications\/\d+$/.test(p));
    expect(groupPushes).toHaveLength(100);
    expect(new Set(groupPushes.map((p) => p.split(" ")[0])).size).toBe(100);
    // And every group email went out, once.
    const groupMails = h.sent.filter((m) => m.subject.includes("csoport"));
    expect(groupMails).toHaveLength(200);
    expect(new Set(groupMails.map((m) => m.to)).size).toBe(200);
    expect(count("select count(*) as n from email_messages where status != 'sent'")).toBe(0);
  });
});
