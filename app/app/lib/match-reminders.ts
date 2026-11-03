// Match reminders and the daily digest (#31, spec 13): which reminder is due
// for a match, when the hourly cron sends what, and the texts. Pure (no I/O);
// the D1 side is match-reminders.server.ts. Times are Budapest wall-clock
// days and hours, so the daylight-saving change moves nothing (D75).

import { addDays, budapestClock, budapestDay, type SchedulingEventKind, type SchedulingState } from "@padel-liga/rules";

import { formatDeadline } from "./format";
import { withArticle } from "./groups";
import { venueLine } from "./matches";
import type { Message } from "./notifications";

// The digest goes out in the cron run of this Budapest hour, after the
// reminders of the day are made, so their pushes come then too.
export const DIGEST_HOUR = 7;
// "Holnap meccs" goes out in the first run from 18:00 to 21:00 Budapest the
// day before the slot.
export const TOMORROW_FIRST_HOUR = 18;
export const TOMORROW_LAST_HOUR = 21;
// Which of the cron's match emails go out (#191, D81). Both are off before
// round 1: fewer automatic emails. The reminder items, their pushes and
// "holnap meccs" in the app and by push stay. Set one to true to send that
// email again; nothing else changes.
export const MATCH_REMINDER_EMAILS: Readonly<{ digest: boolean; tomorrow: boolean }> = { digest: false, tomorrow: false };
// The digest collects the items of the last day; a margin of an hour, since
// each item is collected once anyway (notifications.digested_at).
export const DIGEST_WINDOW_MS = 25 * 60 * 60 * 1000;

// The Budapest hour of `now`, 0–23.
export function budapestHour(now: Date): number {
  return Math.floor(budapestClock(now).minutes / 60);
}

export const isDigestRun = (now: Date) => budapestHour(now) === DIGEST_HOUR;
export const isTomorrowRun = (now: Date) => {
  const h = budapestHour(now);
  return h >= TOMORROW_FIRST_HOUR && h <= TOMORROW_LAST_HOUR;
};

// The digest reminders (spec 13), latest first: when several are due at once
// (a missed run), only the latest goes out and the others count as sent.
export const DIGEST_REMINDERS = ["match_deadline_soon", "match_week_end", "match_no_proposal"] as const;
export type DigestReminder = (typeof DIGEST_REMINDERS)[number];

// The statuses of a match that still needs playing. Anything else (a result
// waiting, disputed or final, #28/#29) is played or resolved: no reminder.
const UNPLAYED = ["open", "scheduled"];

export type ReminderMatch = {
  week: number;
  // The phase's first Monday, 00:00 Budapest, and its deadline.
  phaseStartsAt: Date;
  deadline: Date;
  status: string;
  state: SchedulingState;
  kinds: readonly SchedulingEventKind[]; // the log so far
};

/**
 * The digest reminders due for a match on the Budapest day of `now`, latest
 * first (spec 13, #31):
 * - match_no_proposal: from Wednesday of its scheduled week (2 days in), if
 *   neither pair has proposed or recorded a time yet;
 * - match_week_end: from the Monday after its scheduled week, if it isn't
 *   scheduled; never for the last week, whose end is the deadline;
 * - match_deadline_soon: from the Thursday before the deadline's Sunday (3
 *   days before), if it isn't scheduled.
 * None after the deadline or for a played or resolved match. Whether one
 * already went out is the caller's (match_reminders).
 */
export function dueReminders(m: ReminderMatch, now: Date): DigestReminder[] {
  if (now.getTime() >= m.deadline.getTime() || !UNPLAYED.includes(m.status)) return [];
  const today = budapestDay(now);
  const weekStart = addDays(budapestDay(m.phaseStartsAt), (m.week - 1) * 7);
  const deadlineDay = budapestDay(m.deadline);
  const scheduled = m.state.status === "scheduled";
  const due: DigestReminder[] = [];
  if (!scheduled && today >= addDays(deadlineDay, -3)) due.push("match_deadline_soon");
  const weekEnd = addDays(weekStart, 7);
  if (!scheduled && weekEnd <= deadlineDay && today >= weekEnd) due.push("match_week_end");
  const proposed = m.kinds.some((k) => k === "proposal" || k === "counter_proposal" || k === "agreed_time");
  if (!scheduled && !proposed && today >= addDays(weekStart, 2)) due.push("match_no_proposal");
  return due;
}

// Whether the "holnap meccs" reminder is due: a scheduled, unplayed match
// whose slot is on the next Budapest day, in an evening run (spec 13).
export function tomorrowDue(m: Pick<ReminderMatch, "status" | "state">, now: Date): boolean {
  if (m.state.status !== "scheduled" || !UNPLAYED.includes(m.status) || !isTomorrowRun(now)) return false;
  return budapestDay(m.state.slot) === addDays(budapestDay(now), 1) && m.state.slot.getTime() > now.getTime();
}

// --- Texts -------------------------------------------------------------------
// In the app, by push and in the digest; no names (a lock screen is not a
// private place). Each links to the match page.

const matchUrl = (matchId: number) => `/matches/${matchId}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function reminderMessage(kind: DigestReminder, input: { matchId: number; week: number; deadline: Date }): Message {
  const url = matchUrl(input.matchId);
  // "Az 1." / "A 2."
  const week = capitalize(withArticle(input.week));
  switch (kind) {
    case "match_no_proposal":
      return {
        title: "Még nincs időpont-ajánlat",
        body: `${week} heti meccsetekre még senki nem ajánlott időpontot. Ajánljatok most, vagy rögzítsétek, ha már megbeszéltétek.`,
        url,
      };
    case "match_week_end":
      return {
        title: "Pótoljátok a kör végéig",
        body: `${week} heti meccsetek még nincs lefixálva. Határidő: ${formatDeadline(input.deadline)}.`,
        url,
      };
    case "match_deadline_soon":
      return {
        title: "3 nap a határidőig",
        body: `${week} heti meccsetek még nincs lefixálva, a határidő ${formatDeadline(input.deadline)}. Ha addig nem játsszátok le, a szabályzat szerint dől el, akár játék nélküli vereséggel.`,
        url,
      };
  }
}

export function tomorrowMessage(input: { matchId: number; slot: Date; venue: string | null; court: string | null }): Message {
  const where = venueLine(input.venue, input.court);
  return {
    title: "Holnap meccs",
    body: `${formatDeadline(input.slot)}${where ? `, ${where}` : ""}. Jó játékot!`,
    url: matchUrl(input.matchId),
  };
}

// One digest per player (spec 13): only the items not opened in the app yet,
// oldest first. Null: nothing to send that day.
export type DigestItem = Message & { id: number; readAt: Date | null };

export function digestItems(items: readonly DigestItem[]): Message[] | null {
  const unread = items
    .filter((i) => i.readAt === null)
    .sort((a, b) => a.id - b.id)
    .map(({ title, body, url }) => ({ title, body, url }));
  return unread.length > 0 ? unread : null;
}
