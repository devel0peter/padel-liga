import { and, eq, gt, gte, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import { jobRuns, matches, matchReminders, notifications, users } from "~/db/schema";
import { reminderEmailInserts, type ReminderEmail } from "~/lib/email/outbox.server";
import { runningMatches, type RunningMatch } from "~/lib/matches.server";
import { logWarn } from "~/lib/log";
import { DIGEST_KINDS, type Message, type StoredKind } from "~/lib/notifications";
import { queuedNotifications } from "~/lib/notifications.server";
import { RunBudget, type Usage } from "~/lib/run-usage";

import { venueLine } from "./matches";
import {
  DIGEST_REMINDERS,
  DIGEST_WINDOW_MS,
  digestItems,
  dueReminders,
  isMorningRun,
  isTomorrowRun,
  MATCH_REMINDER_EMAILS,
  morningKey,
  reminderMessage,
  tomorrowDue,
  tomorrowMessage,
  type DigestItem,
  type DigestReminder,
} from "./match-reminders";

// Match reminders and the daily digest in D1 (#31, spec 13). The cron
// (lib/hourly-job.server.ts) calls runMatchReminders; the rules and texts are
// in match-reminders.ts.
//
// Within the run limits (#183): each reminder is claimed in match_reminders
// in the same D1 batch that stores its items in the app (push queued, sent
// by the job's push step) and its emails in the outbox (sent by the job's
// delivery step), so a reminder is either fully made or not at all. A run
// works in batches of matches while its budget lasts; what's left is made by
// the next run of the same morning or evening. A run overlapping another
// fails that batch on the claim's key and makes nothing twice.

type Kind = DigestReminder | "match_tomorrow";
type Claim = { matchId: number; kind: Kind; slot: number };
type Items = { kind: StoredKind; messages: { userId: string; message: Message }[] };
type Work = { claims: Claim[]; items: Items[]; emails: ReminderEmail[]; sends: boolean };

// The run's budget and what to keep of it for the job's later steps.
export type Budget = { run: RunBudget; keep: Usage };
const fits = (b: Budget, queries: number) => b.run.fits({ queries: b.keep.queries + queries, calls: b.keep.calls });

// Matches per D1 batch: their claims (4 parameters a row, D1 allows 100 per
// statement), the four players' items and emails each.
const MATCH_CHUNK = 20;
const ID_CHUNK = 90;

const key = (c: Claim) => `${c.matchId}:${c.kind}:${c.slot}`;
const players = (m: RunningMatch) => [...m.pairs.a, ...m.pairs.b];

// The reminders of these kinds already made for matches not past their
// deadline (the only ones running). One query, no list of ids bound.
async function claimedOf(kinds: readonly Kind[], now: Date): Promise<Set<string>> {
  const rows = await db
    .select({ matchId: matchReminders.matchId, kind: matchReminders.kind, slot: matchReminders.slot })
    .from(matchReminders)
    .where(
      and(
        inArray(matchReminders.kind, [...kinds]),
        inArray(matchReminders.matchId, db.select({ id: matches.id }).from(matches).where(gte(matches.deadline, now))),
      ),
    );
  return new Set(rows.map(key));
}

// Commits the work in batches of MATCH_CHUNK matches while the budget lasts.
// Two queries first (opt-outs; the suppressed addresses and email switch
// when there are emails), then one per batch. Returns how many reminders
// went out and how many matches are left for the next run.
async function commit(work: Work[], kinds: readonly StoredKind[], now: Date, budget: Budget): Promise<{ sent: number; left: number }> {
  if (work.length === 0) return { sent: 0, left: 0 };
  const hasEmails = work.some((w) => w.emails.length > 0);
  if (!fits(budget, 1 + (hasEmails ? 2 : 0) + 1)) return { sent: 0, left: work.length };
  const chunks: Work[][] = [];
  for (let i = 0; i < work.length; i += MATCH_CHUNK) chunks.push(work.slice(i, i + MATCH_CHUNK));
  const items = await queuedNotifications(
    kinds,
    chunks.map((c) => c.flatMap((w) => w.items)),
    now,
  );
  const emails = await reminderEmailInserts(chunks.map((c) => c.flatMap((w) => w.emails)));
  let sent = 0;
  let left = 0;
  for (const [i, chunk] of chunks.entries()) {
    if (!fits(budget, 1)) {
      left += chunk.length;
      continue;
    }
    const statements: BatchItem<"sqlite">[] = [];
    const claims = chunk.flatMap((w) => w.claims);
    for (let k = 0; k < claims.length; k += MATCH_CHUNK)
      statements.push(db.insert(matchReminders).values(claims.slice(k, k + MATCH_CHUNK).map((c) => ({ ...c, sentAt: now }))));
    statements.push(...items[i], ...emails[i]);
    const [first, ...rest] = statements;
    try {
      await db.batch([first!, ...rest]);
      sent += chunk.filter((w) => w.sends).length;
    } catch (e) {
      if (!String(e).includes("UNIQUE constraint failed")) throw e;
      logWarn("match reminders deferred", { reason: "another run made some of these; left to the next run" });
      left += chunk.length;
    }
  }
  return { sent, left };
}

/**
 * The digest reminders due today (spec 13), to the four players of each
 * match, in the app and by push (queued); the digest email collects them.
 * When several are due for one match at once, only the latest goes out; the
 * others are claimed too, so they never follow later. Returns how many
 * reminders (matches) went out and how many matches are left for the next
 * run.
 */
export async function queueDigestReminders(now: Date, running: RunningMatch[], budget: Budget): Promise<{ sent: number; left: number }> {
  const due = running.map((m) => ({ m, kinds: dueReminders(m, now) })).filter((d) => d.kinds.length > 0);
  if (due.length === 0) return { sent: 0, left: 0 };
  if (!fits(budget, 1)) return { sent: 0, left: due.length };
  const claimed = await claimedOf(DIGEST_REMINDERS, now);
  const work = due.flatMap(({ m, kinds }): Work[] => {
    const fresh = kinds.filter((kind) => !claimed.has(key({ matchId: m.id, kind, slot: 0 })));
    if (fresh.length === 0) return [];
    // The latest kind due, only if it didn't go out before (DIGEST_REMINDERS
    // is latest first).
    const first = kinds[0];
    const sends = fresh.includes(first);
    const message = reminderMessage(first, { matchId: m.id, week: m.week, deadline: m.deadline });
    return [
      {
        claims: fresh.map((kind) => ({ matchId: m.id, kind, slot: 0 })),
        items: sends ? [{ kind: first, messages: players(m).map((p) => ({ userId: p.id, message })) }] : [],
        emails: [],
        sends,
      },
    ];
  });
  return commit(work, DIGEST_REMINDERS, now, budget);
}

/**
 * "Holnap meccs" (spec 13): the evening before an accepted slot, push and the
 * app to the four players, once per slot, and an email when `email` is on
 * (off for now, MATCH_REMINDER_EMAILS, #191). Returns how many matches got it
 * and how many are left for the next run.
 */
export async function queueTomorrowReminders(
  now: Date,
  running: RunningMatch[],
  budget: Budget,
  email = MATCH_REMINDER_EMAILS.tomorrow,
): Promise<{ sent: number; left: number }> {
  const due = running.filter((m) => tomorrowDue(m, now));
  if (due.length === 0) return { sent: 0, left: 0 };
  if (!fits(budget, 1)) return { sent: 0, left: due.length };
  const claimed = await claimedOf(["match_tomorrow"], now);
  const work = due.flatMap((m): Work[] => {
    if (m.state.status !== "scheduled") return [];
    const slot = m.state.slot;
    const claim: Claim = { matchId: m.id, kind: "match_tomorrow", slot: Math.floor(slot.getTime() / 1000) };
    if (claimed.has(key(claim))) return [];
    const court = m.state.court ?? null;
    const message = tomorrowMessage({ matchId: m.id, slot, venue: m.venue, court });
    const venue = venueLine(m.venue, court);
    const emails: ReminderEmail[] = [];
    if (email)
      for (const [ours, theirs] of [
        [m.pairs.a, m.pairs.b],
        [m.pairs.b, m.pairs.a],
      ] as const)
        for (const p of ours)
          emails.push({ kind: "match_tomorrow", toEmail: p.email, input: { to: p.name, opponents: theirs.map((t) => t.name).join(" és "), matchId: m.id, slot, venue } });
    return [{ claims: [claim], items: [{ kind: "match_tomorrow", messages: players(m).map((p) => ({ userId: p.id, message })) }], emails, sends: true }];
  });
  return commit(work, ["match_tomorrow"], now, budget);
}

// What sendDigests needs: the take, the players, the suppressed addresses and
// email switch, and the batch.
const DIGEST_QUERIES = 5;

/**
 * The daily digest (spec 13): takes every digest-kind notification of the
 * last day not taken yet (DIGEST_KINDS, so kinds added later are in it), and
 * queues each player one email with the items they haven't opened in the
 * app. A player with none gets nothing. The email switch and suppressions
 * apply in the outbox. The emails and the morning's done mark (job_runs)
 * commit together, so the digest goes once a day. Returns how many emails
 * were queued, or null when the run has no room for it.
 */
export async function sendDigests(now: Date, budget: Budget): Promise<number | null> {
  if (!fits(budget, DIGEST_QUERIES)) return null;
  const taken = await db
    .update(notifications)
    .set({ digestedAt: now })
    .where(
      and(
        isNull(notifications.digestedAt),
        inArray(notifications.kind, [...DIGEST_KINDS]),
        gt(notifications.createdAt, new Date(now.getTime() - DIGEST_WINDOW_MS)),
      ),
    )
    .returning({
      id: notifications.id,
      userId: notifications.userId,
      title: notifications.title,
      body: notifications.body,
      url: notifications.url,
      readAt: notifications.readAt,
    });
  const byUser = new Map<string, DigestItem[]>();
  for (const { userId, ...item } of taken) (byUser.get(userId) ?? byUser.set(userId, []).get(userId)!).push(item);
  const wanted = [...byUser].flatMap(([userId, items]) => {
    const list = digestItems(items);
    return list ? [{ userId, items: list }] : [];
  });
  const people = new Map<string, { email: string; name: string }>();
  if (wanted.length > 0)
    for (const u of await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(
        and(
          // The players whose items this run took (no list of ids bound).
          inArray(users.id, db.select({ id: notifications.userId }).from(notifications).where(eq(notifications.digestedAt, now))),
          // An organizer decision on an old match still notifies a deleted
          // account (#152); it gets no digest.
          isNull(users.deletedAt),
        ),
      ))
      people.set(u.id, { email: u.email, name: u.name || "" });
  const emails = wanted.flatMap((w): ReminderEmail[] => {
    const p = people.get(w.userId);
    return p ? [{ kind: "match_digest", toEmail: p.email, input: { to: p.name || "Játékos", items: w.items } }] : [];
  });
  const [inserts] = await reminderEmailInserts([emails]);
  await db.batch([morningDone(now), ...inserts]);
  rememberMorningDone(now);
  return emails.length;
}

const morningDone = (now: Date) => db.insert(jobRuns).values({ key: morningKey(now), doneAt: now }).onConflictDoNothing();

// The morning this isolate last saw done (#279). A run that finds the
// morning's done mark, or writes it, remembers it, so a later run of the same
// morning knows without a query that there is nothing left to make, even
// with no room left. A morning only ever becomes done (job_runs rows are not
// removed), so what is remembered stays true. An isolate that hasn't seen the
// mark yet still has to look, so its first run of a morning with no room left
// still says the reminders are left for the next run.
let doneMorning: string | null = null;
const rememberMorningDone = (now: Date) => {
  doneMorning = morningKey(now);
};
const knownMorningDone = (now: Date) => doneMorning === morningKey(now);
/** Forgets the remembered morning; for tests that start a new database. */
export function forgetMorningDone(): void {
  doneMorning = null;
}

async function morningFinished(now: Date): Promise<boolean> {
  if (knownMorningDone(now)) return true;
  const [row] = await db.select({ key: jobRuns.key }).from(jobRuns).where(eq(jobRuns.key, morningKey(now)));
  if (row) rememberMorningDone(now);
  return !!row;
}

// What a run needs to read the running matches (the matches, their groups'
// players, their logs and venues; more for a large league, so it is only a
// floor: the steps after it check again).
const RUNNING_QUERIES = 5;

/**
 * The cron's part (#31): from 07:00 Budapest the day's digest reminders, then
 * the digest, once a day (in the first run that finishes them, until noon);
 * from 18:00 to 21:00 "holnap meccs". Other runs do nothing. `emails` says
 * which of the two emails go out (MATCH_REMINDER_EMAILS: none for now,
 * #191); the items and pushes go out either way. A digest left off takes
 * nothing, so switched back on it starts from the last day's items.
 * Returns the log line, also when the run left work for the next one (#183).
 */
export async function runMatchReminders(
  now = new Date(),
  budget: Budget = { run: new RunBudget(), keep: { queries: 0, calls: 0 } },
  emails = MATCH_REMINDER_EMAILS,
): Promise<string | null> {
  const tomorrow = isTomorrowRun(now);
  if (!isMorningRun(now) && !tomorrow) return null;
  // A morning already done has nothing to leave for the next run (#279).
  if (!tomorrow && knownMorningDone(now)) return null;
  // Every run that has no room says so (#222), the morning's first check
  // included.
  const noRoom = "match reminders: no room in this run; left for the next one";
  if (!fits(budget, 1)) return noRoom;
  const morning = isMorningRun(now) && !(await morningFinished(now));
  if (!morning && !tomorrow) return null;
  const done: string[] = [];
  const left: string[] = [];
  if (!fits(budget, RUNNING_QUERIES)) return noRoom;
  const running = await runningMatches(now);
  if (morning) {
    const reminders = await queueDigestReminders(now, running, budget);
    if (reminders.sent) done.push(`${reminders.sent} match reminders`);
    if (reminders.left) left.push(`${reminders.left} matches' reminders`);
    else if (emails.digest) {
      const digests = await sendDigests(now, budget);
      if (digests === null) left.push("the digest");
      else done.push(`${digests} digest emails`);
    } else if (fits(budget, 1)) {
      await morningDone(now);
      rememberMorningDone(now);
    }
    else left.push("the morning's done mark");
  }
  if (tomorrow) {
    const t = await queueTomorrowReminders(now, running, budget, emails.tomorrow);
    if (t.sent) done.push(`holnap meccs for ${t.sent} matches`);
    if (t.left) left.push(`holnap meccs for ${t.left} matches`);
  }
  const parts = [done.join(", "), left.length ? `left for the next run (run limits): ${left.join(", ")}` : ""].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}
