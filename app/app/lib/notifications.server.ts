import { env } from "cloudflare:workers";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import { leagueAdmins, notificationOptOuts, notifications, pushSubscriptions, users } from "~/db/schema";

import {
  channelKey,
  disputeRecipients,
  KIND_TOPIC,
  isEnabled,
  resultDisputedMessage,
  substituteRequestedMessage,
  noShowReportedMessage,
  pushPayload,
  pushWanted,
  TEST_MESSAGE,
  topicKey,
  topicOf,
  type Channel,
  type Message,
  type NotificationKind,
  type PlayerKind,
  type PushTopic,
  type StoredKind,
  type SubscriptionInput,
} from "./notifications";
import { pushOutcome, pushRequest, type VapidKeys } from "./push/webpush";
import { countCall, type RunBudget, type Usage } from "./run-usage";
import { currentInvocation, logError, logInfo, logWarn } from "~/lib/log";

// Notifications are stored (the /notifications list) with their push queued;
// a request pushes the first ones itself, up to INLINE_PUSH_CALLS, and the
// cron pushes the rest (pushQueued, D158). A push failure never fails the
// caller.

const INBOX_SIZE = 50;

function vapidKeys(): VapidKeys | null {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: "mailto:hello@padelparbaj.hu" };
}

// For the browser's pushManager.subscribe(); null: push isn't set up here.
export function vapidPublicKey(): string | null {
  return vapidKeys() ? env.VAPID_PUBLIC_KEY : null;
}

// A fan-out (e.g. the groups published to every player) must stay within a
// Workers Free request's D1 queries, so lookups and inserts go in a few
// multi-row statements, not one per user (#115). D1 allows 100 bound
// parameters per statement; a notification row binds up to 7.
const ID_CHUNK = 90;
const INSERT_CHUNK = 14;

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function disabledKinds(userIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const ids of chunks([...new Set(userIds)], ID_CHUNK)) {
    const rows = await db.select().from(notificationOptOuts).where(inArray(notificationOptOuts.userId, ids));
    for (const r of rows) (out.get(r.userId) ?? out.set(r.userId, new Set()).get(r.userId)!).add(r.kind);
  }
  return out;
}

type Subscription = typeof pushSubscriptions.$inferSelect;

async function subscriptionsOf(userIds: string[]): Promise<Map<string, Subscription[]>> {
  const out = new Map<string, Subscription[]>();
  for (const ids of chunks([...new Set(userIds)], ID_CHUNK)) {
    const rows = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, ids));
    for (const r of rows) (out.get(r.userId) ?? out.set(r.userId, []).get(r.userId)!).push(r);
  }
  return out;
}

// Pushes one stored notification to each of the user's devices.
async function pushTo(userId: string, id: number, message: Message): Promise<number> {
  const vapid = vapidKeys();
  if (!vapid) {
    if (import.meta.env.DEV) console.log(`[push disabled] to ${userId}: ${message.title}`);
    return 0;
  }
  return pushToDevices((await subscriptionsOf([userId])).get(userId) ?? [], id, message, vapid);
}

// Forgets devices the push service no longer knows. Returns how many got it.
async function pushToDevices(subs: Subscription[], id: number, message: Message, vapid: VapidKeys): Promise<number> {
  const { sent, gone } = await sendPushes(
    subs.map((s) => ({ s, id, message })),
    vapid,
  );
  for (const endpoint of gone) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  return sent;
}

