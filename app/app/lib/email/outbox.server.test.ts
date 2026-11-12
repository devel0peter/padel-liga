// The outbox's pair emails on a real SQLite (~/test/sqlite): what gets queued
// and for whom. The sender is stubbed; nothing leaves the process.
import { beforeEach, describe, expect, it, vi } from "vitest";


const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[], gate: null as Promise<void> | null, failAfter: Infinity }));

// The quota tests count against a limit of 100 a day.
vi.mock("cloudflare:workers", () => ({ env: { EMAIL_DAILY_LIMIT: "100" } }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/background.server", () => import("~/test/background"));
// A slow transport while h.gate is set: every send waits for it to open.
vi.mock("~/lib/email/send.server", () => ({
  MAX_BATCH: 100,
  relayConfigured: () => false,
  sendEmails: async (emails: any[]) => {
    if (h.gate) await h.gate;
    // A Worker stopped mid-send: the call never returns a result.
    if (h.sent.length >= h.failAfter) throw new Error("the Worker stopped");
    h.sent.push(...emails);
    return emails.map((_, i) => ({ ok: true, id: `id-${i}` }));
  },
}));
vi.mock("~/lib/cities.server", () => ({ listCities: async () => [{ slug: "gyor", name: "Győr" }] }));

const { migratedDatabase } = await import("~/test/sqlite");
const O = await import("~/lib/email/outbox.server");
const { backgroundPending, settleBackground } = await import("~/test/background");

const messages = () => h.raw.prepare("select kind, to_email, subject, status from email_messages").all();

describe("queueSeasonEntered", () => {
  const input = {
    to: "Béla",
    partnerName: "Anna",
    league: "Padelpárbaj Győr",
    season: "2026/27 tél",
    joins: { phase: 1, startsAt: new Date("2026-11-08T23:00:00Z") },
  };

  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert into users (id, email, name) values ('admin', 'admin@x.hu', 'Admin')`);
    h.sent = [];
  });

  it("sends the email right after the response, without an Admin (#112, D150)", async () => {
    await O.queueSeasonEntered("bela@x.hu", input);
    await settleBackground();
    expect(messages()).toEqual([
      { kind: "season_entry_decision", to_email: "bela@x.hu", subject: "Beneveztetek – Padelpárbaj", status: "sent" },
    ]);
    expect(h.sent.map((m) => m.to)).toEqual(["bela@x.hu"]);
  });

  it("sends nothing to a suppressed address", async () => {
    h.raw.prepare("insert into email_suppressions (email, reason) values (?, ?)").run("bela@x.hu", "unsubscribed");
    await O.queueSeasonEntered("bela@x.hu", input);
    expect(messages()).toEqual([]);
    expect(h.sent).toEqual([]);
  });
});

describe("queueGroupsPublished", () => {
  const input = (to: string) => ({
    to,
    partnerName: "Anna",
    league: "Padelpárbaj Győr",
    season: "2026/27 tél",
    phase: 1,
    group: 1,
    weeks: [{ week: 1, range: "nov. 9. – nov. 15.", opponents: ["Cecil", "Dóra"] as [string, string] }],
    deadline: new Date("2026-11-29T22:59:00Z"),
  });

  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert into users (id, email, name) values ('admin', 'admin@x.hu', 'Admin')`);
    h.sent = [];
  });

  it("sends one email per player right after the response (#112, D150)", async () => {
    await O.queueGroupsPublished([
      { toEmail: "anna@x.hu", input: input("Anna") },
      { toEmail: "bela@x.hu", input: input("Béla") },
    ]);
    // The request itself sent nothing: a closed browser tab can't stop it.
    expect(h.sent).toEqual([]);
    expect(backgroundPending()).toBe(1);
    await settleBackground();
    expect(messages()).toEqual([
      { kind: "groups_published", to_email: "anna@x.hu", subject: "Itt a csoportod: 1. csoport – Padelpárbaj", status: "sent" },
      { kind: "groups_published", to_email: "bela@x.hu", subject: "Itt a csoportod: 1. csoport – Padelpárbaj", status: "sent" },
    ]);
    expect(h.sent.map((m) => m.to)).toEqual(["anna@x.hu", "bela@x.hu"]);
  });

  it("skips a suppressed address", async () => {
    h.raw.prepare("insert into email_suppressions (email, reason) values (?, ?)").run("bela@x.hu", "bounced");
    await O.queueGroupsPublished([
      { toEmail: "anna@x.hu", input: input("Anna") },
      { toEmail: "Bela@x.hu", input: input("Béla") },
    ]);
    expect(messages().map((m: any) => m.to_email)).toEqual(["anna@x.hu"]);
  });

  it("queues a whole league at once; sends at most 50 after the request, the cron the rest within the day's limit", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ toEmail: `p${i}@x.hu`, input: input(`P${i}`) }));
    await O.queueGroupsPublished(many);
    await settleBackground();
    expect(messages()).toHaveLength(120);
    expect(O.SEND_NOW_MAX).toBe(50);
    expect(h.sent).toHaveLength(50);
    expect(messages().filter((m: any) => m.status === "pending")).toHaveLength(70);
    // The cron: daily limit 100, minus the 10 kept for login codes.
    await O.deliver();
    expect(h.sent).toHaveLength(90);
    expect(new Set(h.sent.map((m) => m.to)).size).toBe(90);
    expect(messages().filter((m: any) => m.status === "pending")).toHaveLength(30);
  });

  it("does nothing for an empty list", async () => {
    await O.queueGroupsPublished([]);
    expect(messages()).toEqual([]);
  });
});

