import { env } from "cloudflare:workers";
import { and, asc, count, eq, gt, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import { accountInvites, broadcasts, emailMessages, emailSuppressions, interestSignups, leagues, users } from "~/db/schema";
import type { InterestSignup } from "~/lib/interest";

import { INTEREST_INVITE_NOTE, inviteRecipients, type Recipient } from "./audience";
import { BULK_KINDS, parseDailyLimit, sendBudget, type MessageKind } from "./budget";
import { MAX_BATCH, sendBatch } from "./resend.server";
import { SITE_URL } from "~/lib/site";
import { CODE_TTL_MS } from "~/lib/auth/rules";
import { listCities } from "~/lib/cities.server";

import {
  broadcastEmail,
  loginCode,
  pairAnswer,
  pairIntro,
  pairInvite,
  partnerNotice,
  registrationInvite,
  signupConfirmation,
  type Email,
  type PairIntroPerson,
} from "./templates";
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

function messageValues(m: NewMessage) {
  return {
    kind: m.kind,
    broadcastId: m.broadcastId ?? null,
    toEmail: m.toEmail,
    subject: m.subject,
    html: m.html,
    text: m.text,
    headers: m.headers ? JSON.stringify(m.headers) : null,
  };
}

async function enqueue(messages: NewMessage[]): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < messages.length; i += INSERT_CHUNK) {
    const rows = await db
      .insert(emailMessages)
      .values(messages.slice(i, i + INSERT_CHUNK).map(messageValues))
      .returning({ id: emailMessages.id });
    ids.push(...rows.map((r) => r.id));
  }
  return ids;
}

export async function suppressedSet(): Promise<Set<string>> {
  const rows = await db.select({ email: emailSuppressions.email }).from(emailSuppressions);
  return new Set(rows.map((r) => r.email));
}

async function isSuppressed(email: string): Promise<boolean> {
  const [row] = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.email, email.toLowerCase()));
  return !!row;
}

export async function suppress(email: string, reason: "unsubscribed" | "bounced" | "complained") {
  await db.insert(emailSuppressions).values({ email: email.toLowerCase(), reason }).onConflictDoNothing();
}

// At most one signup confirmation per address per day, so the signup form
// can't be used to flood someone's inbox.
const CONFIRMATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Signup confirmation, plus the one-time partner notice (spec section 17).
export async function queueSignupEmails(signup: InterestSignup, now = new Date()): Promise<number[]> {
  const cities = await listCities();
  const [confirmed] = await db
    .select({ n: count() })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.kind, "signup_confirmation"),
        eq(emailMessages.toEmail, signup.email1),
        gt(emailMessages.createdAt, new Date(now.getTime() - CONFIRMATION_INTERVAL_MS)),
      ),
    );
  const messages: NewMessage[] =
    confirmed.n === 0
      ? [{ kind: "signup_confirmation", toEmail: signup.email1, ...signupConfirmation(signup, cities) }]
      : [];
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
      messages.push({ kind: "partner_notice", toEmail: partner, ...partnerNotice(signup, cities) });
  }
  return enqueue(messages);
}

// Two solo signups a Szervező paired: each gets the other's name and email.
// An unsubscribed address gets nothing.
export async function queuePairIntros(a: PairIntroPerson, b: PairIntroPerson, city: string): Promise<number[]> {
  const suppressed = await suppressedSet();
  const messages: NewMessage[] = [
    [a, b],
    [b, a],
  ]
    .filter(([to]) => !suppressed.has(to.email.toLowerCase()))
    .map(([to, partner]) => ({ kind: "pair_intro", toEmail: to.email, ...pairIntro(to, partner, city) }));
  return enqueue(messages);
}

// A login code goes out at once, ahead of broadcasts (transactional budget).
// If the provider is down it stays queued like any email, but by the next
// cron run the code has expired; the person just asks for a new one.
export async function queueLoginCode(email: string, code: string): Promise<void> {
  const ids = await enqueue([
    { kind: "login_code", toEmail: email, ...loginCode(code, CODE_TTL_MS / 60_000) },
  ]);
  await deliver(ids);
}

// A partner invite (#21), sent at once. An unsubscribed or bounced address
// gets nothing (as with the partner notice); the invite still shows in the
// app once they log in.
export async function queuePairInvite(
  toEmail: string,
  input: { inviterName: string; league: string; link: string; hasAccount: boolean },
): Promise<void> {
  if (await isSuppressed(toEmail)) return;
  await deliver(await enqueue([{ kind: "pair_invite", toEmail, ...pairInvite(input) }]));
}