// One push per device; each is an outgoing call of the run (#183). Returns
// how many went out and the devices the push service no longer knows.
async function sendPushes(list: { s: Subscription; id: number; message: Message }[], vapid: VapidKeys): Promise<{ sent: number; gone: string[] }> {
  const gone: string[] = [];
  const results = await Promise.all(
    list.map(async ({ s, id, message }) => {
      try {
        countCall();
        const res = await fetch(await pushRequest(s, JSON.stringify(pushPayload(id, message)), vapid));
        const outcome = pushOutcome(res.status);
        if (outcome === "gone") gone.push(s.endpoint);
        if (outcome === "failed") logWarn("push failed", { status: res.status, host: new URL(s.endpoint).host });
        return outcome === "sent";
      } catch (error) {
        logError("push failed", { error });
        return false;
      }
    }),
  );
  const sent = results.filter(Boolean).length;
  const failed = list.length - sent;
  // A push that didn't go out is not retried: the count is logged, as a
  // warning when any failed (#126). Gone devices count as failed here.
  if (list.length > 0) (failed > 0 ? logWarn : logInfo)("push", { sent, failed, gone: new Set(gone).size });
  return { sent, gone: [...new Set(gone)] };
}

const NONE: ReadonlySet<string> = new Set();

// Pushes a request may send itself (#126, D158): the first ones go at once,
// up to this many push calls per request; the rest wait in the queue for the
// cron (pushQueued). A request may make 50 outgoing calls (Workers Free);
// this leaves 30 for its emails, sent after the response (D150, at most
// SEND_CHUNK per call), so a proposal or a result to confirm still pushes at
// once and a group publish pushes its first devices and queues the rest.
export const INLINE_PUSH_CALLS = 20;

// The running request and what it may still push itself: none in a cron run
// (its pushes keep to the run's budget, pushQueued), and none when the
// isolate serves more than one invocation at once (no way to tell whose calls
// are whose): then everything waits for the cron.
function inlinePushRoom(): { invocation: NonNullable<ReturnType<typeof currentInvocation>>; room: number } | null {
  const invocation = currentInvocation();
  if (!invocation || invocation.kind !== "request") return null;
  return { invocation, room: Math.max(0, INLINE_PUSH_CALLS - invocation.pushCalls) };
}

// Stores one message per user, skipping users who switched the kind off, with
// the push queued for those who want it (push and the kind's topic on,
// pushWanted, #115, #349). Then a request pushes what fits its
// INLINE_PUSH_CALLS at once, in the order of the messages; the rest stays in
// the queue (notifications.push_due_at) for the cron (#126, D158). D1
// queries: one opt-out lookup (per ID_CHUNK users) and one batch of inserts;
// pushing at once adds the stored items, their devices, the claim and maybe
// forgetting gone devices.
async function notify(kind: StoredKind, messages: { userId: string; message: Message }[], createdAt?: Date): Promise<void> {
  const disabled = await disabledKinds(messages.map((m) => m.userId));
  const at = createdAt ?? new Date();
  const rows = notificationRows(kind, messages, at, (userId) => disabled.get(userId) ?? NONE);
  const [first, ...rest] = notificationInserts(rows);
  if (!first) return;
  await db.batch([first, ...rest]);
  if (rows.some((r) => r.pushDueAt)) await pushNow(kind, at);
}

// The request's own queued items, pushed while they fit its room. Found by
// kind and time: an item of another request stored in the same second is
// queued too, so pushing it here is no harm, and the claim keeps it once.
// The room is reserved on the request's own record before any await and the
// unused part given back after, on that same record: another invocation
// starting meanwhile (no current one then) or a parallel notice of the same
// request can't make the request push past its budget.
async function pushNow(kind: StoredKind, at: Date): Promise<void> {
  const own = inlinePushRoom();
  const vapid = vapidKeys();
  if (!own || own.room === 0 || !vapid) return;
  const { invocation, room } = own;
  // A failure keeps the whole reservation: how many went out is unknown.
  invocation.pushCalls += room;
  const queue = await db
    .select({ id: notifications.id, userId: notifications.userId, title: notifications.title, body: notifications.body, url: notifications.url })
    .from(notifications)
    .where(and(eq(notifications.kind, kind), eq(notifications.pushDueAt, at)))
    .orderBy(asc(notifications.id))
    .limit(PUSH_ROUND);
  const { calls } = await pushRound(queue, room, vapid, new Set());
  invocation.pushCalls -= room - calls;
}

