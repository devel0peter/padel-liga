import { env } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";

import { buildMessage, isSafeAddress, smtpData } from "./mime";
import { REPLY_TO, SENDER, SENDER_DOMAIN, type OutgoingEmail } from "./sender";
import { ReplyParser, smtpSend, type SmtpReply, type SmtpResult, type SmtpTransport } from "./smtp";

// Google Workspace's SMTP relay (#111): port 587, STARTTLS, logged in as the
// sending user. Port 25 is the only one Workers can't open.
// https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
export const RELAY_HOST = "smtp-relay.gmail.com";
export const RELAY_PORT = 587;
// One stuck reply mustn't hold the whole run.
const REPLY_TIMEOUT_MS = 30_000;

// Optional Worker secrets, so they are not in wrangler.jsonc's required list
// (a deploy without them would fail). Without them the relay is skipped.
type RelaySecrets = { SMTP_USER?: string; SMTP_PASSWORD?: string };

function credentials(): { user: string; password: string } | null {
  const { SMTP_USER, SMTP_PASSWORD } = env as RelaySecrets;
  return SMTP_USER && SMTP_PASSWORD ? { user: SMTP_USER, password: SMTP_PASSWORD } : null;
}

export function relayConfigured(): boolean {
  return credentials() !== null;
}

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out`)), REPLY_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// A Cloudflare TCP socket as an SmtpTransport.
async function openSocket(): Promise<SmtpTransport> {
  let socket = connect({ hostname: RELAY_HOST, port: RELAY_PORT }, { secureTransport: "starttls", allowHalfOpen: false });
  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  let decoder = new TextDecoder();
  let parser = new ReplyParser();
  let queue: SmtpReply[] = [];
  const encoder = new TextEncoder();

  return {
    async write(data) {
      await withTimeout(writer.write(encoder.encode(data)), "write");
    },
    async reply() {
      while (queue.length === 0) {
        const { value, done } = await withTimeout(reader.read(), "reply");
        if (done) throw new Error("connection closed");
        queue.push(...parser.push(decoder.decode(value, { stream: true })));
      }
      return queue.shift()!;
    },
    async startTls() {
      reader.releaseLock();
      writer.releaseLock();
      socket = socket.startTls();
      reader = socket.readable.getReader();
      writer = socket.writable.getWriter();
      decoder = new TextDecoder();
      parser = new ReplyParser();
      queue = [];
    },
    close() {
      socket.close().catch(() => {});
    },
  };
}

// One result per email, in order (smtp.ts smtpSend). An address we can't
// safely put on an SMTP line fails without being sent.
export async function sendViaRelay(emails: OutgoingEmail[], now = new Date()): Promise<SmtpResult[]> {
  const login = credentials();
  if (!login) return emails.map(() => ({ ok: false, error: "relay: SMTP_USER or SMTP_PASSWORD is not set" }));

  const results: (SmtpResult | null)[] = emails.map((e) =>
    isSafeAddress(e.to) ? null : { ok: false, error: "relay: invalid address" },
  );
  const messages = emails.flatMap((e, i) => {
    if (results[i]) return [];
    const id = `${crypto.randomUUID()}@${SENDER_DOMAIN}`;
    const data = smtpData(buildMessage({ from: SENDER, replyTo: REPLY_TO, ...e, messageId: id, date: now }));
    return [{ index: i, to: e.to, data, id }];
  });
  const sent = await smtpSend(openSocket, { hostname: SENDER_DOMAIN, from: SENDER.address, ...login }, messages);
  messages.forEach((m, k) => {
    const r = sent[k];
    results[m.index] = r.ok ? r : { ...r, error: `relay: ${r.error}` };
  });
  return results as SmtpResult[];
}
