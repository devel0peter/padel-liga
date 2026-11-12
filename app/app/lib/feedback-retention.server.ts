// The cron's daily feedback deletion (#249, spec 17 and 19): a message is
// deleted once it is a year old. Once a Budapest day, in one query (a batch:
// the delete and the day's mark in job_runs), and not even that when this
// isolate already saw the day done. A rerun on the same day deletes nothing,
// because the delete waits for the mark to be older than the day. Logs no
// message text or sender, only the count (the cron logs the step's result).
import { and, lte, sql } from "drizzle-orm";

import { budapestDay, budapestTime } from "@padel-liga/rules";
import { db } from "~/db/client.server";
import { feedback, jobRuns } from "~/db/schema";

import { feedbackRetentionCutoff } from "./feedback";
import type { RunBudget } from "./run-usage";

export const RETENTION_KEY = "feedback-retention";
export const RETENTION_QUERIES = 1;

// The Budapest day this isolate saw the step done.
let doneDay: string | null = null;

/** Tests only: forget the isolate's done day. */
export function forgetRetentionDay(): void {
  doneDay = null;
}

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

// What the step did, for the cron's log: null when there was nothing to do.
export async function deleteOldFeedback(now: Date, run: RunBudget): Promise<string | null> {
  const day = budapestDay(now);
  if (doneDay === day) return null;
  if (!run.fits({ queries: RETENTION_QUERIES })) return "feedback retention: no room in this run; left for the next one";
  const dayStart = unix(budapestTime(day, 0, 0));
  const ranToday = sql`exists (select 1 from ${jobRuns} where ${jobRuns.key} = ${RETENTION_KEY} and ${jobRuns.doneAt} >= ${dayStart})`;
  const [deleted] = await db.batch([
    db
      .delete(feedback)
      .where(and(lte(feedback.createdAt, feedbackRetentionCutoff(now)), sql`not ${ranToday}`))
      .returning({ id: feedback.id }),
    db
      .insert(jobRuns)
      .values({ key: RETENTION_KEY, doneAt: now })
      .onConflictDoUpdate({ target: jobRuns.key, set: { doneAt: sql`excluded.done_at` } }),
  ]);
  doneDay = day;
  return deleted.length ? `deleted ${deleted.length} feedback messages older than a year` : null;
}