// A player notification (#115): always in the in-app list, pushed (at once
// within the request's room, else from the queue) unless the player switched
// push or the kind's topic off. The email goes through the outbox,
// which checks the email switch. A failure here never fails the caller,
// since the decision it reports is already saved. `createdAt`: the time of a
// scheduled job (the reminders, #31), so the daily digest reads the same
// clock; now otherwise.
export async function notifyPlayers(kind: PlayerKind, messages: { userId: string; message: Message }[], createdAt?: Date): Promise<void> {
  try {
    await notify(kind, messages, createdAt);
  } catch (error) {
    logError("notification failed", { kind, error });
  }
}

// --- The cron's notifications (#183) -----------------------------------------
// The job stores its items in the app with their push waiting in the queue
// (notifications.push_due_at), in the same D1 batch as its own records of
// what it sent, so both commit or neither does. pushQueued() then pushes as
// many as the run's limits allow, oldest first; the next run goes on.

type NotificationRow = typeof notifications.$inferInsert;

// One row per message, without the users who switched the kind off; the push
// waits for those who want it: push on and the kind's topic on (pushWanted,
// #349). Every push but "Próba" is queued here first, whether a request then
// pushes it at once or the cron does (D158), so this is where the topic
// switches apply, for the requests and the cron alike.
function notificationRows(
  kind: StoredKind,
  messages: { userId: string; message: Message }[],
  at: Date,
  disabled: (userId: string) => ReadonlySet<string>,
): NotificationRow[] {
  return messages
    .filter((m) => isEnabled(disabled(m.userId), kind))
    .map(({ userId, message }) => ({
      userId,
      kind,
      ...message,
      createdAt: at,
      pushDueAt: pushWanted(disabled(userId), kind) ? at : null,
    }));
}

function notificationInserts(rows: NotificationRow[]): BatchItem<"sqlite">[] {
  return chunks(rows, INSERT_CHUNK).map((chunk) => db.insert(notifications).values(chunk));
}

// The opt-outs of the given kinds, of push and of their topics, in one query:
// few people switch anything off, so no list of users is bound.
async function optOutsOf(kinds: readonly StoredKind[]): Promise<(userId: string) => ReadonlySet<string>> {
  const topics = [...new Set(kinds.map(topicOf).filter((t) => t !== null))].map(topicKey);
  const rows = await db
    .select()
    .from(notificationOptOuts)
    .where(inArray(notificationOptOuts.kind, [...kinds, channelKey("push"), ...topics]));
  const out = new Map<string, Set<string>>();
  for (const r of rows) (out.get(r.userId) ?? out.set(r.userId, new Set()).get(r.userId)!).add(r.kind);
  return (userId) => out.get(userId) ?? NONE;
}

/**
 * The insert statements of the cron's items, push queued, for the
 * caller's batch. One query (the opt-outs); `batches` is one list of
 * statements per batch the caller makes, the messages split the same way.
 */
export async function queuedNotifications(
  kinds: readonly StoredKind[],
  batches: { kind: StoredKind; messages: { userId: string; message: Message }[] }[][],
  at: Date,
): Promise<BatchItem<"sqlite">[][]> {
  const disabled = await optOutsOf(kinds);
  return batches.map((parts) => notificationInserts(parts.flatMap((p) => notificationRows(p.kind, p.messages, at, disabled))));
}

// Rows looked at per round of pushQueued (one subscription lookup each).
const PUSH_ROUND = ID_CHUNK;
// The most devices one queued item is pushed to: its player's newest ones
// (#222, D97). An item goes only when all its devices fit the run, so without
// a cap a player with more devices than a run can push to would stop the
// queue for good. Well inside a run's calls with the email step's room kept
// (hourly-job.limits.server.test.ts). The devices past the cap would never
// get a push, so a dead one among them would never be found: the cron
// forgets them when it pushes to that player (#279, D116).
export const MAX_PUSH_DEVICES = 10;

