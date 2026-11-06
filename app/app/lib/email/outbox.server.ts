import { env } from "cloudflare:workers";
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import { auditEntry } from "~/lib/audit.server";
import { runAfterResponse } from "~/lib/background.server";
import {
  broadcasts,
  emailMessages,
  emailSuppressions,
  notificationOptOuts,
  users,
} from "~/db/schema";
import type { InterestSignup } from "~/lib/interest";
import { channelKey, followsEmailSwitch } from "~/lib/notifications";
import type { RunBudget, Usage } from "~/lib/run-usage";

import type { Recipient } from "./audience";
import { BULK_KINDS, effectiveDailyLimit, SEND_NOW_MAX, sendBudget, type MessageKind } from "./budget";
import { hideAddresses } from "./outbox-view";
import { MAX_BATCH, relayConfigured, sendEmails, type SendResult } from "./send.server";
import { SITE_URL } from "~/lib/site";
import { CODE_TTL_MS } from "~/lib/auth/rules";
import { isAnonymizedEmail } from "~/lib/account-deletion";
import { listCities } from "~/lib/cities.server";
import { logError, logInfo, logWarn } from "~/lib/log";

import {
  broadcastEmail,
  dailyDigest,
  groupsPublished,
  loginCode,
  matchAgreedTime,
  matchProposal,
  matchResult,
  matchTomorrow,
  pairCreated,
  seasonEntered,
  signupConfirmation,
  strikeWarning,
  stuckReminder,
  type Email,
  type StuckReminderInput,
} from "./templates";
import { unsubscribeHeaders, unsubscribeToken, unsubscribeUrl } from "./unsubscribe";

// The outbox: every email is first stored in email_messages, then delivered
// by deliver(), right away and again by the cron (workers/app.ts).
// deliver() stays under the daily limit; whatever doesn't fit waits for the
// next run. Nothing waits for an Admin (#112, replaces the held outbox of
// #88); /admin/outbox only shows the log (outboxLog).

const MAX_ATTEMPTS = 5;
// A run that crashed mid-send leaves rows in "sending". After this they are
// marked failed, never sent again: the provider may have taken them before
// the crash, and an email must not go out twice.
const STALE_CLAIM_MS = 10 * 60 * 1000;
export const INTERRUPTED = "interrupted while sending; not retried, so it can't go out twice";
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

