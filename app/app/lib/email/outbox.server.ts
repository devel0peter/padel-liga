import { env } from "cloudflare:workers";
import { and, asc, count, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { broadcasts, emailMessages, emailSuppressions } from "~/db/schema";
import type { InterestSignup } from "~/lib/interest";

import type { Recipient } from "./audience";
import { parseDailyLimit, sendBudget, type MessageKind } from "./budget";
import { MAX_BATCH, sendBatch } from "./resend.server";
import { SITE_URL } from "~/lib/site";

import { broadcastEmail, partnerNotice, signupConfirmation, type Email } from "./templates";
import { unsubscribeHeaders, unsubscribeToken, unsubscribeUrl } from "./unsubscribe";

// The outbox: every email is first stored in email_messages, then delivered
// by deliver(), right away and again by the hourly cron (workers/app.ts).
// deliver() stays under the provider's daily quota; whatever doesn't fit
// waits for the next run.

const MAX_ATTEMPTS = 5;
// A run that crashed mid-send leaves rows in "sending"; retry them after this.
const STALE_CLAIM_MS = 10 * 60 * 1000;
// Keeps one run well inside the Workers subrequest limit.
const MAX_BATCHES_PER_RUN = 5;
// D1 allows 100 bound parameters per statement; a message row binds 7.
const INSERT_CHUNK = 10;

type NewMessage = Email & {
  kind: MessageKind;
  toEmail: string;
  broadcastId?: number;
  headers?: Record<string, string>;
};

export function dailyLimit(): number {
  return parseDailyLimit(env.EMAIL_DAILY_LIMIT);
}

export function emailSecret(): string {
  if (env.EMAIL_SECRET) return env.EMAIL_SECRET;
  if (import.meta.env.DEV) return "dev-secret";
  throw new Error("EMAIL_SECRET is not set");
}

async function enqueue(messages: NewMessage[]): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < messages.length; i += INSERT_CHUNK) {
    const rows = await db
      .insert(emailMessages)
      .values(
        messages.slice(i, i + INSERT_CHUNK).map((m) => ({
          kind: m.kind,
          broadcastId: m.broadcastId ?? null,
          toEmail: m.toEmail,
          subject: m.subject,
          html: m.html,
          text: m.text,
          headers: m.headers ? JSON.stringify(m.headers) : null,
        })),
      )
      .returning({ id: emailMessages.id });
    ids.push(...rows.map((r) => r.id));
  }
  return ids;
}

export async function suppressedSet(): Promise<Set<string>> {
  const rows = await db.select({ email: emailSuppressions.email }).from(emailSuppressions);
  return new Set(rows.map((r) => r.email));
}

export async function suppress(email: string, reason: "unsubscribed" | "bounced" | "complained") {
  await db.insert(emailSuppressions).values({ email: email.toLowerCase(), reason }).onConflictDoNothing();
}

// Signup confirmation, plus the one-time partner notice (spec section 17).
export async function queueSignupEmails(signup: InterestSignup): Promise<number[]> {
  const messages: NewMessage[] = [
    { kind: "signup_confirmation", toEmail: signup.email1, ...signupConfirmation(signup) },
  ];
  if (signup.mode === "pair" && signup.name2 && signup.email2) {
    const partner = signup.email2.toLowerCase();
    const [[notified], [suppressed]] = await Promise.all([
      db
        .select({ n: count() })
        .from(emailMessages)
        .where(and(eq(emailMessages.kind, "partner_notice"), eq(emailMessages.toEmail, partner))),
      db.select({ n: count() }).from(emailSuppressions).where(eq(emailSuppressions.email, partner)),
    ]);
    if (notified.n === 0 && suppressed.n === 0)
      messages.push({ kind: "partner_notice", toEmail: partner, ...partnerNotice(signup) });
  }
  return enqueue(messages);
}

export async function createBroadcast(input: {
  subject: string;
  body: string;
  audience: string;
  recipients: Recipient[];
  createdBy: string;
}): Promise<number> {
  const [{ id }] = await db
    .insert(broadcasts)
    .values({
      subject: input.subject,
      body: input.body,
      audience: input.audience,
      recipients: input.recipients.length,
      createdBy: input.createdBy,
    })
    .returning({ id: broadcasts.id });

  const secret = emailSecret();
  const messages = await Promise.all(
    input.recipients.map(async (r): Promise<NewMessage> => {
      const url = unsubscribeUrl(SITE_URL, await unsubscribeToken(r.email, secret));
      return {
        kind: "broadcast",
        broadcastId: id,
        toEmail: r.email,
        headers: unsubscribeHeaders(url),
        ...broadcastEmail(input, r, url),
      };
    }),
  );
  await enqueue(messages);
  return id;
}

