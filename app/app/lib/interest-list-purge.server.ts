import { eq, inArray, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { rowSelect } from "~/db/insert-select";
import { auditLog, emailMessages, interestSignups, jobRuns, stuckReminderPeople, stuckReminders } from "~/db/schema";
import { auditWhen } from "~/lib/audit.server";
import type { MessageKind } from "~/lib/email/budget";
import { logInfo } from "~/lib/log";
import type { RunBudget, Usage } from "~/lib/run-usage";

// The interest list is deleted once, by the cron, with the release that
// retires it (#334, D123, D132; replaces D88's "end of round 1"). Nothing
// writes the list any more (#332, #333), so what is there at the first run is
// all there ever is. Gone: every signup, registered or not; the stored
// emails the list produced to an address with no account (an account's own
// mail stays, as do the unsubscribe and bounce records); every partner
// notice, whose subject names the signer; and the stuck reminder records
// that hold a list address (situation A's key, and the per-season record of
// an address with no account). One audit entry and one log line give the
// counts, never an address.

export const DONE_KEY = "interest-list-deleted";
// Rows per table per batch: one batch is one D1 query.
export const PURGE_CHUNK = 500;
// The state, the counts (first run only) and one batch.
export const PURGE_MIN: Usage = { queries: 3, calls: 0 };

// The kinds only the list sent to people without an account: the signup
// confirmation, the partner notice, the registration invite, the solo
// pairing's introduction, the broadcasts to the list, and the stuck reminder
// A (and C's copy to the partner a signup named). To an address with an
// account the same kinds are that account's own mail and stay.
export const LIST_MAIL_KINDS = [
  "signup_confirmation",
  "partner_notice",
  "registration_invite",
  "pair_intro",
  "broadcast",
  "stuck_reminder",
] as const satisfies readonly MessageKind[];

const AUDIT_ACTION = "interest_list.delete";

const noAccount = (email: unknown) => sql`not exists (select 1 from users u where lower(u.email) = lower(${email}))`;

const listMail = sql`(${emailMessages.kind} = 'partner_notice'
  or (${inArray(emailMessages.kind, [...LIST_MAIL_KINDS])} and ${noAccount(emailMessages.toEmail)}))`;
const listReminder = eq(stuckReminders.situation, "A");
const listPerson = noAccount(stuckReminderPeople.email);

// Seen done in this isolate: no query at all after that.
let doneSeen = false;

/** Tests only: forget the isolate's done mark. */
export function forgetPurgeDone(): void {
  doneSeen = false;
}

export type PurgeCounts = { signups: number; emails: number; reminders: number };

async function counts(): Promise<PurgeCounts> {
  const [row] = await db
    .select({
      signups: sql<number>`(select count(*) from ${interestSignups})`,
      emails: sql<number>`(select count(*) from ${emailMessages} where ${listMail})`,
      reminders: sql<number>`(select count(*) from ${stuckReminders} where ${listReminder})
        + (select count(*) from ${stuckReminderPeople} where ${listPerson})`,
    })
    .from(sql`(select 1)`);
  return row!;
}

export const countsDetail = (c: PurgeCounts) => `${c.signups} signups, ${c.emails} emails, ${c.reminders} reminder records`;

// One chunk of each, plus (first run) the audit entry, plus the done mark
// once nothing is left (checked inside the batch, after the deletes).
async function deleteChunk(now: Date, audit: PurgeCounts | null) {
  const nothingLeft = sql`not exists (select 1 from ${interestSignups})
    and not exists (select 1 from ${emailMessages} where ${listMail})
    and not exists (select 1 from ${stuckReminders} where ${listReminder})
    and not exists (select 1 from ${stuckReminderPeople} where ${listPerson})`;
  const [mail, signups, reminders, people] = await db.batch([
    db
      .delete(emailMessages)
      .where(inArray(emailMessages.id, db.select({ id: emailMessages.id }).from(emailMessages).where(listMail).limit(PURGE_CHUNK)))
      .returning({ id: emailMessages.id }),
    db
      .delete(interestSignups)
      .where(inArray(interestSignups.id, db.select({ id: interestSignups.id }).from(interestSignups).limit(PURGE_CHUNK)))
      .returning({ id: interestSignups.id }),
    db
      .delete(stuckReminders)
      .where(inArray(stuckReminders.id, db.select({ id: stuckReminders.id }).from(stuckReminders).where(listReminder).limit(PURGE_CHUNK)))
      .returning({ id: stuckReminders.id }),
    db
      .delete(stuckReminderPeople)
      .where(sql`rowid in (select rowid from ${stuckReminderPeople} where ${listPerson} limit ${PURGE_CHUNK})`)
      .returning({ email: stuckReminderPeople.email }),
    // Once only, also if two runs overlap.
    auditWhen(sql`${audit !== null ? sql`1` : sql`0`} and not exists (select 1 from ${auditLog} where ${auditLog.action} = ${AUDIT_ACTION})`, {
      actorId: null,
      action: AUDIT_ACTION,
      target: "Jelentkezési lista",
      detail: audit ? countsDetail(audit) : null,
      at: now,
    }),
    db
      .insert(jobRuns)
      .select(rowSelect(jobRuns, { key: sql`${DONE_KEY}`, doneAt: sql`${Math.floor(now.getTime() / 1000)}` }, sql`where ${nothingLeft}`))
      .onConflictDoNothing(),
  ]);
  const deleted = { signups: signups.length, emails: mail.length, reminders: reminders.length + people.length };
  const full = [mail, signups, reminders, people].some((rows) => rows.length >= PURGE_CHUNK);
  return { deleted, full };
}

/**
 * The cron step (hourly-job.server.ts): deletes the interest list in chunks
 * while the run has room beyond `keep`, and marks it done (job_runs) only when
 * nothing is left. Idempotent: once done, it does nothing. Returns what it
 * did for the run's log, or null when there was nothing to do.
 */
export async function purgeInterestList(now: Date, opts: { run: RunBudget; keep: Usage }): Promise<string | null> {
  if (doneSeen) return null;
  const { run, keep } = opts;
  const room = (cost: Usage) => run.fits({ queries: cost.queries + keep.queries, calls: cost.calls + keep.calls });
  if (!room(PURGE_MIN)) return "interest list deletion: no room in this run; left for the next one";

  const [state] = await db
    .select({
      done: sql<number>`exists (select 1 from ${jobRuns} where ${jobRuns.key} = ${DONE_KEY})`,
      audited: sql<number>`exists (select 1 from ${auditLog} where ${auditLog.action} = ${AUDIT_ACTION})`,
    })
    .from(sql`(select 1)`);
  if (state!.done) {
    doneSeen = true;
    return null;
  }

  // The first run counts what there is: nothing adds to it, so these are
  // the totals, logged once with the audit entry.
  const totals = state!.audited ? null : await counts();
  const deleted: PurgeCounts = { signups: 0, emails: 0, reminders: 0 };
  let full = true;
  let audit = totals;
  while (full && room({ queries: 1, calls: 0 })) {
    const chunk = await deleteChunk(now, audit);
    audit = null;
    full = chunk.full;
    deleted.signups += chunk.deleted.signups;
    deleted.emails += chunk.deleted.emails;
    deleted.reminders += chunk.deleted.reminders;
  }
  // "messages": a key named like "email" is redacted by the logger.
  if (totals) logInfo("interest list deletion", { signups: totals.signups, messages: totals.emails, reminders: totals.reminders, done: !full });
  if (!full) doneSeen = true;
  if (full) return `interest list deletion: deleted ${countsDetail(deleted)}; more left for the next run`;
  // The first run's totals are in the log line above; a later run's last
  // chunk says that it finished.
  return totals ? null : `interest list deletion finished: deleted ${countsDetail(deleted)}`;
}
