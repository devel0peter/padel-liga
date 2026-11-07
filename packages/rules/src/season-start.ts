// A league's first season starts by itself once it has the minimum number of
// pair entries (decision log, 2026-11-06, D124, #335). Pure: no I/O.

import { addDays, budapestDay, firstMondayAfter, phaseCalendar, type Break, type Day } from "./calendar";

// Three groups of four, one per division.
export const DEFAULT_MIN_ENTRIES = 12;

// The days between the moment the minimum is reached and the first round.
export const START_NOTICE_DAYS = 7;

/**
 * The first round's Monday of a league's first season, or null while it has
 * no start. `entries` is the season's entry count with the entry being added
 * at `at`; once the count reaches `minimum`, the start is the first Monday at
 * least 7 days after `at`'s Budapest day, moved by the calendar's break rule
 * (phaseCalendar: a phase that would touch a break starts after it). `fixed`
 * is a start already set: it never moves again, whatever the count does.
 */
export function firstSeasonStart(input: {
  entries: number;
  minimum: number;
  at: Date;
  breaks: readonly Break[];
  fixed?: Day | null;
}): Day | null {
  if (input.fixed) return input.fixed;
  if (input.entries < input.minimum) return null;
  // The first Monday strictly after day + 6, so at least 7 days later.
  const monday = firstMondayAfter(addDays(budapestDay(input.at), START_NOTICE_DAYS - 1));
  return phaseCalendar(monday, input.breaks)[0]!.start;
}

// How many more entries the season needs to start; 0 once it has enough.
export function entriesMissing(entries: number, minimum: number): number {
  return Math.max(0, minimum - entries);
}
