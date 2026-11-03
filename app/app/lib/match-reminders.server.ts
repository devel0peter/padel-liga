import { and, gt, inArray, isNull } from "drizzle-orm";

import { db } from "~/db/client.server";
import { matchReminders, notifications, users } from "~/db/schema";
import { queueReminderEmails } from "~/lib/email/outbox.server";
import { runningMatches, type RunningMatch } from "~/lib/matches.server";
import { DIGEST_KINDS, type Message } from "~/lib/notifications";
import { notifyPlayers } from "~/lib/notifications.server";

import { venueLine } from "./matches";
import {
  DIGEST_REMINDERS,
  DIGEST_WINDOW_MS,
  digestItems,
  dueReminders,
  isDigestRun,
  isTomorrowRun,
  reminderMessage,
  tomorrowDue,
  tomorrowMessage,
  type DigestItem,
  type DigestReminder,
} from "./match-reminders";

// Match reminders and the daily digest in D1 (#31, spec 13). The hourly cron
// (workers/app.ts) calls runMatchReminders; the rules and texts are in
// match-reminders.ts. Each reminder is claimed in match_reminders before the
// players are told, so it goes once even if two runs overlap; each digest
// item is claimed on notifications.digested_at the same way.

type Kind = DigestReminder | "match_tomorrow";
type Claim = { matchId: number; kind: Kind; slot: number };

// match_reminders binds 4 parameters per row (D1: 100 per statement).
const CLAIM_CHUNK = 20;
const ID_CHUNK = 90;

// Inserts the claims; returns the ones this run got (not sent before).
async function claim(claims: Claim[], now: Date): Promise<Set<string>> {
  const got = new Set<string>();
  for (let i = 0; i < claims.length; i += CLAIM_CHUNK) {
    const rows = await db
      .insert(matchReminders)
      .values(claims.slice(i, i + CLAIM_CHUNK).map((c) => ({ ...c, sentAt: now })))
      .onConflictDoNothing()
      .returning({ matchId: matchReminders.matchId, kind: matchReminders.kind, slot: matchReminders.slot });
    for (const r of rows) got.add(key(r));
  }
  return got;
}

const key = (c: Claim) => `${c.matchId}:${c.kind}:${c.slot}`;
const players = (m: RunningMatch) => [...m.pairs.a, ...m.pairs.b];

/**
 * The digest reminders due today (spec 13), to the four players of each
 * match, in the app and by push; the digest email that follows in the same
 * run collects them. When several are due for one match at once, only the
 * latest goes out; the others are claimed too, so they never follow later.
 * Returns how many reminders (matches × kinds) went out.
 */
export async function queueDigestReminders(now: Date, list?: RunningMatch[]): Promise<number> {
  const running = list ?? (await runningMatches(now));
  const due = running.flatMap((m) => dueReminders(m, now).map((kind) => ({ m, kind })));
  if (due.length === 0) return 0;
  const got = await claim(
    due.map(({ m, kind }) => ({ matchId: m.id, kind, slot: 0 })),
    now,
  );
  // Per match, the latest kind this run claimed, only if no later kind went
  // out before (DIGEST_REMINDERS is latest first).
  const byKind = new Map<DigestReminder, { userId: string; message: Message }[]>();
  let sent = 0;
  for (const m of running) {
    const kinds = dueReminders(m, now);
    const first = kinds[0];
    if (!first || !got.has(key({ matchId: m.id, kind: first, slot: 0 }))) continue;
    const message = reminderMessage(first, { matchId: m.id, week: m.week, deadline: m.deadline });
    const list = byKind.get(first) ?? byKind.set(first, []).get(first)!;
    list.push(...players(m).map((p) => ({ userId: p.id, message })));
    sent++;
  }
  for (const kind of DIGEST_REMINDERS) {
    const messages = byKind.get(kind);
    if (messages) await notifyPlayers(kind, messages, now);
  }
  return sent;
}

/**
 * "Holnap meccs" (spec 13, instant): the evening before an accepted slot,
 * email, push and the app to the four players, once per slot. Returns how
 * many matches.
 */
