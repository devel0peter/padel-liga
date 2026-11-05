import { env } from "cloudflare:workers";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import { interestSignups, leagueAdmins, leagues, notificationOptOuts, notifications, pushSubscriptions, users } from "~/db/schema";

import { listCities } from "./cities.server";
import { cityName, OTHER_CITY } from "./cities";
import type { InterestSignup } from "./interest";
import {
  channelEnabled,
  channelKey,
  disputeRecipients,
  isEnabled,
  resultDisputedMessage,
  substituteRequestedMessage,
  newSignupMessage,
  noShowReportedMessage,
  pushPayload,
  signupRecipients,
  TEST_MESSAGE,
  type Channel,
  type Message,
  type NotificationKind,
  type PlayerKind,
  type StoredKind,
  type SubscriptionInput,
} from "./notifications";
import { pushOutcome, pushRequest, type VapidKeys } from "./push/webpush";
import { countCall, type RunBudget, type Usage } from "./run-usage";
import { logError, logInfo, logWarn } from "~/lib/log";

// Notifications are stored first (the /notifications list), then pushed to
// every device the user subscribed. A push failure never fails the caller.

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
  if (list.length > 0) logInfo("push", { sent, failed: list.length - sent, gone: new Set(gone).size });
  return { sent, gone: [...new Set(gone)] };
}

const NONE: ReadonlySet<string> = new Set();

// Stores one message per user, skipping users who switched the kind off, and
// pushes it to those who didn't switch push off (#115). D1 queries: one
// opt-out lookup, one insert per INSERT_CHUNK messages, one subscription
// lookup (per ID_CHUNK users each). With `queuePush` (the cron, #183)
// the pushes wait in the queue for pushQueued() instead of going out here.
async function notify(kind: StoredKind, messages: { userId: string; message: Message }[], createdAt?: Date, queuePush = false): Promise<void> {
  const disabled = await disabledKinds(messages.map((m) => m.userId));
  if (queuePush) {
    const at = createdAt ?? new Date();
    const rows = notificationRows(kind, messages, at, (userId) => disabled.get(userId) ?? NONE);
    const [first, ...rest] = notificationInserts(rows);
    if (first) await db.batch([first, ...rest]);
    return;
  }
  const wanted = messages.filter((m) => isEnabled(disabled.get(m.userId) ?? NONE, kind));
  // Each returned row carries its own message: RETURNING has no set order.
  const stored: ({ id: number; userId: string } & Message)[] = [];
  for (const chunk of chunks(wanted, INSERT_CHUNK))
    stored.push(
      ...(await db
        .insert(notifications)
        .values(chunk.map(({ userId, message }) => ({ userId, kind, ...message, ...(createdAt ? { createdAt } : {}) })))
        .returning({
          id: notifications.id,
          userId: notifications.userId,
          title: notifications.title,
          body: notifications.body,
          url: notifications.url,
        })),
    );
  const pushing = stored.filter((n) => channelEnabled(disabled.get(n.userId) ?? NONE, "push"));
  if (pushing.length === 0) return;
  const vapid = vapidKeys();
  if (!vapid) {
    if (import.meta.env.DEV) console.log(`[push disabled] ${pushing.length} × ${kind}`);
    return;
  }
  const subs = await subscriptionsOf(pushing.map((n) => n.userId));
  await Promise.all(pushing.map((n) => pushToDevices(subs.get(n.userId) ?? [], n.id, n, vapid)));
}

// A player notification (#115): always in the in-app list, pushed unless the
// player switched push off. The email goes through the outbox, which checks
// the email switch. A push failure never fails the caller; neither does a
// failure here, since the decision it reports is already saved.
// `createdAt`: the time of a scheduled job (the reminders, #31), so the daily
// digest reads the same clock; the database time otherwise. `queuePush`: the
// cron, whose pushes go out within its run limits (#183, pushQueued).
export async function notifyPlayers(
  kind: PlayerKind,
  messages: { userId: string; message: Message }[],
  createdAt?: Date,
  queuePush = false,
): Promise<void> {
  try {
    await notify(kind, messages, createdAt, queuePush);
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
// waits for those who didn't switch push off.
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
      pushDueAt: channelEnabled(disabled(userId), "push") ? at : null,
    }));
}

function notificationInserts(rows: NotificationRow[]): BatchItem<"sqlite">[] {
  return chunks(rows, INSERT_CHUNK).map((chunk) => db.insert(notifications).values(chunk));
}

