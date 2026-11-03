// The outbox's pair emails on a real SQLite (~/test/sqlite): what gets queued
// and for whom. The sender is stubbed; nothing leaves the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InterestSignup } from "~/lib/interest";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[], gate: null as Promise<void> | null }));

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
    h.sent = [];
  });

  it("sends the email right away, without an Admin (#112)", async () => {
    await O.queueSeasonEntered("bela@x.hu", input);
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
    h.sent = [];
  });

  it("sends one email per player right away (#112)", async () => {
    await O.queueGroupsPublished([
      { toEmail: "anna@x.hu", input: input("Anna") },
      { toEmail: "bela@x.hu", input: input("Béla") },
    ]);
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

  it("queues a whole league at once; sends at most 50 in the request, the cron the rest within the day's limit", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ toEmail: `p${i}@x.hu`, input: input(`P${i}`) }));
    await O.queueGroupsPublished(many);
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
    h.sent = [];
  });

  it("gets no personal, match or reminder email", async () => {
    await O.queueGroupsPublished([
      { toEmail: "anna@x.hu", input: group("Anna", "Béla") },
      { toEmail: "Deleted-u1@deleted.invalid", input: group("Törölt játékos", "Anna") },
    ]);
    await O.queueReminderEmails([
      { kind: "match_digest", toEmail: "deleted-u1@deleted.invalid", input: { to: "Törölt játékos", items: [{ title: "x", body: "y", url: "/matches/1" }] } },
    ]);
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
      createdBy: "admin@x.hu",
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
  const signup: InterestSignup = {
    city: "gyor",
    cityOther: null,
    mode: "pair",
    name1: "Nagy Anna",
    email1: "anna@x.hu",
    name2: "Kovács Béla",
    email2: "bela@x.hu",
    level: "kezdo",
    note: null,
    ref: null,
    homeClub: null,
    wantsToOrganize: false,
  };
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
    h.sent = [];
  });

  it("sends every kind as soon as it is queued, with no further action", async () => {
    h.raw.prepare("insert into leagues (city, slug, name) values ('gyor', 'gyor', 'Padelpárbaj Győr')").run();
    h.raw
      .prepare(
        "insert into interest_signups (mode, name1, email1, name2, email2, level, consent_at, city) values ('pair', 'Zsófi', 'zsofi@x.hu', 'Ödön', 'odon@x.hu', 'kezdo', 1, 'gyor')",
      )
      .run();
    const league = "Padelpárbaj Győr";
    await O.deliver(await O.queueSignupEmails(signup));
    await O.deliver(
      await O.queuePairIntros(
        { name: "Cili", email: "cili@x.hu", level: "kezdo" },
        { name: "Dani", email: "dani@x.hu", level: "kezdo" },
        "Győr",
      ),
    );
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
      createdBy: "admin@x.hu",
    });
    expect(await O.queueRegistrationInvites()).toBe(2);
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

    expect(byKind()).toEqual({
      signup_confirmation: "sent",
      partner_notice: "sent",
      pair_intro: "sent",
      season_entry_decision: "sent",
      broadcast: "sent",
      registration_invite: "sent",
      groups_published: "sent",
      login_code: "sent",
    });
    expect(h.sent).toHaveLength(10);
    expect(h.sent.at(-1).subject).toMatch(/^123 456 a belépőkódod/);
  });

  it("a broadcast to many sends at most 50 in the request", async () => {
    const recipients = Array.from({ length: 70 }, (_, i) => ({ email: `p${i}@x.hu`, name: `P${i}` }));
    await O.createBroadcast({ subject: "Hír", body: "Szia {nev}!", audience: "mind", recipients, createdBy: "admin@x.hu" });
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

  it("registration invites go out right after the response, only the ones just queued", async () => {
    h.raw.prepare("insert into leagues (city, slug, name) values ('gyor', 'gyor', 'Padelpárbaj Győr')").run();
    h.raw
      .prepare(
        "insert into interest_signups (mode, name1, email1, name2, email2, level, consent_at, city) values ('pair', 'Zsófi', 'zsofi@x.hu', 'Ödön', 'odon@x.hu', 'kezdo', 1, 'gyor')",
      )
      .run();
    // Something else waiting (over yesterday's limit) is left to the cron.
    insert("broadcast", 1);
    expect(await O.queueRegistrationInvites()).toBe(2);
    await settleBackground();
    expect(h.sent.map((m) => m.to).sort()).toEqual(["odon@x.hu", "zsofi@x.hu"]);
    expect(count("kind = 'broadcast' and status = 'pending'")).toBe(1);
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
  const inviteList = (n: number) => {
    h.raw.prepare("insert into leagues (city, slug, name) values ('gyor', 'gyor', 'Padelpárbaj Győr')").run();
    const st = h.raw.prepare(
      "insert into interest_signups (mode, name1, email1, level, consent_at, city) values ('solo', ?, ?, 'kezdo', 1, 'gyor')",
    );
    for (let i = 0; i < n; i++) st.run(`P${i}`, `p${i}@x.hu`);
  };

  beforeEach(async () => {
    await settleBackground();
    h.raw = migratedDatabase();
    h.sent = [];
    h.gate = null;
  });

  it("the invite action answers without waiting for any send", async () => {
    inviteList(3);
    slowTransport();
    // Resolves although the transport hasn't answered a single email.
    expect(await O.queueRegistrationInvites()).toBe(3);
    expect(h.sent).toEqual([]);
    expect(backgroundPending()).toBe(1);
    open();
    await settleBackground();
    expect(h.sent.map((m) => m.to).sort()).toEqual(["p0@x.hu", "p1@x.hu", "p2@x.hu"]);
    expect(status()).toEqual([{ status: "sent", n: 3 }]);
  });

  it("a broadcast answers without waiting for any send", async () => {
    slowTransport();
    const recipients = [{ email: "anna@x.hu", name: "Anna" }];
    await O.createBroadcast({ subject: "Hír", body: "Szia {nev}!", audience: "mind", recipients, createdBy: "admin@x.hu" });
    expect(h.sent).toEqual([]);
    expect(backgroundPending()).toBe(1);
    open();
    await settleBackground();
    expect(h.sent.map((m) => m.to)).toEqual(["anna@x.hu"]);
  });

  it("an overlapping cron run sends none of the queued invites twice", async () => {
    inviteList(60);
    slowTransport();
    expect(await O.queueRegistrationInvites()).toBe(60);
    // The cron starts while the background send waits on the transport.
    const cron = O.deliver();
    open();
    await Promise.all([cron, settleBackground()]);
    expect(h.sent).toHaveLength(60);
    expect(new Set(h.sent.map((m) => m.to)).size).toBe(60);
    expect(status()).toEqual([{ status: "sent", n: 60 }]);
  });

  it("a login code is still sent inside its request", async () => {
    slowTransport();
    let answered = false;
    const request = O.queueLoginCode("anna@x.hu", "123456").then(() => (answered = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(answered).toBe(false);
    expect(backgroundPending()).toBe(0);
    open();
    await request;
    expect(h.sent.map((m) => m.to)).toEqual(["anna@x.hu"]);
  });
});