// 5,000 with the SMTP relay, else Resend's 100 (EMAIL_DAILY_LIMIT), so login
// codes keep their reserve until the relay is set up (#111, budget.ts).
export function dailyLimit(): number {
  return effectiveDailyLimit(relayConfigured(), env.EMAIL_DAILY_LIMIT);
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

// The addresses of the accounts that switched email notifications off on the
// profile (#115), lowercase. One query without bound addresses: there are
// few such rows, and a long list would pass D1's parameter limit.
export async function emailSwitchedOff(): Promise<Set<string>> {
  const rows = await db
    .select({ email: users.email })
    .from(notificationOptOuts)
    .innerJoin(users, eq(users.id, notificationOptOuts.userId))
    .where(eq(notificationOptOuts.kind, channelKey("email")));
  return new Set(rows.map((r) => r.email.toLowerCase()));
}

// A deleted account's placeholder address (#152) is nobody: whatever list
// it slips into, no email is stored for it.
const toSomeone = (m: { toEmail: string }) => !isAnonymizedEmail(m.toEmail);

// Stores the emails, except notifications to an account that switched email
// off (#115, followsEmailSwitch; the in-app list still has them) and mail to a
// deleted account's placeholder address.
async function enqueue(all: NewMessage[]): Promise<number[]> {
  const queued = all.filter(toSomeone);
  const off = queued.some((m) => followsEmailSwitch(m.kind)) ? await emailSwitchedOff() : new Set<string>();
  const messages = queued.filter((m) => !followsEmailSwitch(m.kind) || !off.has(m.toEmail.toLowerCase()));
  const ids: number[] = [];
  for (let i = 0; i < messages.length; i += INSERT_CHUNK) {
    const rows = await db
      .insert(emailMessages)
      .values(messages.slice(i, i + INSERT_CHUNK).map(messageValues))
      .returning({ id: emailMessages.id });
    ids.push(...rows.map((r) => r.id));
  }
  logQueued(messages);
  return ids;
}

// "email queued" (#227): how many of each kind, never the addresses.
function logQueued(messages: readonly { kind: string }[]): void {
  if (messages.length === 0) return;
  const kinds: Record<string, number> = {};
  for (const m of messages) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
  logInfo("email queued", { count: messages.length, kinds });
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

// Signup confirmation (the landing form, #332). The partner notice went with
// the interest list's flows (#333, D128): no email to a signed-up partner.
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
  return enqueue(messages);
}

// An organizer put two registered players in a pair (#260): one email each,
// sent right away as transactional mail. Unsubscribed or bounced addresses,
// and players who switched email off (#115), get nothing; the pair still
// shows in the app.
export async function queuePairCreated(
  messages: { toEmail: string; input: Parameters<typeof pairCreated>[0] }[],
): Promise<void> {
  const suppressed = await suppressedSet();
  const queued = messages
    .filter((m) => !suppressed.has(m.toEmail.toLowerCase()))
    .map((m): NewMessage => ({ kind: "pair_created", toEmail: m.toEmail, ...pairCreated(m.input) }));
  await deliverNow(await enqueue(queued));
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

// A pair entered a season (#153): each player of the pair gets one. An unsubscribed or bounced address, or a player who switched
// email off (#115), gets nothing; the status still shows in the app.
export async function queueSeasonEntered(
  toEmail: string,
  input: Parameters<typeof seasonEntered>[0],
): Promise<void> {
  if (await isSuppressed(toEmail)) return;
  await deliverNow(await enqueue([{ kind: "season_entry_decision", toEmail, ...seasonEntered(input) }]));
}

// The groups are published (#24, D22): one email per player, sent right away
// as transactional mail (ahead of broadcasts); what doesn't fit the day's
// limit goes with the next cron runs. Unsubscribed or bounced addresses, and
// players who switched email off (#115), get nothing; the groups still show
// in the app.
export async function queueGroupsPublished(
  messages: { toEmail: string; input: Parameters<typeof groupsPublished>[0] }[],
): Promise<void> {
  const suppressed = await suppressedSet();
  const queued = messages
    .filter((m) => !suppressed.has(m.toEmail.toLowerCase()))
    .map((m): NewMessage => ({ kind: "groups_published", toEmail: m.toEmail, ...groupsPublished(m.input) }));
  await deliverNow(await enqueue(queued));
}

// A scheduling step the other pair must answer (#26, spec 13): a proposal or
// an agreed time, sent at once to each of its players. Unsubscribed or
// bounced addresses, and players who switched email off (#115), get nothing;
// the in-app list and push still have it.
export async function queueMatchEmails(
  messages: (
    | { kind: "match_proposal"; toEmail: string; input: Parameters<typeof matchProposal>[0] }
    | { kind: "match_agreed_time"; toEmail: string; input: Parameters<typeof matchAgreedTime>[0] }
    | { kind: "match_result"; toEmail: string; input: Parameters<typeof matchResult>[0] }
  )[],
): Promise<void> {
  const suppressed = await suppressedSet();
  const queued = messages
    .filter((m) => !suppressed.has(m.toEmail.toLowerCase()))
    .map(
      (m): NewMessage => ({
        kind: m.kind,
        toEmail: m.toEmail,
        ...(m.kind === "match_proposal" ? matchProposal(m.input) : m.kind === "match_result" ? matchResult(m.input) : matchAgreedTime(m.input)),
      }),
    );
  await deliverNow(await enqueue(queued));
}

// A player's 2nd strike (#294, spec 13): the warning, one email per strike
// that brought the player to 2. Personal mail; unsubscribed or bounced
// addresses, and players who switched email off (#115), get nothing (the
// in-app notice and push still have it). From a request (a no-show, #33) it
// goes at once; from the cron it waits for the run's delivery step.
export async function queueStrikeWarnings(
  messages: { toEmail: string; input: Parameters<typeof strikeWarning>[0] }[],
  sendNow: boolean,
): Promise<void> {
  if (messages.length === 0) return;
  const suppressed = await suppressedSet();
  const queued = messages
    .filter((m) => !suppressed.has(m.toEmail.toLowerCase()))
    .map((m): NewMessage => ({ kind: "strike_warning", toEmail: m.toEmail, ...strikeWarning(m.input) }));
  const ids = await enqueue(queued);
  if (sendNow) await deliverNow(ids);
}

// The cron's match emails (#31): the daily digest and "holnap meccs", as
// personal (transactional) mail within the daily limit. Unsubscribed or
// bounced addresses, and players who switched email off (#115), get nothing;
// the in-app list and push still have the items.
// The deadline resolution's 2nd-strike warnings (#294) go the same way.
export type ReminderEmail =
  | { kind: "match_digest"; toEmail: string; input: Parameters<typeof dailyDigest>[0] }
  | { kind: "match_tomorrow"; toEmail: string; input: Parameters<typeof matchTomorrow>[0] }
  | { kind: "strike_warning"; toEmail: string; input: Parameters<typeof strikeWarning>[0] };

const reminderEmail = (m: ReminderEmail): Email =>
  m.kind === "match_digest" ? dailyDigest(m.input) : m.kind === "match_tomorrow" ? matchTomorrow(m.input) : strikeWarning(m.input);

// Returned as insert statements for the cron's own D1 batch (#183):
// stored together with the job's records of what it sent, and sent by the
// job's delivery step within the run's limits. Two queries at most (the
// suppressed addresses and the email switch).
// `batches`: one list of emails per D1 batch the caller makes; the statements
// come back split the same way.
export async function reminderEmailInserts(batches: ReminderEmail[][]): Promise<BatchItem<"sqlite">[][]> {
  const messages = batches.flat();
  if (messages.length === 0) return batches.map(() => []);
  const suppressed = await suppressedSet();
  const off = messages.some((m) => followsEmailSwitch(m.kind)) ? await emailSwitchedOff() : new Set<string>();
  const wanted = (m: ReminderEmail) =>
    toSomeone(m) && !suppressed.has(m.toEmail.toLowerCase()) && (!followsEmailSwitch(m.kind) || !off.has(m.toEmail.toLowerCase()));
  return batches.map((list) => {
    const queued = list
      .filter(wanted)
      .map((m): NewMessage => ({ kind: m.kind, toEmail: m.toEmail, ...reminderEmail(m) }));
    const statements: BatchItem<"sqlite">[] = [];
    for (let i = 0; i < queued.length; i += INSERT_CHUNK)
      statements.push(db.insert(emailMessages).values(queued.slice(i, i + INSERT_CHUNK).map(messageValues)));
    return statements;
  });
}

// SEND_NOW_MAX (budget.ts): one deliver() call, a handful of D1 queries and
// one relay connection, well inside a Workers Free invocation; it also keeps
// each statement under D1's 100 bound parameters.
export { SEND_NOW_MAX };

// Sends the first SEND_NOW_MAX of the emails just queued, within the daily
// limit; the cron sends the rest. Personal emails: the request waits for it.
async function deliverNow(ids: number[]): Promise<void> {
  if (ids.length > 0) await deliver(ids.slice(0, SEND_NOW_MAX));
}

// Bulk mail (BULK_KINDS: broadcasts, registration invites, #140): the same
// send, but after the response, so the Admin's click answers at once. The
// claim in deliver() keeps an overlapping cron run from sending any twice.
function deliverAfterResponse(ids: number[]): void {
  if (ids.length > 0) runAfterResponse("bulk send", () => deliverNow(ids));
}

export async function createBroadcast(input: {
  subject: string;
  body: string;
  audience: string;
  recipients: Recipient[];
  createdBy: string;
  // The Admin's account id, for the audit log (#225).
  actorId: string;
}): Promise<number> {
  const recipients = input.recipients.filter((r) => toSomeone({ toEmail: r.email }));
  const [[{ id }]] = await db.batch([
    db
      .insert(broadcasts)
      .values({
        subject: input.subject,
        body: input.body,
        audience: input.audience,
        recipients: recipients.length,
        createdBy: input.createdBy,
      })
      .returning({ id: broadcasts.id }),
    auditEntry({
      actorId: input.actorId,
      action: "broadcast.send",
      target: sql`'broadcast:' || (select max(${broadcasts.id}) from ${broadcasts})`,
      // The count only: the audience label can hold the Admin's search, an email
      // address or a name (review of #272). The target names the subject.
      detail: `${recipients.length} recipients`,
    }),
  ]);

  const secret = emailSecret();
  const messages = await Promise.all(
    recipients.map(async (r): Promise<NewMessage> => {
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
  deliverAfterResponse(await enqueue(messages));
  return id;
}

// The automatic reminders for people stuck before entering (#155,
// reminders.server.ts decides who, and already leaves out accounts with the
// email switch off): bulk mail, after login codes and personal emails, with
// an unsubscribe link. Returned as insert statements, so the caller puts
// them in one D1 batch with its own records: the emails and the records of
// what was sent commit or roll back together.
export async function stuckReminderInserts(
  messages: { toEmail: string; input: StuckReminderInput }[],
): Promise<BatchItem<"sqlite">[]> {
  const secret = emailSecret();
  const queued = await Promise.all(
    messages.filter(toSomeone).map(async (m): Promise<NewMessage> => {
      const url = unsubscribeUrl(SITE_URL, await unsubscribeToken(m.toEmail, secret));
      return { kind: "stuck_reminder", toEmail: m.toEmail, headers: unsubscribeHeaders(url), ...stuckReminder(m.input, url) };
    }),
  );
  const statements: BatchItem<"sqlite">[] = [];
  for (let i = 0; i < queued.length; i += INSERT_CHUNK)
    statements.push(db.insert(emailMessages).values(queued.slice(i, i + INSERT_CHUNK).map(messageValues)));
  return statements;
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
// (retryLater: no attempt counted), failed for good (final: it may have gone
// out, so it is never retried), or one more failed attempt. Stops the run
// when a provider asks to wait or when nothing in the batch went out.
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
    if (result.final)
      return db
        .update(emailMessages)
        .set({ attempts: sql`${emailMessages.attempts} + 1`, status: "failed", lastError: result.error })
        .where(row);
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
  const errors = failed.filter((r) => !r.retryLater);
  const sent = rows.length - failed.length;
  // "email sent" (#227): message ids and kinds, never the addresses; a
  // provider's error text is scrubbed by the logger.
  const outcome = {
    sent,
    failed: errors.length,
    waiting: failed.length - errors.length,
    kinds: [...new Set(rows.map((r) => r.kind))],
    ids: rows.map((r) => r.id),
  };
  if (errors.length) logError("email failed", { ...outcome, error: errors[0].error });
  else if (failed.length) logWarn("email waits for a provider", { ...outcome, error: failed[0].error });
  else logInfo("email sent", outcome);
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
// `at`: the cron run's scheduled time (#188); the time of the call otherwise.
// `run`: the cron run's limits (#183); `left` says how many emails wait when
// the run stopped early because of them.
export async function deliver(ids?: number[], at = new Date(), run?: RunBudget): Promise<{ sent: number; left?: number }> {
  const now = at.getTime();
  const runStart = new Date(now);
  await db
    .update(emailMessages)
    .set({ status: "failed", lastError: INTERRUPTED })
    .where(and(eq(emailMessages.status, "sending"), lt(emailMessages.claimedAt, new Date(now - STALE_CLAIM_MS))));

  const sentBefore = await sentLast24h(now);
  const limit = dailyLimit();
  let sent = 0;
  for (const group of GROUPS) {
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      // The run's limits (#183): what's left waits for the next run.
      if (run && !run.fits(BATCH_COST)) return { sent, left: await pendingCount() };
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

// One batch of deliver(): the claim, the results (one D1 batch) and the
// count of what's left when the run stops; the relay connection, maybe a
// second one, and Resend for what the relay refused.
const BATCH_COST: Usage = { queries: 3, calls: 3 };
// What deliver() needs to send anything in a run.
export const DELIVER_MIN: Usage = { queries: 2 + BATCH_COST.queries, calls: BATCH_COST.calls };

async function pendingCount(): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(emailMessages).where(eq(emailMessages.status, "pending"));
  return n;
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