// The opt-outs of the given kinds and of push, in one query: few people
// switch anything off, so no list of users is bound.
async function optOutsOf(kinds: readonly StoredKind[]): Promise<(userId: string) => ReadonlySet<string>> {
  const rows = await db
    .select()
    .from(notificationOptOuts)
    .where(inArray(notificationOptOuts.kind, [...kinds, channelKey("push")]));
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
// (hourly-job.limits.server.test.ts).
export const MAX_PUSH_DEVICES = 10;

// The newest devices first, at most MAX_PUSH_DEVICES.
const newestDevices = (subs: Subscription[]) =>
  [...subs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.endpoint < b.endpoint ? 1 : -1)).slice(0, MAX_PUSH_DEVICES);
// What one round costs at most besides the pushes: the queue, the devices,
// the claim and forgetting gone devices.
const PUSH_ROUND_QUERIES = 4;

/**
 * Pushes the queued items, oldest first, as many as fit the run (`budget`)
 * while keeping `keep` for the steps after it. Each item is taken off the
 * queue (claimed) before its push goes out, so an overlapping run can't push
 * it twice; an item goes only when all its devices fit (its player's newest
 * MAX_PUSH_DEVICES, the others skipped and logged, #222). Returns how many
 * items were pushed and how many still wait.
 */
export async function pushQueued(budget: RunBudget, keep: Usage = { queries: 0, calls: 0 }): Promise<{ pushed: number; left: number }> {
  const vapid = vapidKeys();
  let pushed = 0;
  // One more query at the end: what is left.
  while (budget.fits({ queries: keep.queries + PUSH_ROUND_QUERIES + 1, calls: keep.calls })) {
    const queue = await db
      .select({ id: notifications.id, userId: notifications.userId, title: notifications.title, body: notifications.body, url: notifications.url })
      .from(notifications)
      .where(isNotNull(notifications.pushDueAt))
      .orderBy(asc(notifications.pushDueAt), asc(notifications.id))
      .limit(PUSH_ROUND);
    if (queue.length === 0) break;
    const all = vapid ? await subscriptionsOf(queue.map((n) => n.userId)) : new Map<string, Subscription[]>();
    const subs = new Map([...all].map(([userId, list]) => [userId, newestDevices(list)]));
    let calls = budget.left().calls - keep.calls;
    const taken: typeof queue = [];
    for (const n of queue) {
      const devices = subs.get(n.userId)?.length ?? 0;
      if (devices > calls) break;
      calls -= devices;
      taken.push(n);
    }
    if (taken.length === 0) break;
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
    for (const n of sending) {
      const devices = all.get(n.userId)?.length ?? 0;
      if (devices > MAX_PUSH_DEVICES) logWarn("push devices skipped", { userId: n.userId, notificationId: n.id, devices, pushed: MAX_PUSH_DEVICES });
    }
    if (vapid) {
      const { gone } = await sendPushes(
        sending.flatMap((n) => (subs.get(n.userId) ?? []).map((s) => ({ s, id: n.id, message: n }))),
        vapid,
      );
      if (gone.length > 0) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, gone));
    } else if (import.meta.env.DEV && sending.length > 0) console.log(`[push disabled] ${sending.length} queued pushes`);
    pushed += sending.length;
    if (taken.length < queue.length) break;
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

// A landing page signup was saved: tell the city's Szervezők and the Admins.
export async function notifyNewSignup(signup: InterestSignup): Promise<void> {
  const [organizers, admins, counts, cities] = await Promise.all([
    db
      .select({ userId: leagueAdmins.userId, city: leagues.city, leagueSlug: leagues.slug })
      .from(leagueAdmins)
      .innerJoin(leagues, eq(leagues.id, leagueAdmins.leagueId)),
    db.select({ id: users.id }).from(users).where(eq(users.platformRole, "superadmin")),
    db
      .select({ mode: interestSignups.mode, n: count() })
      .from(interestSignups)
      .where(and(eq(interestSignups.city, signup.city), ne(interestSignups.status, "withdrawn")))
      .groupBy(interestSignups.mode),
    listCities(),
  ]);
  const recipients = signupRecipients(signup.city, organizers, admins.map((a) => a.id));
  const summary = {
    mode: signup.mode,
    level: signup.level,
    cityName: signup.city === OTHER_CITY ? (signup.cityOther ?? "Más város") : cityName(signup.city, cities),
    pairs: counts.find((c) => c.mode === "pair")?.n ?? 0,
    solos: counts.find((c) => c.mode === "solo")?.n ?? 0,
    organize: signup.wantsToOrganize,
  };
  await notify("new_signup", recipients.map((r) => ({ userId: r.userId, message: newSignupMessage(summary, r) })));
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
  return channelEnabled(await disabledKindsFor(userId), "push") ? pushTo(userId, row.id, TEST_MESSAGE) : 0;
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