export async function queueTomorrowReminders(now: Date, list?: RunningMatch[]): Promise<number> {
  const running = (list ?? (await runningMatches(now))).filter((m) => tomorrowDue(m, now));
  if (running.length === 0) return 0;
  const slotOf = (m: RunningMatch) => (m.state.status === "scheduled" ? Math.floor(m.state.slot.getTime() / 1000) : 0);
  const got = await claim(
    running.map((m) => ({ matchId: m.id, kind: "match_tomorrow", slot: slotOf(m) })),
    now,
  );
  const claimed = running.filter((m) => got.has(key({ matchId: m.id, kind: "match_tomorrow", slot: slotOf(m) })));
  const emails: Parameters<typeof queueReminderEmails>[0] = [];
  const pushes: { userId: string; message: Message }[] = [];
  for (const m of claimed) {
    if (m.state.status !== "scheduled") continue;
    const slot = m.state.slot;
    const court = m.state.court ?? null;
    const message = tomorrowMessage({ matchId: m.id, slot, venue: m.venue, court });
    const venue = venueLine(m.venue, court);
    for (const [ours, theirs] of [
      [m.pairs.a, m.pairs.b],
      [m.pairs.b, m.pairs.a],
    ] as const)
      for (const p of ours) {
        emails.push({ kind: "match_tomorrow", toEmail: p.email, input: { to: p.name, opponents: theirs.map((t) => t.name).join(" és "), matchId: m.id, slot, venue } });
        pushes.push({ userId: p.id, message });
      }
  }
  await notifyPlayers("match_tomorrow", pushes, now);
  try {
    await queueReminderEmails(emails);
  } catch (error) {
    // The reminder is claimed and in the app; a failed email must not stop the run.
    console.error("holnap meccs emails failed", error);
  }
  return claimed.length;
}

/**
 * The daily digest (spec 13): takes every digest-kind notification of the
 * last day not taken yet (DIGEST_KINDS, so kinds added later are in it), and
 * sends each player one email with the items they haven't opened in the app.
 * A player with none gets nothing. The email switch and suppressions apply in
 * the outbox. Returns how many emails were queued.
 */
export async function sendDigests(now: Date): Promise<number> {
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
  if (wanted.length === 0) return 0;
  const people = new Map<string, { email: string; name: string }>();
  for (let i = 0; i < wanted.length; i += ID_CHUNK)
    for (const u of await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(
        and(
          inArray(
            users.id,
            wanted.slice(i, i + ID_CHUNK).map((w) => w.userId),
          ),
          // An organizer decision on an old match still notifies a deleted
          // account (#152); it gets no digest.
          isNull(users.deletedAt),
        ),
      ))
      people.set(u.id, { email: u.email, name: u.name || "" });
  const emails = wanted.flatMap((w) => {
    const p = people.get(w.userId);
    return p ? [{ kind: "match_digest" as const, toEmail: p.email, input: { to: p.name || "Játékos", items: w.items } }] : [];
  });
  await queueReminderEmails(emails);
  return emails.length;
}

/**
 * The cron's part (#31): at 07:00 Budapest the day's digest reminders, then
 * the digest; from 18:00 to 21:00 "holnap meccs". Other hours do nothing.
 * A failure is logged and doesn't stop the email delivery after it.
 */
export async function runMatchReminders(now = new Date()): Promise<void> {
  if (!isDigestRun(now) && !isTomorrowRun(now)) return;
  try {
    const running = await runningMatches(now);
    if (isDigestRun(now)) {
      const reminders = await queueDigestReminders(now, running);
      const digests = await sendDigests(now);
      if (reminders || digests) console.log(`cron: ${reminders} match reminders, ${digests} digest emails`);
    }
    if (isTomorrowRun(now)) {
      const tomorrow = await queueTomorrowReminders(now, running);
      if (tomorrow) console.log(`cron: holnap meccs for ${tomorrow} matches`);
    }
  } catch (error) {
    console.error("cron: match reminders failed", error);
  }
}
