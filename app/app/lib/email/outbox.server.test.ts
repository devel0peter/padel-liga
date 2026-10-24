// The outbox's pair emails on a real SQLite (~/test/sqlite): what gets queued
// and for whom. Resend is stubbed; nothing leaves the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/resend.server", () => ({
  MAX_BATCH: 100,
  sendBatch: async (emails: any[]) => {
    h.sent.push(...emails);
    return { ok: true, ids: emails.map((_, i) => `id-${i}`) };
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const O = await import("~/lib/email/outbox.server");

const messages = () => h.raw.prepare("select kind, to_email, subject, status from email_messages").all();

describe("queuePairDissolved", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.sent = [];
  });

  it("queues and sends one email to the partner", async () => {
    await O.queuePairDissolved("bela@x.hu", { to: "Béla", dissolverName: "Anna", league: "Padelpárbaj Győr" });
    expect(messages()).toEqual([
      { kind: "pair_dissolved", to_email: "bela@x.hu", subject: "Anna megszüntette a párotokat – Padelpárbaj", status: "sent" },
    ]);
    expect(h.sent.map((m) => m.to)).toEqual(["bela@x.hu"]);
  });

  it.each(["unsubscribed", "bounced", "complained"])("sends nothing to an address that %s", async (reason) => {
    h.raw.prepare("insert into email_suppressions (email, reason) values (?, ?)").run("bela@x.hu", reason);
    await O.queuePairDissolved("Bela@x.hu", { to: "Béla", dissolverName: "Anna", league: "Padelpárbaj Győr" });
    expect(messages()).toEqual([]);
    expect(h.sent).toEqual([]);
  });
});

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

  it("queues and sends one email", async () => {
    await O.queueSeasonEntryDecision("bela@x.hu", input);
    expect(messages()).toEqual([
      { kind: "season_entry_decision", to_email: "bela@x.hu", subject: "Jóváhagyták a nevezéseteket – Padelpárbaj", status: "sent" },
    ]);
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

  it("queues and sends one email per player", async () => {
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

  it("skips a suppressed address and still sends the others", async () => {
    h.raw.prepare("insert into email_suppressions (email, reason) values (?, ?)").run("bela@x.hu", "bounced");
    await O.queueGroupsPublished([
      { toEmail: "anna@x.hu", input: input("Anna") },
      { toEmail: "Bela@x.hu", input: input("Béla") },
    ]);
    expect(messages().map((m: any) => m.to_email)).toEqual(["anna@x.hu"]);
  });

  it("does nothing for an empty list", async () => {
    await O.queueGroupsPublished([]);
    expect(messages()).toEqual([]);
  });
});
