// The outbox's pair emails on a real SQLite (~/test/sqlite): what gets queued
// and for whom. The sender is stubbed; nothing leaves the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InterestSignup } from "~/lib/interest";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[] }));

// The quota tests count against a limit of 100 a day.
vi.mock("cloudflare:workers", () => ({ env: { EMAIL_DAILY_LIMIT: "100" } }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/send.server", () => ({
  MAX_BATCH: 100,
  sendEmails: async (emails: any[]) => {
    h.sent.push(...emails);
    return emails.map((_, i) => ({ ok: true, id: `id-${i}` }));
  },
}));
vi.mock("~/lib/cities.server", () => ({ listCities: async () => [{ slug: "gyor", name: "Győr" }] }));

const { migratedDatabase } = await import("~/test/sqlite");
const O = await import("~/lib/email/outbox.server");

const messages = () => h.raw.prepare("select kind, to_email, subject, status from email_messages").all();

describe("queueSeasonEntryDecision", () => {
  const input = {
    to: "Béla",
    partnerName: "Anna",
    league: "Padelpárbaj Győr",
    season: "2026/27 tél",
    approved: true,
    joins: { phase: 1, startsAt: new Date("2026-11-08T23:00:00Z") },
    note: null,
  };

  beforeEach(() => {
    h.raw = migratedDatabase();
    h.sent = [];
  });

  it("queues one email, held for the Admin (#88)", async () => {
    await O.queueSeasonEntryDecision("bela@x.hu", input);
    expect(messages()).toEqual([
      { kind: "season_entry_decision", to_email: "bela@x.hu", subject: "Jóváhagyták a nevezéseteket – Padelpárbaj", status: "held" },
    ]);
    expect(h.sent).toEqual([]);
  });

  it("sends nothing to a suppressed address", async () => {
    h.raw.prepare("insert into email_suppressions (email, reason) values (?, ?)").run("bela@x.hu", "unsubscribed");
    await O.queueSeasonEntryDecision("bela@x.hu", input);
    expect(messages()).toEqual([]);
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

  it("queues one email per player, held for the Admin (#88)", async () => {
    await O.queueGroupsPublished([
      { toEmail: "anna@x.hu", input: input("Anna") },
      { toEmail: "bela@x.hu", input: input("Béla") },
    ]);
    expect(messages()).toEqual([
      { kind: "groups_published", to_email: "anna@x.hu", subject: "Itt a csoportod: 1. csoport – Padelpárbaj", status: "held" },
      { kind: "groups_published", to_email: "bela@x.hu", subject: "Itt a csoportod: 1. csoport – Padelpárbaj", status: "held" },
    ]);
    expect(h.sent).toEqual([]);
  });

  it("skips a suppressed address", async () => {
    h.raw.prepare("insert into email_suppressions (email, reason) values (?, ?)").run("bela@x.hu", "bounced");
    await O.queueGroupsPublished([
      { toEmail: "anna@x.hu", input: input("Anna") },
      { toEmail: "Bela@x.hu", input: input("Béla") },
    ]);
    expect(messages().map((m: any) => m.to_email)).toEqual(["anna@x.hu"]);
  });

  it("queues a whole league at once, within D1's parameter limit; once sent, what is over the day's quota waits", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ toEmail: `p${i}@x.hu`, input: input(`P${i}`) }));
    await O.queueGroupsPublished(many);
    expect(messages()).toHaveLength(120);
    expect(h.sent).toEqual([]);
    expect(await O.releaseHeld("groups_published", 1000)).toEqual({ released: 120, skipped: 0 });
    await O.deliver();
    // Daily limit 100, minus the 10 kept for login codes.
    expect(h.sent).toHaveLength(90);
    expect(messages().filter((m: any) => m.status === "pending")).toHaveLength(30);
  });

  it("does nothing for an empty list", async () => {
    await O.queueGroupsPublished([]);
    expect(messages()).toEqual([]);
  });
});

