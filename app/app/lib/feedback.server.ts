// Feedback in the database (spec 19, D94): storing a message with its
// context under the rate limits (#239). Nothing here sends mail, push or a
// notification, to anyone.
import { eq, isNull, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { rowSelect } from "~/db/insert-select";
import { feedback } from "~/db/schema";

import {
  rateLimits,
  type DeviceClass,
  type FeedbackInput,
} from "./feedback";
import { logInfo, logWarn } from "./log";

export type NewFeedback = FeedbackInput & {
  page: string;
  device: DeviceClass;
  browser: string;
  appVersion: string;
  userId: string | null;
};

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

// Stores one message if its sender is within the rate limits (feedback.ts
// rateLimits: an account's own messages, or all visitors' together). The
// count and the insert are one statement, so two sends at once can't both
// slip past the limit. Returns the new id, or null over the limit.
export async function storeFeedback(input: NewFeedback, now = new Date()): Promise<number | null> {
  const at = unix(now);
  const owner = input.userId === null ? isNull(feedback.userId) : eq(feedback.userId, input.userId);
  const within = rateLimits(input.userId).map(
    (w) => sql`(select count(*) from ${feedback} where ${owner} and ${feedback.createdAt} > ${at - w.seconds}) < ${w.max}`,
  );
  const [row] = await db
    .insert(feedback)
    .select(
      rowSelect(
        feedback,
        {
          id: sql`null`,
          kind: sql`${input.kind}`,
          message: sql`${input.message}`,
          rating: sql`${input.rating}`,
          page: sql`${input.page}`,
          device: sql`${input.device}`,
          browser: sql`${input.browser}`,
          appVersion: sql`${input.appVersion}`,
          userId: sql`${input.userId}`,
          createdAt: sql`${at}`,
          doneAt: sql`null`,
          doneBy: sql`null`,
          reopenedAt: sql`null`,
          reopenedBy: sql`null`,
        },
        sql`where ${sql.join(within, sql` and `)}`,
      ),
    )
    .returning({ id: feedback.id });
  if (!row) {
    logWarn("feedback rate limited", { visitor: input.userId === null });
    return null;
  }
  logInfo("feedback stored", { id: row.id, kind: input.kind, visitor: input.userId === null });
  return row.id;
}
