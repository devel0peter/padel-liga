// How the running round stands, for its Szervező and the Admin (#350): totals
// by status, played and fixed counts, per week and per group, a day-by-day
// burn-down and a forecast of whether every match gets played by the
// deadline. Pure (no I/O): fed by match-overview.server.ts with the round's
// matches and their logs, rendered on "Meccsek" and the league's Áttekintés.
//
// Every number is read back from the match's log (match_events, D68) and its
// rulings (match_decisions): a match counts as played from the moment its
// result became final, and as fixed while it has a fixed time or any result.
// A withdrawn pair's matches (D87) never get here: they are only counted, as
// "Nem számít".

import {
  addDays,
  agreedFixAt,
  budapestDay,
  budapestTime,
  resultState,
  schedulingState,
  type Day,
  type ResultEvent,
  type Ruling,
  type SchedulingEvent,
} from "@padel-liga/rules";

import { weekDays } from "./groups";
import { OVERVIEW_STATUSES, type OverviewStatus } from "./match-overview";

// One counting match of the round: its status now, and its log.
export type RoundMatch = {
  groupNumber: number;
  week: number;
  status: OverviewStatus;
  stuck: boolean;
  scheduling: readonly SchedulingEvent[];
  results: readonly ResultEvent[];
  rulings: readonly Ruling[];
};

export type RoundInput = {
  phaseStartsAt: Date;
  // The round's deadline as stored (season_phases.deadline); an extended one
  // (#356) moves the axis, the ideal line and the forecast with it.
  deadline: Date;
  // In the order "Meccsek" shows them.
  groups: readonly number[];
  matches: readonly RoundMatch[];
  // Matches of a pair withdrawn mid-round (D87): shown, never in the totals.
  voided: number;
  now: Date;
};

// The pace is read over at most this many days.
export const PACE_DAYS = 7;
// Before the round's 4th day (fewer than 3 whole days behind it) a forecast
// says nothing yet.
export const EARLY_DAYS = 3;
// A group this far below the ideal line's share for today is behind.
export const GROUP_BEHIND_GAP = 0.25;

export type Verdict = "early" | "on_track" | "behind";

export type RoundDay = {
  day: Day;
  // Counting matches not played / not fixed at the end of the day; null
  // after today.
  remaining: number | null;
  notFixed: number | null;
  ideal: number;
  // Only today and the deadline day, when there is a forecast.
  forecast: number | null;
};

export type RoundStatus = {
  total: number;
  counts: { status: OverviewStatus; label: string; count: number }[];
  voided: number;
  stuck: number;
  played: number;
  fixed: number;
  firstDay: Day;
  deadlineDay: Day;
  today: Day;
  // Days left until the deadline, today included.
  daysLeft: number;
  // Matches played per day lately, and per day still needed.
  pace: number;
  neededPace: number;
  // Matches played by the deadline at this pace; null while it's early.
  forecast: number | null;
  verdict: Verdict;
  // How many may be left unplayed (verdict "behind").
  shortfall: number;
  series: RoundDay[];
  // The first day of each week of the round, for the axis.
  weekMarks: { day: Day; label: string }[];
  weeks: { week: number; played: number; total: number; notFixed: number }[];
  groups: { group: number; played: number; total: number; behind: boolean }[];
};

const DAY_MS = 86_400_000;

// Whole calendar days from `from` to `to` (negative when `to` is earlier).
export function daysBetween(from: Day, to: Day): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

// The first instant after the Budapest day (its next midnight, DST included).
export function dayEnd(day: Day): Date {
  return budapestTime(addDays(day, 1), 0, 0);
}

const upTo = <T extends { at: Date }>(list: readonly T[], t: Date): T[] => list.filter((e) => e.at.getTime() <= t.getTime());

/** True when the match's result is final at `t` (confirmed, auto-accepted, decided at the deadline or by the organizer). */
export function isPlayedAt(m: Pick<RoundMatch, "results" | "rulings">, t: Date): boolean {
  return resultState(upTo(m.results, t), upTo(m.rulings, t)).status === "final";
}

/**
 * True when the match is fixed at `t`: a fixed time (accepted, confirmed or
 * fixed by itself, D148, and not cancelled since), or any result.
 */
