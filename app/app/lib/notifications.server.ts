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
  isEnabled,
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

async function disabledKinds(userIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (userIds.length === 0) return out;
  const rows = await db.select().from(notificationOptOuts).where(inArray(notificationOptOuts.userId, userIds));
  for (const r of rows) (out.get(r.userId) ?? out.set(r.userId, new Set()).get(r.userId)!).add(r.kind);
  return out;
}

// Pushes one stored notification to each of the user's devices; forgets
// devices the push service no longer knows. Returns how many got it.
async function pushTo(userId: string, id: number, message: Message): Promise<number> {
  const vapid = vapidKeys();
  if (!vapid) {
    if (import.meta.env.DEV) console.log(`[push disabled] to ${userId}: ${message.title}`);
    return 0;
  }
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
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
// pushes it to those who didn't switch push off (#115).
async function notify(kind: StoredKind, messages: { userId: string; message: Message }[]): Promise<void> {
  const disabled = await disabledKinds(messages.map((m) => m.userId));
  const wanted = messages.filter((m) => isEnabled(disabled.get(m.userId) ?? NONE, kind));
  await Promise.all(
    wanted.map(async ({ userId, message }) => {
      const [row] = await db
        .insert(notifications)
        .values({ userId, kind, ...message })
        .returning({ id: notifications.id });
      if (channelEnabled(disabled.get(userId) ?? NONE, "push")) await pushTo(userId, row.id, message);
    }),
  );
}

// A player notification (#115): always in the in-app list, pushed unless the
// player switched push off. The email goes through the outbox, which checks
// the email switch. A push failure never fails the caller; neither does a
// failure here, since the decision it reports is already saved.
export async function notifyPlayers(kind: PlayerKind, messages: { userId: string; message: Message }[]): Promise<void> {
  try {
    await notify(kind, messages);
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
  };
  await notify("new_signup", recipients.map((r) => ({ userId: r.userId, message: newSignupMessage(summary, r) })));
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
