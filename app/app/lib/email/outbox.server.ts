import { env } from "cloudflare:workers";
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import { accountInvites, broadcasts, emailMessages, emailSuppressions, interestSignups, leagues, users } from "~/db/schema";
import type { InterestSignup } from "~/lib/interest";

import { INTEREST_INVITE_NOTE, inviteRecipients, type InviteRecipient, type Recipient } from "./audience";
import { BULK_KINDS, parseDailyLimit, sendBudget, type MessageKind } from "./budget";
import { hideAddresses } from "./outbox-view";
import { MAX_BATCH, sendEmails, type SendResult } from "./send.server";
import { SITE_URL } from "~/lib/site";
import { CODE_TTL_MS } from "~/lib/auth/rules";
import { listCities } from "~/lib/cities.server";

import {
  broadcastEmail,
  groupsPublished,
  loginCode,
  pairIntro,
  partnerNotice,
  registrationInvite,
  seasonEntryDecision,
  signupConfirmation,
  type Email,
  type PairIntroPerson,
} from "./templates";
import { unsubscribeHeaders, unsubscribeToken, unsubscribeUrl } from "./unsubscribe";

// The outbox: every email is first stored in email_messages, then delivered
// by deliver(), right away and again by the hourly cron (workers/app.ts).
// deliver() stays under the daily limit; whatever doesn't fit waits for the
// next run. Nothing waits for an Admin (#112, replaces the held outbox of
// #88); /admin/outbox only shows the log (outboxLog).

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
    status: "pending" as const,
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

// A Szervező approved or rejected a season entry (#23): each player of the
// pair gets one. An unsubscribed or bounced address gets nothing; the status
// still shows in the app.
export async function queueSeasonEntryDecision(
  toEmail: string,
  input: Parameters<typeof seasonEntryDecision>[0],
): Promise<void> {
  if (await isSuppressed(toEmail)) return;
  await deliver(await enqueue([{ kind: "season_entry_decision", toEmail, ...seasonEntryDecision(input) }]));
}

// The groups are published (#24, D22): one email per player, sent right away
// as transactional mail (ahead of broadcasts); what doesn't fit the day's
// limit goes with the next cron runs. Unsubscribed or bounced addresses get
// nothing; the groups still show in the app.
export async function queueGroupsPublished(
  messages: { toEmail: string; input: Parameters<typeof groupsPublished>[0] }[],
): Promise<void> {
  const suppressed = await suppressedSet();
  const queued = messages
    .filter((m) => !suppressed.has(m.toEmail.toLowerCase()))
    .map((m): NewMessage => ({ kind: "groups_published", toEmail: m.toEmail, ...groupsPublished(m.input) }));
  await deliverNow(await enqueue(queued));
}

const DELIVER_CHUNK = 50;

// Sends the emails just queued, within the daily limit. deliver() binds every
// id it is given: a few at a time keeps each statement under D1's 100
// parameters.
async function deliverNow(ids: number[]): Promise<void> {
  for (let i = 0; i < ids.length; i += DELIVER_CHUNK) await deliver(ids.slice(i, i + DELIVER_CHUNK));
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
  await deliverNow(await enqueue(messages));
  return id;
}