// The newest devices first.
const byNewest = (subs: Subscription[]) =>
  [...subs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.endpoint < b.endpoint ? 1 : -1));
// What one round costs at most besides the pushes: the queue, the devices,
// the claim and forgetting gone devices and devices past the cap (one query).
const PUSH_ROUND_QUERIES = 4;
// Bound values in one D1 statement: the forgetting stays one query, and
// devices past the cap that don't fit wait for the player's next push.
const MAX_FORGET = 100;

type QueueItem = { id: number; userId: string } & Message;

/**
 * Pushes `queue`'s items in order while their devices fit `calls`: each is
 * taken off the queue (claimed) before its push goes out, so an overlapping
 * run or request can't push it twice; an item goes only when all its devices
 * fit (its player's newest MAX_PUSH_DEVICES, #222). The player's other
 * devices are forgotten in the same query as the devices the push service
 * no longer knows, logged once per player in `capped` (#279, D116). Returns
 * how many items it took, how many it pushed and the calls it made.
 */
async function pushRound(
  queue: QueueItem[],
  calls: number,
  vapid: VapidKeys | null,
  capped: Set<string>,
): Promise<{ taken: number; sent: number; calls: number }> {
  if (queue.length === 0) return { taken: 0, sent: 0, calls: 0 };
  const all = vapid ? await subscriptionsOf(queue.map((n) => n.userId)) : new Map<string, Subscription[]>();
  const sorted = new Map([...all].map(([userId, list]) => [userId, byNewest(list)]));
  const subs = new Map([...sorted].map(([userId, list]) => [userId, list.slice(0, MAX_PUSH_DEVICES)]));
  let left = calls;
  const taken: QueueItem[] = [];
  for (const n of queue) {
    const devices = subs.get(n.userId)?.length ?? 0;
    if (devices > left) break;
    left -= devices;
    taken.push(n);
  }
  if (taken.length === 0) return { taken: 0, sent: 0, calls: 0 };
  const claimed = new Set(
    (
      await db
        .update(notifications)
        .set({ pushDueAt: null })
        .where(
          and(
            isNotNull(notifications.pushDueAt),
            inArray(
              notifications.id,
              taken.map((n) => n.id),
            ),
          ),
        )
        .returning({ id: notifications.id })
    ).map((r) => r.id),
  );
  const sending = taken.filter((n) => claimed.has(n.id));
  const pushes = sending.flatMap((n) => (subs.get(n.userId) ?? []).map((s) => ({ s, id: n.id, message: n })));
  if (vapid) {
    const { gone } = await sendPushes(pushes, vapid);
    const forget = [...gone];
    for (const n of sending) {
      const past = (sorted.get(n.userId) ?? []).slice(MAX_PUSH_DEVICES);
      if (past.length === 0 || capped.has(n.userId)) continue;
      const room = Math.max(0, MAX_FORGET - forget.length);
      if (room === 0) break;
      const endpoints = past.slice(0, room).map((s) => s.endpoint);
      forget.push(...endpoints);
      capped.add(n.userId);
      logWarn("push devices forgotten", { userId: n.userId, notificationId: n.id, devices: past.length + MAX_PUSH_DEVICES, kept: MAX_PUSH_DEVICES, forgotten: endpoints.length });
    }
    if (forget.length > 0) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, forget));
  } else if (import.meta.env.DEV && sending.length > 0) console.log(`[push disabled] ${sending.length} queued pushes`);
  return { taken: taken.length, sent: sending.length, calls: vapid ? pushes.length : 0 };
}

/**
 * Pushes the queued items, oldest first, as many as fit the run (`budget`)
 * while keeping `keep` for the steps after it. Each item is taken off the
 * queue (claimed) before its push goes out, so an overlapping run can't push
 * it twice; an item goes only when all its devices fit (its player's newest
 * MAX_PUSH_DEVICES, #222). The player's other devices are forgotten in the
 * same query as the devices the push service no longer knows, and logged
 * once per player per run (#279, D116). Returns how many items were pushed
 * and how many still wait.
 */