export function isFixedAt(m: Pick<RoundMatch, "scheduling" | "results" | "rulings">, t: Date): boolean {
  if (resultState(upTo(m.results, t), upTo(m.rulings, t)).status !== "none") return true;
  return schedulingState(upTo(m.scheduling, t), t).status === "scheduled";
}

// The moments a match's state can change: its steps, its rulings, and the
// moments an agreed time becomes fixed by itself.
function changeMoments(m: Pick<RoundMatch, "scheduling" | "results" | "rulings">): number[] {
  const times = [
    ...m.scheduling.map((e) => e.at.getTime()),
    ...m.scheduling.filter((e) => e.kind === "agreed_time" && e.slot).map((e) => agreedFixAt(e.slot!, e.at).getTime()),
    ...m.results.map((e) => e.at.getTime()),
    ...m.rulings.map((r) => r.at.getTime()),
  ];
  return [...new Set(times)].sort((x, y) => x - y);
}

/** When the match became final (the first time), or null while it isn't. */
export function playedAt(m: Pick<RoundMatch, "results" | "rulings">, now: Date): Date | null {
  const moments = [...m.results.map((e) => e.at.getTime()), ...m.rulings.map((r) => r.at.getTime())].sort((x, y) => x - y);
  const first = moments.find((t) => t <= now.getTime() && isPlayedAt(m, new Date(t)));
  return first === undefined ? null : new Date(first);
}

/**
 * Since when the match has been fixed without a break, or null while it
 * isn't (a fixed time cancelled, #27, is not fixed until fixed again).
 */
export function fixedAt(m: Pick<RoundMatch, "scheduling" | "results" | "rulings">, now: Date): Date | null {
  if (!isFixedAt(m, now)) return null;
  const moments = changeMoments(m).filter((t) => t <= now.getTime());
  let since: number | null = null;
  for (const t of moments) {
    if (isFixedAt(m, new Date(t))) since ??= t;
    else since = null;
  }
  return since === null ? null : new Date(since);
}

const isFixedStatus = (s: OverviewStatus) => s === "scheduled" || s === "result_pending" || s === "disputed" || s === "final";

/** The running round's numbers at `now` (#350). */
export function roundStatus(input: RoundInput): RoundStatus {
  const { matches, now } = input;
  const total = matches.length;
  const firstDay = budapestDay(input.phaseStartsAt);
  const deadlineDay = budapestDay(input.deadline);
  const today = budapestDay(now);
  const span = Math.max(1, daysBetween(firstDay, deadlineDay) + 1);

  const counts = OVERVIEW_STATUSES.map((s) => ({ status: s.value, label: s.label, count: matches.filter((m) => m.status === s.value).length }));
  const played = matches.filter((m) => m.status === "final").length;
  const fixed = matches.filter((m) => isFixedStatus(m.status)).length;
  const playedDays = matches.map((m) => playedAt(m, now)).filter((t): t is Date => t !== null).map(budapestDay);

  // Whole days behind today since the round started; the pace is read over
  // the last PACE_DAYS of them.
  const passed = Math.max(0, Math.min(daysBetween(firstDay, today), span));
  const window = Math.min(PACE_DAYS, passed);
  const pace = window === 0 ? 0 : playedDays.filter((d) => daysBetween(d, today) >= 1 && daysBetween(d, today) <= window).length / window;
  const daysLeft = Math.max(0, daysBetween(today, deadlineDay) + 1);
  const left = total - played;
  const neededPace = left === 0 ? 0 : left / Math.max(1, daysLeft);
  const early = passed < EARLY_DAYS || played === 0;
  const forecast = early ? null : Math.min(total, played + Math.floor(pace * daysLeft + 1e-9));
  const verdict: Verdict = forecast === null ? "early" : forecast >= total ? "on_track" : "behind";

  const ideal = (i: number) => (span === 1 ? 0 : (total * (span - 1 - i)) / (span - 1));
  const todayIndex = daysBetween(firstDay, today);
  const series: RoundDay[] = Array.from({ length: span }, (_, i) => {
    const day = addDays(firstDay, i);
    const point: RoundDay = { day, remaining: null, notFixed: null, ideal: ideal(i), forecast: null };
    if (i > todayIndex) return point;
    const end = i === todayIndex ? now : new Date(dayEnd(day).getTime() - 1);
    point.remaining = matches.filter((m) => !isPlayedAt(m, end)).length;
    point.notFixed = matches.filter((m) => !isFixedAt(m, end)).length;
    return point;
  });
  if (forecast !== null && todayIndex >= 0 && todayIndex < span) {
    series[todayIndex]!.forecast = left;
    series[span - 1]!.forecast = total - forecast;
  }

  const weekNumbers = [...new Set(matches.map((m) => m.week))].sort((x, y) => x - y);
  const weekMarks = weekNumbers
    .map((week) => ({ day: weekDays(input.phaseStartsAt, week).start, label: `${week}. hét` }))
    .filter((w) => daysBetween(firstDay, w.day) >= 0 && daysBetween(w.day, deadlineDay) >= 0);

  // The ideal line's played share for today; nothing is behind before the start.
  const idealShare = todayIndex < 0 ? 0 : Math.min(1, span === 1 ? 1 : todayIndex / (span - 1));
  const tally = (list: readonly RoundMatch[]) => ({ played: list.filter((m) => m.status === "final").length, total: list.length });

  return {
    total,
    counts,
    voided: input.voided,
    stuck: matches.filter((m) => m.stuck).length,
    played,
    fixed,
    firstDay,
    deadlineDay,
    today,
    daysLeft,
    pace,
    neededPace,
    forecast,
    verdict,
    shortfall: forecast === null ? 0 : Math.max(0, total - forecast),
    series,
    weekMarks,
    weeks: weekNumbers.map((week) => {
      const list = matches.filter((m) => m.week === week);
      return { week, ...tally(list), notFixed: list.filter((m) => !isFixedStatus(m.status)).length };
    }),
    groups: input.groups.map((group) => {
      const t = tally(matches.filter((m) => m.groupNumber === group));
      return { group, ...t, behind: todayIndex >= 0 && t.total > 0 && t.played / t.total < idealShare - GROUP_BEHIND_GAP };
    }),
  };
}