// A one-off test of a draft, sent only to the admin. Not stored.
export async function sendTestBroadcast(draft: { subject: string; body: string }, to: Recipient) {
  const url = unsubscribeUrl(SITE_URL, await unsubscribeToken(to.email, emailSecret()));
  const email = broadcastEmail(draft, to, url);
  return sendBatch([{ to: to.email, ...email, subject: `[TESZT] ${email.subject}` }]);
}

type Claimed = typeof emailMessages.$inferSelect;

async function claim(limit: number, kinds: "transactional" | "broadcast", ids?: number[]): Promise<Claimed[]> {
  if (limit <= 0) return [];
  const pending = db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.status, "pending"),
        kinds === "broadcast" ? eq(emailMessages.kind, "broadcast") : ne(emailMessages.kind, "broadcast"),
        ids ? inArray(emailMessages.id, ids) : undefined,
      ),
    )
    .orderBy(asc(emailMessages.id))
    .limit(Math.min(limit, MAX_BATCH));
  // One UPDATE ... RETURNING, so two concurrent runs can't claim the same row.
  return db
    .update(emailMessages)
    .set({ status: "sending", claimedAt: new Date() })
    .where(and(eq(emailMessages.status, "pending"), inArray(emailMessages.id, pending)))
    .returning();
}

async function sendClaimed(rows: Claimed[]): Promise<"ok" | "stop"> {
  const result = await sendBatch(
    rows.map((r) => ({
      to: r.toEmail,
      subject: r.subject,
      html: r.html ?? "",
      text: r.text ?? "",
      headers: r.headers ? (JSON.parse(r.headers) as Record<string, string>) : undefined,
    })),
  );
  const ids = rows.map((r) => r.id);

  if (result.ok) {
    const now = new Date();
    const [first, ...rest] = rows.map((r, i) =>
      db
        .update(emailMessages)
        .set({ status: "sent", sentAt: now, providerId: result.ids[i] ?? null, html: null, text: null, lastError: null })
        .where(eq(emailMessages.id, r.id)),
    );
    await db.batch([first, ...rest]);
    return "ok";
  }

  console.error("email batch failed", result.error);
  if (result.retryLater) {
    await db.update(emailMessages).set({ status: "pending", lastError: result.error }).where(inArray(emailMessages.id, ids));
    return "stop";
  }
  await db
    .update(emailMessages)
    .set({
      attempts: sql`${emailMessages.attempts} + 1`,
      status: sql`case when ${emailMessages.attempts} + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end`,
      lastError: result.error,
    })
    .where(inArray(emailMessages.id, ids));
  return "stop";
}

// Sends pending emails within the daily budget: signup emails first, then
// broadcasts. With `ids`, only those messages (used right after a signup).
export async function deliver(ids?: number[]): Promise<{ sent: number }> {
  const now = Date.now();
  await db
    .update(emailMessages)
    .set({ status: "pending" })
    .where(and(eq(emailMessages.status, "sending"), lt(emailMessages.claimedAt, new Date(now - STALE_CLAIM_MS))));

  const [{ n: sentLast24h }] = await db
    .select({ n: count() })
    .from(emailMessages)
    .where(gt(emailMessages.sentAt, new Date(now - 24 * 60 * 60 * 1000)));

  const limit = dailyLimit();
  let sent = 0;
  for (const kinds of ["transactional", "broadcast"] as const) {
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const budget = sendBudget(limit, sentLast24h + sent, kinds === "broadcast" ? "broadcast" : "signup_confirmation");
      const rows = await claim(budget, kinds, ids);
      if (rows.length === 0) break;
      if ((await sendClaimed(rows)) === "stop") return { sent };
      sent += rows.length;
    }
  }
  return { sent };
}

export type BroadcastSummary = typeof broadcasts.$inferSelect & {
  sent: number;
  pending: number;
  failed: number;
};

export async function listBroadcasts(): Promise<BroadcastSummary[]> {
  const [list, stats] = await Promise.all([
    db.select().from(broadcasts).orderBy(sql`${broadcasts.id} desc`),
    db
      .select({ broadcastId: emailMessages.broadcastId, status: emailMessages.status, n: count() })
      .from(emailMessages)
      .where(eq(emailMessages.kind, "broadcast"))
      .groupBy(emailMessages.broadcastId, emailMessages.status),
  ]);
  return list.map((b) => {
    const of = (s: string) => stats.filter((x) => x.broadcastId === b.id && x.status === s).reduce((a, x) => a + x.n, 0);
    return { ...b, sent: of("sent"), pending: of("pending") + of("sending"), failed: of("failed") };
  });
}

// Deletion request: remove the stored emails sent to these addresses.
export async function deleteMessagesTo(emails: string[]) {
  if (emails.length === 0) return;
  await db.delete(emailMessages).where(inArray(emailMessages.toEmail, emails.map((e) => e.toLowerCase())));
}