export async function pushQueued(budget: RunBudget, keep: Usage = { queries: 0, calls: 0 }): Promise<{ pushed: number; left: number }> {
  const vapid = vapidKeys();
  let pushed = 0;
  // Players whose devices past the cap this run already forgot and logged:
  // one warning per player per run, however many of their items it pushes.
  const capped = new Set<string>();
  // One more query at the end: what is left.
  while (budget.fits({ queries: keep.queries + PUSH_ROUND_QUERIES + 1, calls: keep.calls })) {
    const queue = await db
      .select({ id: notifications.id, userId: notifications.userId, title: notifications.title, body: notifications.body, url: notifications.url })
      .from(notifications)
      .where(isNotNull(notifications.pushDueAt))
      .orderBy(asc(notifications.pushDueAt), asc(notifications.id))
      .limit(PUSH_ROUND);
    if (queue.length === 0) break;
    const { taken, sent } = await pushRound(queue, budget.left().calls - keep.calls, vapid, capped);
    if (taken === 0) break;
    pushed += sent;
    if (taken < queue.length) break;
  }
  const [{ n }] = await db.select({ n: count() }).from(notifications).where(isNotNull(notifications.pushDueAt));
  return { pushed, left: n };
}

// The same, addressed by email (signup-list mail): only the addresses that
// have an account get it.
export async function notifyAccounts(kind: PlayerKind, messages: { email: string; message: Message }[]): Promise<void> {
  try {
    const emails = [...new Set(messages.map((m) => m.email.toLowerCase()))];
    const accounts = new Map<string, string>();
    for (const chunk of chunks(emails, ID_CHUNK))
      for (const u of await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, chunk)))
        accounts.set(u.email.toLowerCase(), u.id);
    await notify(
      kind,
      messages.flatMap((m) => {
        const userId = accounts.get(m.email.toLowerCase());
        return userId ? [{ userId, message: m.message }] : [];
      }),
    );
  } catch (error) {
    logError("notification failed", { kind, error });
  }
}

// A result was disputed (#178): tell the league's Szervezők and the Admins,
// in the app and by push, never by email. Accounts being deleted are skipped,
// and so is the player who disputed (#221).
export async function notifyResultDisputed(input: {
  matchId: number;
  leagueId: number;
  leagueSlug: string;
  leagueName: string;
  week: number;
  disputedBy: string;
}): Promise<void> {
  const message = resultDisputedMessage(input);
  await notify("result_disputed", (await leagueStaff(input.leagueId, input.disputedBy)).map((userId) => ({ userId, message })));
}

// The league's Szervezők and every Admin, once each, accounts being deleted
// and `except` (the player whose step it is) left out.
async function leagueStaff(leagueId: number, except: string): Promise<string[]> {
  const [organizers, admins] = await Promise.all([
    db
      .select({ id: users.id })
      .from(leagueAdmins)
      .innerJoin(users, eq(users.id, leagueAdmins.userId))
      .where(and(eq(leagueAdmins.leagueId, leagueId), isNull(users.deletedAt))),
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.platformRole, "superadmin"), isNull(users.deletedAt))),
  ]);
  return disputeRecipients(organizers.map((o) => o.id), admins.map((a) => a.id), except);
}

// A pair asked for a substitute (#37, D109): tell the league's Szervezők and
// the Admins, in the app and by push, never by email; the asking player left
// out. Never throws: the request is already saved.
export async function notifySubstituteRequested(input: {
  leagueId: number;
  leagueSlug: string;
  leagueName: string;
  week: number;
  requestedBy: string;
}): Promise<void> {
  try {
    const message = substituteRequestedMessage(input);
    await notify("substitute_requested", (await leagueStaff(input.leagueId, input.requestedBy)).map((userId) => ({ userId, message })));
  } catch (error) {
    logError("notification failed", { kind: "substitute_requested", error });
  }
}

