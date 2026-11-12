import { eq, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { tipDismissals } from "~/db/schema";

import { channelEnabled } from "./notifications";
import { disabledKindsFor, vapidPublicKey } from "./notifications.server";
import { offeredTips, TIPS, type TipDismissal } from "./tips";

// The Kezdőlap's tips (#262, D160): which are offered to the player, and
// their "Most nem", stored per account so it holds on every device.

export async function tipDismissalsOf(userId: string): Promise<Map<string, TipDismissal>> {
  const rows = await db.select().from(tipDismissals).where(eq(tipDismissals.userId, userId));
  return new Map(rows.map((r) => [r.tip, { count: r.count, dismissedAt: r.dismissedAt }]));
}

// The ids of the tips offered to the player now, in order; the browser
// picks the first that applies on the device. Two queries.
export async function offeredTipIds(userId: string, now = new Date()): Promise<string[]> {
  const [disabled, dismissals] = await Promise.all([disabledKindsFor(userId), tipDismissalsOf(userId)]);
  const account = { pushChannelOn: channelEnabled(disabled, "push"), pushConfigured: vapidPublicKey() !== null };
  return offeredTips(TIPS, account, dismissals, now).map((t) => t.id);
}

// "Most nem": the first time for 14 days, the second for good. False for an
// unknown tip.
export async function dismissTip(userId: string, tip: string, now = new Date()): Promise<boolean> {
  if (!TIPS.some((t) => t.id === tip)) return false;
  await db
    .insert(tipDismissals)
    .values({ userId, tip, count: 1, dismissedAt: now })
    .onConflictDoUpdate({
      target: [tipDismissals.userId, tipDismissals.tip],
      set: { count: sql`${tipDismissals.count} + 1`, dismissedAt: now },
    });
  return true;
}