// Who would get the registration invite now (#20, audience.ts inviteRecipients).
export async function pendingRegistrationInvites(): Promise<InviteRecipient[]> {
  const [rows, leagueCities, accounts, suppressed] = await Promise.all([
    db
      .select({
        id: interestSignups.id,
        mode: interestSignups.mode,
        email1: interestSignups.email1,
        name1: interestSignups.name1,
        email2: interestSignups.email2,
        name2: interestSignups.name2,
        pairedWith: interestSignups.pairedWith,
        city: interestSignups.city,
        status: interestSignups.status,
        createdAt: interestSignups.createdAt,
        invitedAt: interestSignups.invitedAt,
        invited2At: interestSignups.invited2At,
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

// Sets or clears invited_at on every signup row of these addresses (and
// invited2_at where the address is the partner, email2). Setting only touches
// rows not invited yet, and returns the addresses it claimed.
async function markInvited(emails: string[], invitedAt: Date | null): Promise<Set<string>> {
  const claimed = new Set<string>();
  for (let i = 0; i < emails.length; i += MARK_CHUNK) {
    const slice = emails.slice(i, i + MARK_CHUNK);
    const chunk1 = inArray(sql`lower(${interestSignups.email1})`, slice);
    const chunk2 = inArray(sql`lower(${interestSignups.email2})`, slice);
    const [rows1, rows2] = await db.batch([
      db
        .update(interestSignups)
        .set({ invitedAt })
        .where(invitedAt ? and(chunk1, isNull(interestSignups.invitedAt)) : chunk1)
        .returning({ email: interestSignups.email1 }),
      db
        .update(interestSignups)
        .set({ invited2At: invitedAt })
        .where(invitedAt ? and(chunk2, isNull(interestSignups.invited2At)) : chunk2)
        .returning({ email: interestSignups.email2 }),
    ]);
    for (const r of [...rows1, ...rows2]) if (r.email) claimed.add(r.email.toLowerCase());
  }
  return claimed;
}

// Queues the registration invite for everyone pending. The addresses are
// claimed first (invited_at), so a second send running at the same time gets
// none of them and nobody is invited twice. Then, in one D1 batch (a
// transaction): the emails and the account_invites rows (so the link works
// before registration opens). If that fails, the claim is released. Then
// they are sent, within the daily limit (#112). Returns how many were queued.
// `only`: just these (lowercase) addresses, e.g. the partner's address a
// player just added (#96); the same rules apply.
export async function queueRegistrationInvites(now = new Date(), only?: readonly string[]): Promise<number> {
  const pending = (await pendingRegistrationInvites()).filter((r) => !only || only.includes(r.email));
  if (pending.length === 0) return 0;
  const claimed = await markInvited(
    pending.map((r) => r.email),
    now,
  );
  const recipients = pending.filter((r) => claimed.has(r.email));
  if (recipients.length === 0) return 0;
  const emails = recipients.map((r) => r.email);
  let ids: number[];
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
      statements.push(
        db
          .insert(emailMessages)
          .values(messages.slice(i, i + INSERT_CHUNK).map(messageValues))
          .returning({ id: emailMessages.id }),
      );
    const inserts = statements.length;
    for (let i = 0; i < emails.length; i += INVITE_CHUNK)
      statements.push(
        db
          .insert(accountInvites)
          .values(emails.slice(i, i + INVITE_CHUNK).map((email) => ({ email, note: INTEREST_INVITE_NOTE })))
          .onConflictDoNothing(),
      );
    const [first, ...rest] = statements;
    const results = (await db.batch([first, ...rest])) as unknown[];
    ids = (results.slice(0, inserts) as { id: number }[][]).flat().map((r) => r.id);
  } catch (e) {
    await markInvited(emails, null);
    throw e;
  }
  await deliverNow(ids);
  return recipients.length;
}

// A one-off test of a draft, sent only to the admin. Not stored.
export async function sendTestBroadcast(draft: { subject: string; body: string }, to: Recipient) {
  const url = unsubscribeUrl(SITE_URL, await unsubscribeToken(to.email, emailSecret()));
  const email = broadcastEmail(draft, to, url);
  const [result] = await sendEmails([{ to: to.email, ...email, subject: `[TESZT] ${email.subject}` }]);
  return result;
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

// runStart: an email that failed earlier in this run (claimed since then)
// waits for the next run instead of being tried again right away.
async function claim(limit: number, group: Group, runStart: Date, ids?: number[]): Promise<Claimed[]> {
  if (limit <= 0) return [];
  const pending = db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.status, "pending"),
        or(isNull(emailMessages.claimedAt), lt(emailMessages.claimedAt, runStart)),
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

// Marks each email by its own result (#111): sent, back in the queue
// (retryLater: no attempt counted), or one more failed attempt. Stops the
// run when a provider asks to wait or when nothing in the batch went out.
async function sendClaimed(rows: Claimed[]): Promise<{ sent: number; stop: boolean }> {
  const results: SendResult[] = await sendEmails(
    rows.map((r) => ({
      to: r.toEmail,
      subject: r.subject,
      html: r.html ?? "",
      text: r.text ?? "",
      headers: r.headers ? (JSON.parse(r.headers) as Record<string, string>) : undefined,
    })),
  );

  const now = new Date();
  const [first, ...rest] = rows.map((r, i) => {
    const result = results[i] ?? { ok: false, error: "no result", retryLater: false };
    const row = eq(emailMessages.id, r.id);
    if (result.ok)
      return db
        .update(emailMessages)
        .set({ status: "sent", sentAt: now, providerId: result.id || null, html: null, text: null, lastError: null })
        .where(row);
    if (result.retryLater) return db.update(emailMessages).set({ status: "pending", lastError: result.error }).where(row);
    return db
      .update(emailMessages)
      .set({
        attempts: sql`${emailMessages.attempts} + 1`,
        status: sql`case when ${emailMessages.attempts} + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end`,
        lastError: result.error,
      })
      .where(row);
  });
  await db.batch([first, ...rest]);

  const failed = results.filter((r): r is Extract<SendResult, { ok: false }> => !r.ok);
  if (failed.length) console.error(`${failed.length} of ${rows.length} emails failed`, failed[0].error);
  const sent = rows.length - failed.length;
  return { sent, stop: sent === 0 || failed.some((r) => r.retryLater) };
}

// How many emails went out in the last 24 hours: what counts against the
// daily limit.
export async function sentLast24h(now = Date.now()): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(emailMessages)
    .where(gt(emailMessages.sentAt, new Date(now - 24 * 60 * 60 * 1000)));
  return n;
}

// Sends pending emails within the daily budget: login codes first, then
// signup emails, then broadcasts. With `ids`, only those messages (used right after a signup).
export async function deliver(ids?: number[]): Promise<{ sent: number }> {
  const now = Date.now();
  const runStart = new Date(now);
  await db
    .update(emailMessages)
    .set({ status: "pending" })
    .where(and(eq(emailMessages.status, "sending"), lt(emailMessages.claimedAt, new Date(now - STALE_CLAIM_MS))));

  const sentBefore = await sentLast24h(now);
  const limit = dailyLimit();
  let sent = 0;
  for (const group of GROUPS) {
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const budget = sendBudget(limit, sentBefore + sent, GROUP_BUDGET_KIND[group]);
      const rows = await claim(budget, group, runStart, ids);
      if (rows.length === 0) break;
      const result = await sendClaimed(rows);
      sent += result.sent;
      if (result.stop) return { sent };
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

// --- The log (/admin/outbox, #112) ------------------------------------------

export type KindLog = {
  kind: MessageKind;
  // Pending, or being sent right now.
  waiting: number;
  sent: number;
  failed: number;
  // The newest failure, also of an email still being retried, with every
  // address hidden (an SMTP reply may quote the recipient).
  lastError: { reason: string; at: Date | null } | null;
};

// Per kind, oldest kind first: how many emails wait, went out and failed.
// No recipient.
export async function outboxLog(): Promise<KindLog[]> {
  const [counts, errors] = await Promise.all([
    db
      .select({
        kind: emailMessages.kind,
        status: emailMessages.status,
        n: count(),
        first: sql<number>`min(${emailMessages.id})`,
      })
      .from(emailMessages)
      .groupBy(emailMessages.kind, emailMessages.status),
    // With one max() in the select, SQLite takes the bare columns from the
    // row holding that max: each kind's newest error (by attempt time, then id).
    db
      .select({
        kind: emailMessages.kind,
        lastError: emailMessages.lastError,
        claimedAt: emailMessages.claimedAt,
        newest: sql<string>`max(printf('%012d %012d', coalesce(${emailMessages.claimedAt}, 0), ${emailMessages.id}))`,
      })
      .from(emailMessages)
      .where(isNotNull(emailMessages.lastError))
      .groupBy(emailMessages.kind),
  ]);
  const firstId = new Map<MessageKind, number>();
  for (const c of counts) firstId.set(c.kind, Math.min(firstId.get(c.kind) ?? Infinity, c.first));
  return [...firstId.keys()]
    .sort((a, b) => firstId.get(a)! - firstId.get(b)!)
    .map((kind) => {
      const of = (...statuses: string[]) =>
        counts.filter((c) => c.kind === kind && statuses.includes(c.status)).reduce((a, c) => a + c.n, 0);
      const error = errors.find((e) => e.kind === kind);
      return {
        kind,
        waiting: of("pending", "sending"),
        sent: of("sent"),
        failed: of("failed"),
        lastError: error?.lastError ? { reason: hideAddresses(error.lastError), at: error.claimedAt } : null,
      };
    });
}

// The line of a pair intro that carries the partner's address (templates.ts
// pairIntro), lowercase.
const PAIR_INTRO_ADDRESS_LINE = "az e-mail-címe: ";

// A signup was withdrawn (#114): delete the registration invites and pair
// introductions to these addresses that are not sent yet (held or pending,
// so also once nothing is held), and the introductions to other people that
// name one of these addresses (the partner's), matched on the whole address
// line the template writes, never on part of an address (anna@ is not
// hanna@). Registration invites also lose their invited mark, so a later
// invite run can offer the address again if another signup of it is still active. Mail already sent stays.
export async function cancelUnsentSignupMail(emails: string[]): Promise<number> {
  const lowered = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (lowered.length === 0) return 0;
  const unsent = inArray(emailMessages.status, ["held", "pending"]);
  const rows = await db
    .delete(emailMessages)
    .where(
      and(
        unsent,
        or(
          and(
            eq(emailMessages.kind, "registration_invite"),
            inArray(sql`lower(${emailMessages.toEmail})`, lowered),
          ),
          and(
            eq(emailMessages.kind, "pair_intro"),
            or(
              inArray(sql`lower(${emailMessages.toEmail})`, lowered),
              ...lowered.map(
                (e) => sql`instr(lower(${emailMessages.text}), ${PAIR_INTRO_ADDRESS_LINE + e + "\n"}) > 0`,
              ),
            ),
          ),
        ),
      ),
    )
    .returning({ kind: emailMessages.kind, toEmail: emailMessages.toEmail });
  const invited = rows.filter((r) => r.kind === "registration_invite").map((r) => r.toEmail.toLowerCase());
  if (invited.length > 0) await markInvited(invited, null);
  return rows.length;
}

// Deletion request: remove the stored emails sent to these addresses.
export async function deleteMessagesTo(emails: string[]) {
  if (emails.length === 0) return;
  await db.delete(emailMessages).where(inArray(emailMessages.toEmail, emails.map((e) => e.toLowerCase())));
}