// A pair reported a no-show (#33, D108): tell the league's Szervezők and the
// Admins, in the app and by push, never by email; the reporting player left
// out. Never throws: the report is already saved.
export async function notifyNoShowReported(input: {
  matchId: number;
  leagueId: number;
  leagueSlug: string;
  leagueName: string;
  week: number;
  reportedBy: string;
}): Promise<void> {
  try {
    const message = noShowReportedMessage(input);
    await notify("no_show_reported", (await leagueStaff(input.leagueId, input.reportedBy)).map((userId) => ({ userId, message })));
  } catch (error) {
    logError("notification failed", { kind: "no_show_reported", error });
  }
}

// The profile's "Próba" button. Returns how many devices got the push (none
// with push switched off).
export async function sendTestNotification(userId: string): Promise<number> {
  const [row] = await db
    .insert(notifications)
    .values({ userId, kind: "test", ...TEST_MESSAGE })
    .returning({ id: notifications.id });
  return pushWanted(await disabledKindsFor(userId), "test") ? pushTo(userId, row.id, TEST_MESSAGE) : 0;
}

// --- Inbox ------------------------------------------------------------------

export async function listNotifications(userId: string) {
  return db
    .select({
      id: notifications.id,
      title: notifications.title,
      body: notifications.body,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.id))
    .limit(INBOX_SIZE);
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row.n;
}

// Marks it read and returns where it points; null if it isn't this user's.
export async function openNotification(userId: string, id: number): Promise<string | null> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ url: notifications.url });
  return row?.url ?? null;
}

export async function markAllRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

// --- Settings ---------------------------------------------------------------

export async function disabledKindsFor(userId: string): Promise<Set<string>> {
  return (await disabledKinds([userId])).get(userId) ?? new Set();
}

// On: no row. Off: one row.
async function setOptOut(userId: string, kind: string, enabled: boolean): Promise<void> {
  if (enabled)
    await db.delete(notificationOptOuts).where(and(eq(notificationOptOuts.userId, userId), eq(notificationOptOuts.kind, kind)));
  else await db.insert(notificationOptOuts).values({ userId, kind }).onConflictDoNothing();
}

export async function setKindEnabled(userId: string, kind: NotificationKind, enabled: boolean): Promise<void> {
  await setOptOut(userId, kind, enabled);
}

// The email and push switches (#115), stored like the kinds.
export async function setChannelEnabled(userId: string, channel: Channel, enabled: boolean): Promise<void> {
  await setOptOut(userId, channelKey(channel), enabled);
  if (channel === "push" && !enabled) await unqueuePushes(userId);
}

// A player's push topic (#349), stored like the channels.
export async function setTopicEnabled(userId: string, topic: PushTopic, enabled: boolean): Promise<void> {
  await setOptOut(userId, topicKey(topic), enabled);
  if (!enabled)
    await unqueuePushes(
      userId,
      (Object.keys(KIND_TOPIC) as PlayerKind[]).filter((kind) => KIND_TOPIC[kind] === topic),
    );
}

// A switch turned off also takes the user's pushes still waiting in the queue
// (of these kinds; all without) off it: the items stay in the app.
async function unqueuePushes(userId: string, kinds?: readonly StoredKind[]): Promise<void> {
  await db
    .update(notifications)
    .set({ pushDueAt: null })
    .where(
      and(
        eq(notifications.userId, userId),
        isNotNull(notifications.pushDueAt),
        kinds ? inArray(notifications.kind, [...kinds]) : undefined,
      ),
    );
}

// A browser subscribed: store it for this user (a shared device moves over).
export async function saveSubscription(userId: string, s: SubscriptionInput): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ userId, ...s })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: s.p256dh, auth: s.auth } });
}

export async function deleteSubscription(userId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)));
}

export async function subscriptionCount(userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  return row.n;
}