// The inviter learns whether the invite was accepted or declined (#21).
export async function queuePairAnswer(
  toEmail: string,
  input: { to: string; inviteeName: string; league: string; accepted: boolean },
): Promise<void> {
  if (await isSuppressed(toEmail)) return;
  await deliver(await enqueue([{ kind: "pair_answer", toEmail, ...pairAnswer(input) }]));
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

// Who would get the registration invite now (#20, audience.ts inviteRecipients).
export async function pendingRegistrationInvites(): Promise<Recipient[]> {
  const [rows, leagueCities, accounts, suppressed] = await Promise.all([
    db
      .select({
        email1: interestSignups.email1,
        name1: interestSignups.name1,
        city: interestSignups.city,
        status: interestSignups.status,
        invitedAt: interestSignups.invitedAt,
      })
      .from(interestSignups)
      .orderBy(asc(interestSignups.id)),
    db.selectDistinct({ city: leagues.city }).from(leagues),
    db.select({ email: users.email }).from(users),
    suppressedSet(),
  ]);
  return inviteRecipients(rows, {
    leagueCities: new Set(leagueCities.map((l) => l.city)),
    accounts: new Set(accounts.map((u) => u.email.toLowerCase())),
    suppressed,
  });
}

// account_invites binds 3 parameters per row, the invited_at update 1 per
// address plus the timestamp (D1: at most 100 per statement).
const INVITE_CHUNK = 30;
const MARK_CHUNK = 90;

// Sets or clears invited_at on every signup row of these addresses. Setting
// only touches rows not invited yet, and returns the addresses it claimed.
async function markInvited(emails: string[], invitedAt: Date | null): Promise<Set<string>> {
  const claimed = new Set<string>();
  for (let i = 0; i < emails.length; i += MARK_CHUNK) {
    const chunk = inArray(sql`lower(${interestSignups.email1})`, emails.slice(i, i + MARK_CHUNK));
    const rows = await db
      .update(interestSignups)
      .set({ invitedAt })
      .where(invitedAt ? and(chunk, isNull(interestSignups.invitedAt)) : chunk)
      .returning({ email1: interestSignups.email1 });
    for (const r of rows) claimed.add(r.email1.toLowerCase());
  }
  return claimed;
}

// Queues the registration invite for everyone pending. The addresses are
// claimed first (invited_at), so a second send running at the same time gets
// none of them and nobody is invited twice. Then, in one D1 batch (a
// transaction): the emails and the account_invites rows (so the link works
// before registration opens). If that fails, the claim is released. Returns
// how many were queued.
export async function queueRegistrationInvites(now = new Date()): Promise<number> {
  const pending = await pendingRegistrationInvites();
  if (pending.length === 0) return 0;
  const claimed = await markInvited(
    pending.map((r) => r.email),
    now,
  );
  const recipients = pending.filter((r) => claimed.has(r.email));
  if (recipients.length === 0) return 0;
  const emails = recipients.map((r) => r.email);
  try {
    const secret = emailSecret();
    const messages = await Promise.all(
      recipients.map(async (r): Promise<NewMessage> => {
        const url = unsubscribeUrl(SITE_URL, await unsubscribeToken(r.email, secret));
        return { kind: "registration_invite", toEmail: r.email, headers: unsubscribeHeaders(url), ...registrationInvite(r, url) };
      }),
    );
    const statements: BatchItem<"sqlite">[] = [];
    for (let i = 0; i < messages.length; i += INSERT_CHUNK)
      statements.push(db.insert(emailMessages).values(messages.slice(i, i + INSERT_CHUNK).map(messageValues)));
    for (let i = 0; i < emails.length; i += INVITE_CHUNK)
      statements.push(
        db
          .insert(accountInvites)
          .values(emails.slice(i, i + INVITE_CHUNK).map((email) => ({ email, note: INTEREST_INVITE_NOTE })))
          .onConflictDoNothing(),
      );
    const [first, ...rest] = statements;
    await db.batch([first, ...rest]);
  } catch (e) {
    await markInvited(emails, null);
    throw e;
  }
  return recipients.length;
}

// A one-off test of a draft, sent only to the admin. Not stored.
export async function sendTestBroadcast(draft: { subject: string; body: string }, to: Recipient) {
  const url = unsubscribeUrl(SITE_URL, await unsubscribeToken(to.email, emailSecret()));
  const email = broadcastEmail(draft, to, url);
  return sendBatch([{ to: to.email, ...email, subject: `[TESZT] ${email.subject}` }]);
}

type Claimed = typeof emailMessages.$inferSelect;

// The send order: login codes, other transactional emails, then bulk mail
// (broadcasts and registration invites). Each group has its own budget
// (budget.ts).
const GROUPS = ["login", "transactional", "broadcast"] as const;
type Group = (typeof GROUPS)[number];
const GROUP_BUDGET_KIND: Record<Group, MessageKind> = {
  login: "login_code",
  transactional: "signup_confirmation",
  broadcast: "broadcast",
};

async function claim(limit: number, group: Group, ids?: number[]): Promise<Claimed[]> {
  if (limit <= 0) return [];
  const pending = db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.status, "pending"),
        group === "transactional"
          ? notInArray(emailMessages.kind, [...BULK_KINDS, "login_code"])
          : group === "broadcast"
            ? inArray(emailMessages.kind, [...BULK_KINDS])
            : eq(emailMessages.kind, GROUP_BUDGET_KIND[group]),
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

// Sends pending emails within the daily budget: login codes first, then
// signup emails, then broadcasts. With `ids`, only those messages (used right after a signup).
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
  for (const group of GROUPS) {
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const budget = sendBudget(limit, sentLast24h + sent, GROUP_BUDGET_KIND[group]);
      const rows = await claim(budget, group, ids);
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
