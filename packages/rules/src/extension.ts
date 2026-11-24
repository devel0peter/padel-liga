// Extending a running round (#356, D151): the organizer moves the round's
// deadline to a later Sunday, and every later round moves by exactly the same
// number of weeks, so each keeps its full length. No round jumps over a
// holiday or any other break (D172, #393): the season runs through it.
// Pure: no I/O.

import { addDays, budapestTime, isDay, isMonday, type Day, type Phase } from "./calendar";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A stored round as Budapest days: its first Monday and its last Sunday. */
export type PhaseSpan = { number: number; start: Day; end: Day };

export function isSunday(day: Day): boolean {
  return isDay(day) && isMonday(addDays(day, 1));
}

/** Days from `a` to `b` (negative if `b` is earlier). */
export function daysBetween(a: Day, b: Day): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/**
 * The season's rounds after round `number`'s deadline moves to the Sunday
 * `newEnd` (later than its current one). Earlier rounds and the round's own
 * start stay; each later round moves by exactly the same number of weeks,
 * whatever breaks the season was set up with (D172). Throws on a round the
 * season doesn't have, a day that isn't a Sunday, or one not after the
 * current deadline.
 */
export function extendRound(phases: readonly PhaseSpan[], number: number, newEnd: Day): Phase[] {
  const sorted = [...phases].sort((a, b) => a.number - b.number);
  const target = sorted.find((p) => p.number === number);
  if (!target) throw new Error(`No round ${number} in this season`);
  if (!isSunday(newEnd)) throw new Error(`A deadline is a Sunday: ${newEnd}`);
  const shift = daysBetween(target.end, newEnd);
  if (shift <= 0) throw new Error(`The new deadline must be after ${target.end}: ${newEnd}`);
  if (shift % 7 !== 0) throw new Error(`Round ${number} doesn't end on a Sunday: ${target.end}`);

  return sorted.map((p) => {
    const start = p.number > number ? addDays(p.start, shift) : p.start;
    const end = p.number >= number ? addDays(p.end, shift) : p.end;
    return { number: p.number, start, end, startsAt: budapestTime(start, 0, 0), deadline: budapestTime(end, 23, 59) };
  });
}

/** How many weeks later a round starts after the extension (0 for the extended round and earlier ones). */
export function weeksLater(before: Pick<PhaseSpan, "start">, after: Pick<PhaseSpan, "start">): number {
  return Math.round(daysBetween(before.start, after.start) / 7);
}