// Whatever list a deleted account's placeholder address (#152) slips into,
// no email is stored for it.
describe("a deleted account's placeholder address", () => {
  const group = (to: string, partnerName: string) => ({
    to,
    partnerName,
    league: "Padelpárbaj Győr",
    season: "2026/27 tél",
    phase: 1,
    group: 1,
    weeks: [],
    deadline: new Date("2026-11-29T22:59:00Z"),
  });

  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert into users (id, email, name) values ('admin', 'admin@x.hu', 'Admin')`);
    h.sent = [];
  });

  it("gets no personal, match or reminder email", async () => {
    await O.queueGroupsPublished([
      { toEmail: "anna@x.hu", input: group("Anna", "Béla") },
      { toEmail: "Deleted-u1@deleted.invalid", input: group("Törölt játékos", "Anna") },
    ]);
    expect(
      await O.reminderEmailInserts([
        [{ kind: "match_digest", toEmail: "deleted-u1@deleted.invalid", input: { to: "Törölt játékos", items: [{ title: "x", body: "y", url: "/matches/1" }] } }],
      ]),
    ).toEqual([[]]);
    expect(messages().map((m: any) => m.to_email)).toEqual(["anna@x.hu"]);
  });

  it("gets no broadcast, and the broadcast doesn't count it", async () => {
    await O.createBroadcast({
      subject: "Hír",
      body: "Szia {nev}!",
      audience: "Párok",
      recipients: [
        { email: "anna@x.hu", name: "Anna" },
        { email: "deleted-u1@deleted.invalid", name: "Törölt játékos" },
      ],
      createdBy: "admin@x.hu", actorId: "admin",
    });
    expect(messages().map((m: any) => m.to_email)).toEqual(["anna@x.hu"]);
    expect(h.raw.prepare("select recipients from broadcasts").get()).toEqual({ recipients: 1 });
  });

  it("gets no automatic reminder", async () => {
    const input = {
      situation: "B" as const,
      to: "Törölt játékos",
      email: "deleted-u1@deleted.invalid",
      partner: null,
      league: "L",
      season: "S",
      deadline: new Date("2026-11-06T22:59:00Z"),
      nextRound: null,
      pairLink: null,
      now: new Date("2026-11-02T12:00:00Z"),
    };
    expect(await O.stuckReminderInserts([{ toEmail: "deleted-u1@deleted.invalid", input }])).toEqual([]);
  });
});

// Every email goes out by itself (#112, replaces the held outbox of #88).
describe("automatic outbox", () => {
  const byKind = () =>
    Object.fromEntries(
      h.raw
        .prepare("select kind, group_concat(distinct status) as s from email_messages group by kind")
        .all()
        .map((r: any) => [r.kind, r.s]),
    );
  const insert = (kind: string, n: number, status = "pending", to = "x@x.hu", lastError: string | null = null) => {
    const st = h.raw.prepare(
      "insert into email_messages (kind, to_email, subject, text, status, last_error, claimed_at) values (?, ?, ?, ?, ?, ?, ?)",
    );
    for (let i = 0; i < n; i++) st.run(kind, to, `${kind} ${i}`, `Szia! ${kind} ${i}`, status, lastError, lastError ? 1_800_000_000 + i : null);
  };
  const sentToday = (n: number, kind = "login_code") => {
    const st = h.raw.prepare(
      "insert into email_messages (kind, to_email, subject, status, sent_at) values (?, 'x@x.hu', 's', 'sent', unixepoch())",
    );
    for (let i = 0; i < n; i++) st.run(kind);
  };
  const count = (where: string) => h.raw.prepare(`select count(*) as n from email_messages where ${where}`).get().n;

  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert into users (id, email, name) values ('admin', 'admin@x.hu', 'Admin')`);
    h.sent = [];
  });

  it("sends every kind as soon as it is queued, with no further action", async () => {
    const league = "Padelpárbaj Győr";
    await O.queueSeasonEntered("bela@x.hu", {
      to: "Béla",
      partnerName: "Anna",
      league,
      season: "2026/27 tél",
      joins: null,
    });
    await O.createBroadcast({
      subject: "Hír",
      body: "Szia {nev}!",
      audience: "mind",
      recipients: [{ email: "anna@x.hu", name: "Anna" }],
      createdBy: "admin@x.hu", actorId: "admin",
    });
    await settleBackground();
    await O.queueGroupsPublished([
      {
        toEmail: "bela@x.hu",
        input: {
          to: "Béla",
          partnerName: "Anna",
          league,
          season: "2026/27 tél",
          phase: 1,
          group: 1,
          weeks: [{ week: 1, range: "nov. 9. – nov. 15.", opponents: ["Cecil", "Dóra"] }],
          deadline: new Date("2026-11-29T22:59:00Z"),
        },
      },
    ]);
    await O.queueLoginCode("anna@x.hu", "123456");
    await settleBackground();

    expect(byKind()).toEqual({
      season_entry_decision: "sent",
      broadcast: "sent",
      groups_published: "sent",
      login_code: "sent",
    });
    expect(h.sent).toHaveLength(4);
    expect(h.sent.at(-1).subject).toMatch(/^123 456 a belépőkódod/);
  });

  it("a broadcast to many sends at most 50 in the request", async () => {
    const recipients = Array.from({ length: 70 }, (_, i) => ({ email: `p${i}@x.hu`, name: `P${i}` }));
    await O.createBroadcast({ subject: "Hír", body: "Szia {nev}!", audience: "mind", recipients, createdBy: "admin@x.hu", actorId: "admin" });
    await settleBackground();
    expect(h.sent).toHaveLength(50);
    expect(count("kind = 'broadcast' and status = 'pending'")).toBe(20);
  });

  it("never sends an email twice: one left in 'sending' by a crashed run is marked failed, not retried", async () => {
    insert("pair_intro", 1, "sending");
    insert("pair_intro", 1, "sending", "fresh@x.hu");
    // The first was claimed 11 minutes ago, the second just now.
    h.raw.prepare("update email_messages set claimed_at = unixepoch() - 660 where to_email = 'x@x.hu'").run();
    h.raw.prepare("update email_messages set claimed_at = unixepoch() where to_email = 'fresh@x.hu'").run();
    expect(await O.deliver()).toEqual({ sent: 0 });
    expect(h.sent).toEqual([]);
    expect(h.raw.prepare("select to_email, status, last_error from email_messages order by id").all()).toEqual([
      { to_email: "x@x.hu", status: "failed", last_error: O.INTERRUPTED },
      { to_email: "fresh@x.hu", status: "sending", last_error: null },
    ]);
    // A claimed row is never claimed again by another run.
    expect(await O.deliver()).toEqual({ sent: 0 });
    expect(h.sent).toEqual([]);
  });

  it("works from the time it is given (the cron run's scheduled time, #188), not the clock", async () => {
    // Claimed 5 minutes ago: fresh by the clock, but 11 minutes old for a run
    // scheduled 6 minutes from now.
    insert("pair_intro", 1, "sending");
    h.raw.prepare("update email_messages set claimed_at = unixepoch() - 300").run();
    expect(await O.deliver(undefined, new Date(Date.now() + 6 * 60 * 1000))).toEqual({ sent: 0 });
    expect(h.raw.prepare("select status, last_error from email_messages").get()).toEqual({ status: "failed", last_error: O.INTERRUPTED });
  });

  it("with the daily limit used up, a new email stays queued and goes out on the next run after the limit frees up", async () => {
    sentToday(100);
    await O.queueSeasonEntered("bela@x.hu", {
      to: "Béla",
      partnerName: "Anna",
      league: "Padelpárbaj Győr",
      season: "2026/27 tél",
      joins: null,
    });
    expect(h.sent).toEqual([]);
    expect(count("kind = 'season_entry_decision' and status = 'pending'")).toBe(1);
    // The cron, still within the same 24 hours: nothing.
    expect(await O.deliver()).toEqual({ sent: 0 });
    // A day later the limit is free again.
    h.raw.prepare("update email_messages set sent_at = sent_at - 25 * 3600 where status = 'sent'").run();
    expect(await O.deliver()).toEqual({ sent: 1 });
    expect(h.sent.map((m) => m.to)).toEqual(["bela@x.hu"]);
  });

  it("keeps the send order and the reserves: login codes, then personal mail, then bulk mail", async () => {
    insert("broadcast", 20);
    insert("pair_intro", 20);
    sentToday(80);
    // 100 a day: personal mail leaves the last 10 to login codes, bulk mail
    // the last 15 to all personal mail.
    expect(await O.deliver()).toEqual({ sent: 10 });
    expect(h.sent.every((m) => m.subject.startsWith("pair_intro"))).toBe(true);
    expect(count("status = 'pending'")).toBe(30);
  });

  it("logs waiting, sent and failed emails per kind with the newest failure's reason, and no address", async () => {
    insert("pair_intro", 2, "sent", "cili@x.hu");
    insert("pair_intro", 1, "pending", "dani@x.hu");
    insert("pair_intro", 1, "sending", "dani@x.hu");
    insert("broadcast", 3, "sent");
    insert("broadcast", 1, "failed", "bad@x.hu", "relay: RCPT TO: 550 5.1.1 <bad@x.hu> does not exist; resend: 422 bad");
    insert("broadcast", 1, "pending", "late@x.hu", "relay: connection: timed out; resend: 429 rate_limit_exceeded: slow down");
    const log = await O.outboxLog();
    expect(log).toEqual([
      { kind: "pair_intro", waiting: 2, sent: 2, failed: 0, lastError: null },
      {
        kind: "broadcast",
        waiting: 1,
        sent: 3,
        failed: 1,
        // The newest attempt: the pending one, tried after the failed one.
        lastError: {
          reason: "relay: connection: timed out; resend: 429 rate_limit_exceeded: slow down",
          at: new Date(1_800_000_000 * 1000),
        },
      },
    ]);
    insert("broadcast", 1, "failed", "zed@x.hu", "relay: RCPT TO: 550 5.1.1 <zed@x.hu> does not exist");
    h.raw.prepare("update email_messages set claimed_at = 1900000000 where to_email = 'zed@x.hu'").run();
    const [, broadcast] = await O.outboxLog();
    expect(broadcast.lastError?.reason).toBe("relay: RCPT TO: 550 5.1.1 <[elrejtve]> does not exist");
    expect(JSON.stringify(await O.outboxLog())).not.toMatch(/@|%40/);
  });

  it("logs nothing when no email was ever queued", async () => {
    expect(await O.outboxLog()).toEqual([]);
  });
});