// The held outbox (#88, D23-D25): only login codes and signup confirmations
// go out by themselves; the rest waits for the Admin.
describe("held outbox", () => {
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
  };
  const byKind = () =>
    Object.fromEntries(
      h.raw
        .prepare("select kind, group_concat(distinct status) as s from email_messages group by kind")
        .all()
        .map((r: any) => [r.kind, r.s]),
    );
  const insert = (kind: string, n: number, status = "held", to = "x@x.hu") => {
    const st = h.raw.prepare("insert into email_messages (kind, to_email, subject, text, status) values (?, ?, ?, ?, ?)");
    for (let i = 0; i < n; i++) st.run(kind, to, `${kind} ${i}`, `Szia! ${kind} ${i}`, status);
  };
  const sentToday = (n: number) => {
    const st = h.raw.prepare(
      "insert into email_messages (kind, to_email, subject, status, sent_at) values ('login_code', 'x@x.hu', 's', 'sent', unixepoch())",
    );
    for (let i = 0; i < n; i++) st.run();
  };
  const count = (where: string) => h.raw.prepare(`select count(*) as n from email_messages where ${where}`).get().n;

  beforeEach(() => {
    h.raw = migratedDatabase();
    h.sent = [];
  });

  it("queues every kind but login codes and signup confirmations as held, and sends none of them", async () => {
    h.raw.prepare("insert into leagues (city, slug, name) values ('gyor', 'gyor', 'Padelpárbaj Győr')").run();
    h.raw
      .prepare(
        "insert into interest_signups (mode, name1, email1, name2, email2, level, consent_at, city) values ('pair', 'Zsófi', 'zsofi@x.hu', 'Ödön', 'odon@x.hu', 'kezdo', 1, 'gyor')",
      )
      .run();
    const league = "Padelpárbaj Győr";
    await O.deliver(await O.queueSignupEmails(signup));
    await O.queuePairIntros(
      { name: "Cili", email: "cili@x.hu", level: "kezdo" },
      { name: "Dani", email: "dani@x.hu", level: "kezdo" },
      "Győr",
    );
    await O.queueSeasonEntryDecision("bela@x.hu", {
      to: "Béla",
      partnerName: "Anna",
      league,
      season: "2026/27 tél",
      approved: false,
      joins: null,
      note: null,
    });
    await O.createBroadcast({
      subject: "Hír",
      body: "Szia {nev}!",
      audience: "mind",
      recipients: [{ email: "anna@x.hu", name: "Anna" }],
      createdBy: "admin@x.hu",
    });
    expect(await O.queueRegistrationInvites()).toBe(2);
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
    await O.deliver();

    expect(byKind()).toEqual({
      signup_confirmation: "sent",
      login_code: "sent",
      partner_notice: "held",
      pair_intro: "held",
      season_entry_decision: "held",
      broadcast: "held",
      registration_invite: "held",
      groups_published: "held",
    });
    expect(h.sent.map((m) => m.to)).toEqual(["anna@x.hu", "anna@x.hu"]);
    expect(h.sent[1].subject).toMatch(/^123 456 a belépőkódod/);
  });

  it("never sends held mail, also when the cron runs with nothing else queued", async () => {
    insert("pair_answer", 3);
    insert("broadcast", 2);
    expect(await O.deliver()).toEqual({ sent: 0 });
    expect(await O.deliver([1, 2, 3, 4, 5])).toEqual({ sent: 0 });
    expect(h.sent).toEqual([]);
    expect(count("status = 'held'")).toBe(5);
  });

  it("lists held mail per kind with one preview, without any address", async () => {
    insert("pair_answer", 2, "held", "anna@x.hu");
    h.raw
      .prepare(
        "insert into email_messages (kind, to_email, subject, text, status) values ('pair_intro', 'cili@x.hu', 'Párt találtunk', ?, 'held')",
      )
      .run("Szia Cili!\n\nAz e-mail-címe: dani@x.hu\nhttps://padelparbaj.hu/login?email=cili%40x.hu");
    insert("pair_answer", 1, "sent");
    insert("login_code", 1, "pending");
    const held = await O.listHeld();
    expect(held.map(({ kind, count }) => ({ kind, count }))).toEqual([
      { kind: "pair_answer", count: 2 },
      { kind: "pair_intro", count: 1 },
    ]);
    expect(held[0]).toEqual({ kind: "pair_answer", count: 2, upTo: 2, subject: "pair_answer 0", text: "Szia! pair_answer 0" });
    expect(held[1].text).toBe("Szia Cili!\n\nAz e-mail-címe: [elrejtve]\nhttps://padelparbaj.hu/login?email=[elrejtve]");
    expect(JSON.stringify(held)).not.toMatch(/@|%40/);
  });

  it("Küldés releases only that kind, up to what the Admin saw", async () => {
    insert("pair_answer", 3);
    insert("pair_dissolved", 2);
    insert("pair_answer", 1, "failed");
    expect(await O.releaseHeld("pair_answer", 2)).toEqual({ released: 2, skipped: 0 });
    expect(count("kind = 'pair_answer' and status = 'pending'")).toBe(2);
    expect(count("kind = 'pair_answer' and status = 'held'")).toBe(1);
    expect(count("kind = 'pair_answer' and status = 'failed'")).toBe(1);
    expect(count("kind = 'pair_dissolved' and status = 'held'")).toBe(2);
    await O.deliver();
    expect(h.sent.map((m) => m.subject)).toEqual(["pair_answer 0", "pair_answer 1"]);
  });

  it("released mail still keeps the daily quota and its reserves", async () => {
    insert("pair_answer", 20);
    insert("broadcast", 20);
    sentToday(80);
    await O.releaseHeld("pair_answer", 1000);
    await O.releaseHeld("broadcast", 1000);
    // 100 a day: transactional mail leaves the last 10 to login codes,
    // broadcasts the last 15 to all transactional mail.
    expect(await O.deliver()).toEqual({ sent: 10 });
    expect(h.sent.every((m) => m.subject.startsWith("pair_answer"))).toBe(true);
    expect(count("status = 'pending'")).toBe(30);
    expect(count("status = 'held'")).toBe(0);
  });

  it("Küldés drops mail to an address that unsubscribed or bounced while it was held", async () => {
    insert("broadcast", 1, "held", "anna@x.hu");
    insert("broadcast", 1, "held", "Bela@x.hu");
    insert("broadcast", 1, "held", "cili@x.hu");
    insert("pair_answer", 1, "held", "bela@x.hu");
    await O.suppress("anna@x.hu", "unsubscribed");
    await O.suppress("bela@x.hu", "bounced");
    expect(await O.releaseHeld("broadcast", 1000)).toEqual({ released: 1, skipped: 2 });
    await O.deliver();
    expect(h.sent.map((m) => m.to)).toEqual(["cili@x.hu"]);
    expect(count("kind = 'broadcast'")).toBe(1);
    expect(count("kind = 'pair_answer' and status = 'held'")).toBe(1);
  });

  it("Elvetés deletes only that kind's held mail, up to what the Admin saw", async () => {
    insert("pair_answer", 3);
    insert("pair_answer", 1, "pending");
    insert("pair_answer", 1, "sent");
    insert("pair_dissolved", 2);
    expect(await O.discardHeld("pair_answer", 2)).toBe(2);
    expect(count("kind = 'pair_answer'")).toBe(3);
    expect(count("kind = 'pair_answer' and status = 'held'")).toBe(1);
    expect(count("kind = 'pair_dissolved' and status = 'held'")).toBe(2);
    expect(h.sent).toEqual([]);
  });

  const pairSignup = (name1: string, email1: string, name2: string, email2: string) =>
    h.raw
      .prepare(
        "insert into interest_signups (mode, name1, email1, name2, email2, level, consent_at, city) values ('pair', ?, ?, ?, ?, 'kezdo', 1, 'gyor')",
      )
      .run(name1, email1, name2, email2);
  const marks = () =>
    h.raw.prepare("select invited_at is not null as one, invited2_at is not null as two from interest_signups order by id").all();

  it("Elvetés on registration invites lets the invite button offer those addresses again, partners included", async () => {
    h.raw.prepare("insert into leagues (city, slug, name) values ('gyor', 'gyor', 'Padelpárbaj Győr')").run();
    pairSignup("Zsófi", "zsofi@x.hu", "Ödön", "Odon@x.hu");
    pairSignup("Cili", "cili@x.hu", "Dani", "dani@x.hu");
    expect(await O.queueRegistrationInvites()).toBe(4);
    expect(marks()).toEqual([
      { one: 1, two: 1 },
      { one: 1, two: 1 },
    ]);
    expect((await O.pendingRegistrationInvites()).length).toBe(0);
    const [held] = await O.listHeld();

    expect(await O.discardHeld("registration_invite", held.upTo)).toBe(4);
    expect(count("kind = 'registration_invite'")).toBe(0);
    // Both the signer's mark (invited_at) and the partner's (invited2_at) are cleared.
    expect(marks()).toEqual([
      { one: 0, two: 0 },
      { one: 0, two: 0 },
    ]);
    // The account invites stay, so the login link still works for them.
    expect(h.raw.prepare("select email from account_invites order by email").all()).toEqual([
      { email: "cili@x.hu" },
      { email: "dani@x.hu" },
      { email: "odon@x.hu" },
      { email: "zsofi@x.hu" },
    ]);
    expect((await O.pendingRegistrationInvites()).map((r) => r.email).sort()).toEqual([
      "cili@x.hu",
      "dani@x.hu",
      "odon@x.hu",
      "zsofi@x.hu",
    ]);
    expect(await O.queueRegistrationInvites()).toBe(4);
  });

  it("Elvetés stops at what the Admin saw: an invite held later keeps its mark", async () => {
    h.raw.prepare("insert into leagues (city, slug, name) values ('gyor', 'gyor', 'Padelpárbaj Győr')").run();
    pairSignup("Zsófi", "zsofi@x.hu", "Ödön", "odon@x.hu");
    await O.queueRegistrationInvites();
    const [held] = await O.listHeld();
    pairSignup("Cili", "cili@x.hu", "Dani", "dani@x.hu");
    await O.queueRegistrationInvites();
    expect(await O.discardHeld("registration_invite", held.upTo)).toBe(2);
    expect(marks()).toEqual([
      { one: 0, two: 0 },
      { one: 1, two: 1 },
    ]);
  });

  it("Elvetés on another kind leaves the invite marks alone", async () => {
    h.raw.prepare("insert into leagues (city, slug, name) values ('gyor', 'gyor', 'Padelpárbaj Győr')").run();
    pairSignup("Zsófi", "zsofi@x.hu", "Ödön", "odon@x.hu");
    await O.queueRegistrationInvites();
    insert("broadcast", 1, "held", "zsofi@x.hu");
    await O.discardHeld("broadcast", 1000);
    expect(marks()).toEqual([{ one: 1, two: 1 }]);
    expect(count("kind = 'registration_invite' and status = 'held'")).toBe(2);
  });
});
