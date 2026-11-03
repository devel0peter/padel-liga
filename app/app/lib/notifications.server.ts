import { env } from "cloudflare:workers";
import { and, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";

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
  newSignupMessage,
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
// parameters per statement; a notification row binds 5.
const ID_CHUNK = 90;
const INSERT_CHUNK = 15;

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
  const payload = JSON.stringify(pushPayload(id, message));
  const results = await Promise.all(
    subs.map(async (s) => {
      try {
        const res = await fetch(await pushRequest(s, payload, vapid));
        const outcome = pushOutcome(res.status);
        if (outcome === "gone") await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint));
        if (outcome === "failed") console.error(`push failed: ${res.status} ${new URL(s.endpoint).host}`);
        return outcome === "sent";
      } catch (error) {
        console.error("push error", error);
        return false;
      }
    }),
  );
  return results.filter(Boolean).length;
}

const NONE: ReadonlySet<string> = new Set();

// Stores one message per user, skipping users who switched the kind off, and
// pushes it to those who didn't switch push off (#115). D1 queries: one
// opt-out lookup, one insert per INSERT_CHUNK messages, one subscription
// lookup (per ID_CHUNK users each).
async function notify(kind: StoredKind, messages: { userId: string; message: Message }[], createdAt?: Date): Promise<void> {
  const disabled = await disabledKinds(messages.map((m) => m.userId));
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
// digest reads the same clock; the database time otherwise.
export async function notifyPlayers(kind: PlayerKind, messages: { userId: string; message: Message }[], createdAt?: Date): Promise<void> {
  try {
    await notify(kind, messages, createdAt);
  } catch (error) {
    console.error(`${kind} notification failed`, error);
  }
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
    console.error(`${kind} notification failed`, error);
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
// in the app and by push, never by email. Accounts being deleted are skipped.
export async function notifyResultDisputed(input: { matchId: number; leagueId: number; leagueSlug: string; leagueName: string; week: number }): Promise<void> {
  const [organizers, admins] = await Promise.all([
    db
      .select({ id: users.id })
      .from(leagueAdmins)
      .innerJoin(users, eq(users.id, leagueAdmins.userId))
      .where(and(eq(leagueAdmins.leagueId, input.leagueId), isNull(users.deletedAt))),
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.platformRole, "superadmin"), isNull(users.deletedAt))),
  ]);
  const message = resultDisputedMessage(input);
  await notify(
    "result_disputed",
    disputeRecipients(organizers.map((o) => o.id), admins.map((a) => a.id)).map((userId) => ({ userId, message })),
  );
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