// Bulk mail doesn't keep the Admin's page loading (#140): the click only
// queues, the send runs after the response; personal mail stays in-request.
describe("bulk mail after the response", () => {
  let open!: () => void;
  const slowTransport = () => {
    h.gate = new Promise<void>((resolve) => (open = resolve));
  };
  const status = () =>
    h.raw.prepare("select status, count(*) as n from email_messages group by status order by status").all();

  beforeEach(async () => {
    await settleBackground();
    h.raw = migratedDatabase();
    h.raw.exec(`insert into users (id, email, name) values ('admin', 'admin@x.hu', 'Admin')`);
    h.sent = [];
    h.gate = null;
  });

  it("a broadcast answers without waiting for any send", async () => {
    slowTransport();
    const recipients = [{ email: "anna@x.hu", name: "Anna" }];
    await O.createBroadcast({ subject: "Hír", body: "Szia {nev}!", audience: "mind", recipients, createdBy: "admin@x.hu", actorId: "admin" });
    expect(h.sent).toEqual([]);
    expect(backgroundPending()).toBe(1);
    open();
    await settleBackground();
    expect(h.sent.map((m) => m.to)).toEqual(["anna@x.hu"]);
  });

  it("an overlapping cron run sends none of a broadcast's emails twice", async () => {
    slowTransport();
    const recipients = Array.from({ length: 60 }, (_, i) => ({ email: `p${i}@x.hu`, name: `P${i}` }));
    await O.createBroadcast({ subject: "Hír", body: "Szia {nev}!", audience: "mind", recipients, createdBy: "admin@x.hu", actorId: "admin" });
    // The cron starts while the background send waits on the transport.
    const cron = O.deliver();
    open();
    await Promise.all([cron, settleBackground()]);
    expect(h.sent).toHaveLength(60);
    expect(new Set(h.sent.map((m) => m.to)).size).toBe(60);
    expect(status()).toEqual([{ status: "sent", n: 60 }]);
  });

  it("a login code, too, answers without waiting for the send (D150)", async () => {
    slowTransport();
    await O.queueLoginCode("anna@x.hu", "123456");
    expect(h.sent).toEqual([]);
    expect(backgroundPending()).toBe(1);
    open();
    await settleBackground();
    expect(h.sent.map((m) => m.to)).toEqual(["anna@x.hu"]);
  });

  // 2026-11-08: the Worker stopped while one call sent the 50 group emails;
  // none was marked, so none could be told apart (D150).
  it("a send stopped midway leaves at most SEND_CHUNK unknown; the rest wait for the cron", async () => {
    h.failAfter = O.SEND_CHUNK;
    const input = {
      to: "x",
      partnerName: "y",
      league: "Padelpárbaj Győr",
      season: "2026/27 tél",
      phase: 1,
      group: 1,
      weeks: [],
      deadline: new Date("2026-11-29T22:59:00Z"),
    };
    try {
      await O.queueGroupsPublished(Array.from({ length: 40 }, (_, i) => ({ toEmail: `p${i}@x.hu`, input })));
      // The real runAfterResponse logs the failure; the stand-in passes it on.
      await expect(settleBackground()).rejects.toThrow("the Worker stopped");
    } finally {
      h.failAfter = Infinity;
    }
    expect(O.SEND_CHUNK).toBe(10);
    expect(status()).toEqual([
      { status: "pending", n: 20 },
      { status: "sending", n: 10 },
      { status: "sent", n: 10 },
    ]);
    // The next cron run sends the 20 that never left; the 10 unknown stay
    // for the Admin to check (Újraküldés).
    await O.deliver();
    expect(h.sent).toHaveLength(30);
    expect(status()).toEqual([
      { status: "sending", n: 10 },
      { status: "sent", n: 30 },
    ]);
  });
});