// The page anchors on "Meccsek": the section, and the match list a filter
// link lands on. Here, so the Áttekintés line links without the chart code.
export const SECTION_ANCHOR = "allapot";
export const LIST_ANCHOR = "meccsek";

// --- Text -----------------------------------------------------------------------

const oneDecimal = new Intl.NumberFormat("hu-HU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("hu-HU", { style: "percent", maximumFractionDigits: 1 });

// "0,8"
export const formatPace = (n: number) => oneDecimal.format(n);

// 12 of 48 -> "25%", 1 of 3 -> "33,3%"
export const shareText = (part: number, whole: number) => percent.format(whole === 0 ? 0 : part / whole);

// "még 9 nap"; on the deadline day "ma a határidő".
export function daysLeftText(daysLeft: number): string {
  return daysLeft <= 1 ? "ma a határidő" : `még ${daysLeft} nap`;
}

/** The verdict line (#350 requirement 3). */
export function verdictText(s: Pick<RoundStatus, "verdict" | "shortfall">): string {
  switch (s.verdict) {
    case "early":
      return "Még korai becsülni.";
    case "on_track":
      return "Jó ütemben: a mostani tempóval minden meccs lemegy a határidőig.";
    case "behind":
      return `Lemaradás: a mostani tempóval kb. ${s.shortfall} meccs maradhat le.`;
  }
}

// "naponta 1,5 meccs kellene, eddig 0,8/nap"
export function paceText(s: Pick<RoundStatus, "neededPace" | "pace">): string {
  return `naponta ${formatPace(s.neededPace)} meccs kellene, eddig ${formatPace(s.pace)}/nap`;
}

// The verdict in one word, for the compact line.
export const VERDICT_SHORT: Record<Verdict, string> = {
  early: "Még korai becsülni",
  on_track: "Jó ütemben",
  behind: "Lemaradás",
};

/** "Lejátszva 12/48 (25%) · még 9 nap · Lemaradás" (#350 requirement 8). */
export function compactLine(s: Pick<RoundStatus, "played" | "total" | "daysLeft" | "verdict">): string {
  return `Lejátszva ${s.played}/${s.total} (${shareText(s.played, s.total)}) · ${daysLeftText(s.daysLeft)} · ${VERDICT_SHORT[s.verdict]}`;
}
