// Delivery through the SMTP relay with Resend as the fallback (#111), on a
// real SQLite (~/test/sqlite). The relay is a scripted server behind a fake
// cloudflare:sockets connect(); Resend is stubbed. Nothing leaves the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Relay = {
  down: boolean;
  refuse: Set<string>;
  // Drops the connection after this recipient's message, before answering.
  dropAfterData?: string;
  received: { to: string; data: string }[];
  connects: number;
};
const h = vi.hoisted(() => ({
  raw: null as any,
  env: {} as Record<string, string>,
  relay: null as unknown as Relay,
  resend: { batches: [] as any[][], fail: null as null | { error: string; retryLater: boolean } },
}));

vi.mock("cloudflare:workers", () => ({ env: h.env }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({ listCities: async () => [{ slug: "gyor", name: "Győr" }] }));
vi.mock("~/lib/email/resend.server", () => ({
  MAX_BATCH: 100,
  resendConfigured: () => !!h.env.RESEND_API_KEY,
  sendBatch: async (emails: any[]) => {
    h.resend.batches.push(emails);
    if (h.resend.fail) return { ok: false, ...h.resend.fail };
    return { ok: true, ids: emails.map((_, i) => `resend-${h.resend.batches.length}-${i}`) };
  },
}));

// A socket that talks SMTP like smtp-relay.gmail.com. STARTTLS hands back a
// fresh socket on the same conversation.
vi.mock("cloudflare:sockets", () => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  function conversation() {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    let inData = false;
    let buf = "";
    let rcpt = "";
    const say = (s: string) => ctrl.enqueue(enc.encode(`${s}\r\n`));
    const onLine = (line: string) => {
      const verb = line.split(/[ :]/)[0];
      if (verb === "EHLO") say("250-smtp-relay.gmail.com\r\n250 AUTH PLAIN LOGIN");
      else if (verb === "STARTTLS") say("220 2.0.0 Ready to start TLS");
      else if (verb === "AUTH") say("235 2.7.0 Accepted");
      else if (verb === "MAIL") say("250 OK");
      else if (verb === "RCPT") {
        rcpt = /<(.*)>/.exec(line)![1];
        say(h.relay.refuse.has(rcpt) ? "550 5.1.1 Invalid recipient" : "250 OK");
      } else if (verb === "DATA") {
        inData = true;
        say("354 Go ahead");
      } else if (verb === "RSET") say("250 OK");
      else if (verb === "QUIT") say("221 closing");
    };
    const socket = () => ({
      readable: new ReadableStream<Uint8Array>({
        start(c) {
          ctrl = c;
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write(chunk) {
          buf += dec.decode(chunk);
          for (;;) {
            if (inData) {
              const end = buf.indexOf("\r\n.\r\n");
              if (end < 0) return;
              h.relay.received.push({ to: rcpt, data: buf.slice(0, end + 2) });
              buf = buf.slice(end + 5);
              inData = false;
              if (h.relay.dropAfterData === rcpt) {
                ctrl.close();
                return;
              }
              say("250 2.0.0 OK");
              continue;
            }
            const end = buf.indexOf("\r\n");
            if (end < 0) return;
            const line = buf.slice(0, end);
            buf = buf.slice(end + 2);
            onLine(line);
          }
        },
      }),
      startTls: () => socket(),
      close: async () => {},
    });
    const first = socket();
    say("220 smtp-relay.gmail.com ESMTP");
    return first;
  }
  return {
    connect: () => {
      h.relay.connects++;
      if (h.relay.down) {
        return {
          readable: new ReadableStream({ start: (c) => c.error(new Error("connection refused")) }),
          writable: new WritableStream(),
          startTls() {
            throw new Error("down");
          },
          close: async () => {},
        };
      }
      return conversation();
    },
  };
});

const { migratedDatabase } = await import("~/test/sqlite");
const O = await import("~/lib/email/outbox.server");

const rows = () =>
  h.raw.prepare("select to_email, status, attempts, provider_id, last_error from email_messages order by id").all();
const insert = (kind: string, to: string, subject = "Szia", headers: string | null = null) =>
  h.raw
    .prepare("insert into email_messages (kind, to_email, subject, html, text, headers, status) values (?, ?, ?, ?, ?, ?, 'pending')")
    .run(kind, to, subject, "<p>Szia!</p>", "Szia!", headers);

// The next cron run: an email that failed is tried again only by a later run
// (claimed_at is in seconds).
const nextRun = () => h.raw.prepare("update email_messages set claimed_at = claimed_at - 60 where claimed_at is not null").run();

function decodeSubject(data: string): string {
  const header = /\r\nSubject: (.*?)\r\n(?! )/s.exec(data)![1];
  const bytes: number[] = [];
  for (const [, b64] of header.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)) for (const c of atob(b64)) bytes.push(c.charCodeAt(0));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

beforeEach(() => {
  h.raw = migratedDatabase();
  for (const k of Object.keys(h.env)) delete h.env[k];
  Object.assign(h.env, { SMTP_USER: "peter@padelparbaj.hu", SMTP_PASSWORD: "app-password", RESEND_API_KEY: "re_test" });
  h.relay = { down: false, refuse: new Set(), received: [], connects: 0 };
  h.resend = { batches: [], fail: null };
});

describe("delivery through the SMTP relay (#111)", () => {
  it("sends through the relay, from hello@ with the display name, the Hungarian subject intact; Resend is not used", async () => {
    insert("pair_answer", "anna@x.hu", "Ődöngő űrlap – Padelpárbaj, győri ősz");
    expect(await O.deliver()).toEqual({ sent: 1 });
    expect(h.resend.batches).toEqual([]);
    const [m] = h.relay.received;
    expect(m.to).toBe("anna@x.hu");
    expect(decodeSubject(m.data)).toBe("Ődöngő űrlap – Padelpárbaj, győri ősz");
    expect(m.data).toMatch(/^From: =\?UTF-8\?B\?[^\r]+ <hello@padelparbaj\.hu>\r\n/);
    expect(m.data).toContain("\r\nReply-To: hello@padelparbaj.hu\r\n");
    const [row] = rows();
    expect(row).toMatchObject({ status: "sent", attempts: 0, last_error: null });
    expect(row.provider_id).toMatch(/@padelparbaj\.hu$/);
  });

  it("keeps the List-Unsubscribe headers of a bulk email", async () => {
    const url = "https://padelparbaj.hu/unsubscribe?t=abc.def";
    insert("broadcast", "anna@x.hu", "Hír", JSON.stringify({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }));
    await O.deliver();
    const { data } = h.relay.received[0];
    expect(data).toContain(`\r\nList-Unsubscribe: <${url}>\r\n`);
    expect(data).toContain("\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n");
  });

  it("with the relay down, sends through Resend and marks the emails sent", async () => {
    h.relay.down = true;
    insert("pair_answer", "anna@x.hu");
    insert("pair_answer", "bela@x.hu");
    expect(await O.deliver()).toEqual({ sent: 2 });
    expect(h.relay.connects).toBe(1);
    expect(h.resend.batches.map((b) => b.map((e: any) => e.to))).toEqual([["anna@x.hu", "bela@x.hu"]]);
    expect(rows().map((r: any) => [r.status, r.provider_id])).toEqual([
      ["sent", "resend-1-0"],
      ["sent", "resend-1-1"],
    ]);
  });

  it("with both failing, the email stays queued and its attempt count grows", async () => {
    h.relay.down = true;
    h.resend.fail = { error: "500 internal_server_error: boom", retryLater: false };
    insert("pair_answer", "anna@x.hu");
    expect(await O.deliver()).toEqual({ sent: 0 });
    let [row] = rows();
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(row.last_error).toMatch(/^relay: connection: .*; resend: 500 internal_server_error: boom$/);
    nextRun();
    await O.deliver();
    [row] = rows();
    expect(row).toMatchObject({ status: "pending", attempts: 2 });
  });

  it("with the relay down and Resend over its quota, the email waits without counting an attempt", async () => {
    h.relay.down = true;
    h.resend.fail = { error: "429 daily_quota_exceeded: x", retryLater: true };
    insert("pair_answer", "anna@x.hu");
    await O.deliver();
    expect(rows()[0]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("in a batch where the relay refuses one address, the others are sent and only that one goes on", async () => {
    h.relay.refuse.add("bad@x.hu");
    insert("pair_answer", "anna@x.hu");
    insert("pair_answer", "bad@x.hu");
    insert("pair_answer", "cili@x.hu");
    h.resend.fail = { error: "422 validation_error: bad", retryLater: false };
    expect(await O.deliver()).toEqual({ sent: 2 });
    // Only the refused one was offered to Resend.
    expect(h.resend.batches.map((b) => b.map((e: any) => e.to))).toEqual([["bad@x.hu"]]);
    expect(rows().map((r: any) => [r.to_email, r.status, r.attempts])).toEqual([
      ["anna@x.hu", "sent", 0],
      ["bad@x.hu", "pending", 1],
      ["cili@x.hu", "sent", 0],
    ]);
    // The next run retries only that one.
    h.relay.received = [];
    nextRun();
    await O.deliver();
    expect(h.relay.received).toEqual([]);
    expect(h.resend.batches.at(-1)!.map((e: any) => e.to)).toEqual(["bad@x.hu"]);
  });

  it("an address refused by the relay goes out through Resend", async () => {
    h.relay.refuse.add("bad@x.hu");
    insert("pair_answer", "bad@x.hu");
    expect(await O.deliver()).toEqual({ sent: 1 });
    expect(rows()[0]).toMatchObject({ status: "sent", provider_id: "resend-1-0" });
  });

  it("without relay credentials (until #116 sets them up), sends through Resend only", async () => {
    delete h.env.SMTP_USER;
    delete h.env.SMTP_PASSWORD;
    insert("pair_answer", "anna@x.hu");
    expect(await O.deliver()).toEqual({ sent: 1 });
    expect(h.relay.connects).toBe(0);
    expect(h.resend.batches).toHaveLength(1);
  });

  it("without a Resend key, a relay refusal counts as a failed attempt", async () => {
    delete h.env.RESEND_API_KEY;
    h.relay.refuse.add("bad@x.hu");
    insert("pair_answer", "bad@x.hu");
    await O.deliver();
    expect(rows()[0]).toMatchObject({ status: "pending", attempts: 1, last_error: "relay: RCPT TO: 550 5.1.1 Invalid recipient" });
  });

  it("an email whose message the relay took without answering is failed for good, never sent again (no Resend)", async () => {
    h.relay.dropAfterData = "bela@x.hu";
    insert("pair_intro", "anna@x.hu");
    insert("pair_intro", "bela@x.hu");
    insert("pair_intro", "cili@x.hu");
    expect(await O.deliver()).toEqual({ sent: 2 });
    // Cili never reached the relay: Resend takes her. Béla's may have gone out.
    expect(h.resend.batches.map((b) => b.map((e: any) => e.to))).toEqual([["cili@x.hu"]]);
    const byTo = Object.fromEntries(rows().map((r: any) => [r.to_email, r]));
    expect(byTo["anna@x.hu"].status).toBe("sent");
    expect(byTo["cili@x.hu"].status).toBe("sent");
    expect(byTo["bela@x.hu"]).toMatchObject({ status: "failed", attempts: 1 });
    expect(byTo["bela@x.hu"].last_error).toMatch(/^relay: no answer after the message, it may have been sent/);
    nextRun();
    h.relay.received = [];
    await O.deliver();
    expect(h.relay.received).toEqual([]);
    expect(h.resend.batches).toHaveLength(1);
  });

  it("the daily limit is 2,000 with the relay, Resend's 100 (EMAIL_DAILY_LIMIT) without it", () => {
    expect(O.dailyLimit()).toBe(2000);
    delete h.env.SMTP_PASSWORD;
    expect(O.dailyLimit()).toBe(100);
    h.env.EMAIL_DAILY_LIMIT = "100";
    expect(O.dailyLimit()).toBe(100);
  });

  it("uses one relay connection per batch", async () => {
    for (let i = 0; i < 5; i++) insert("pair_answer", `p${i}@x.hu`);
    expect(await O.deliver()).toEqual({ sent: 5 });
    expect(h.relay.connects).toBe(1);
    expect(h.relay.received.map((m) => m.to)).toEqual(["p0@x.hu", "p1@x.hu", "p2@x.hu", "p3@x.hu", "p4@x.hu"]);
  });
});