// Open tracking (#243, D161): every email but a login code gets its own
// random token when queued, and its tracking image when sent.
describe("open tracking", async () => {
  const { db } = await import("~/db/client.server");
  const rows = () =>
    h.raw.prepare("select kind, to_email, open_token from email_messages order by id").all() as { kind: string; to_email: string; open_token: string | null }[];
  const group = (to: string) => ({
    to,
    partnerName: "Anna",
    league: "Padelpárbaj Győr",
    season: "2026/27 tél",
    phase: 1,
    group: 1,
    weeks: [],
    deadline: new Date("2026-11-29T22:59:00Z"),
  });

  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert into users (id, email, name) values ('admin', 'admin@x.hu', 'Admin')`);
    h.sent = [];
  });

  it("every queued kind but a login code gets a token of its own; the sent HTML has its image, the login code none", async () => {
    await O.queueGroupsPublished([
      { toEmail: "anna@x.hu", input: group("Anna") },
      { toEmail: "bela@x.hu", input: group("Béla") },
    ]);
    await O.createBroadcast({
      subject: "Hír",
      body: "Szia {nev}!",
      audience: "mind",
      recipients: [{ email: "anna@x.hu", name: "Anna" }],
      createdBy: "admin@x.hu",
      actorId: "admin",
    });
    await O.queueLoginCode("anna@x.hu", "123456");
    const [reminders] = await O.reminderEmailInserts([[{ kind: "strike_warning", toEmail: "cecil@x.hu", input: { to: "Cecil", league: "L", season: "S" } }]]);
    await db.batch(reminders as [any, ...any[]]);
    await settleBackground();
    await O.deliver();

    const stored = rows();
    expect(stored.map((r) => r.kind)).toEqual(["groups_published", "groups_published", "broadcast", "login_code", "strike_warning"]);
    expect(stored.find((r) => r.kind === "login_code")!.open_token).toBeNull();
    const tracked = stored.filter((r) => r.kind !== "login_code");
    for (const r of tracked) expect(r.open_token).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(tracked.map((r) => r.open_token)).size).toBe(tracked.length);

    expect(h.sent).toHaveLength(5);
    for (const r of tracked) {
      const email = h.sent.find((m) => m.html.includes(r.open_token!));
      expect(email.to).toBe(r.to_email);
      expect(email.html).toContain(`<img src="https://padelparbaj.hu/email/open/${r.open_token}" width="1" height="1" alt=""`);
      // Only its own image: no other email's token.
      expect(tracked.filter((o) => email.html.includes(o.open_token!))).toEqual([r]);
    }
    const code = h.sent.find((m) => m.subject.includes("belépőkód"));
    expect(code.html).not.toContain("/email/open/");
    expect(code.html).not.toContain("<img");
    expect(h.raw.prepare("select count(*) as n from email_messages where html is not null").get().n).toBe(0);
  });

  it("the automatic reminders get a token too", async () => {
    const input = {
      situation: "B" as const,
      to: "Anna",
      email: "anna@x.hu",
      partner: null,
      league: "L",
      season: "S",
      deadline: new Date("2026-11-06T22:59:00Z"),
      nextRound: null,
      pairLink: null,
      now: new Date("2026-11-02T12:00:00Z"),
    };
    await db.batch((await O.stuckReminderInserts([{ toEmail: "anna@x.hu", input }])) as [any, ...any[]]);
    expect(rows()).toEqual([{ kind: "stuck_reminder", to_email: "anna@x.hu", open_token: expect.stringMatching(/^[0-9a-f]{32}$/) }]);
  });

  it("an email put back in the queue keeps its token", async () => {
    const token = "ab".repeat(16);
    h.raw
      .prepare(
        "insert into email_messages (kind, to_email, subject, text, html, status, open_token) values ('groups_published', 'anna@x.hu', 's', 't', '<body></body>', 'failed', ?)",
      )
      .run(token);
    expect(await O.retryFailed("groups_published", { id: "admin" })).toBe(1);
    await settleBackground();
    expect(rows()[0].open_token).toBe(token);
    expect(h.sent[0].html).toContain(`/email/open/${token}`);
  });

  it("an email from before the tracking (no token) goes out without an image", async () => {
    h.raw.prepare("insert into email_messages (kind, to_email, subject, text, html) values ('broadcast', 'anna@x.hu', 's', 't', '<body></body>')").run();
    await O.deliver();
    expect(h.sent[0].html).toBe("<body></body>");
  });
});
