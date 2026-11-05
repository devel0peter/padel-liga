// Unplayed matches at the deadline (spec section 8, issue #11; README
// decision log D103): the outcome of a match nobody finished, from its
// scheduling log, and the sides that get a strike for it (spec 8, "Strikes").
// Pure: no I/O. Only a match without any result is resolved here; a recorded
// or disputed result is left to the 48-hour auto-accept and the organizer.

import { addDays, budapestDay, budapestTime } from "./calendar";
import type { Side } from "./results";
import { activeSides, lateCancellers, other, schedulingState, type SchedulingEvent } from "./scheduling";
import type { MatchOutcome } from "./standings";

export type DeadlineResolution = {
  outcome: MatchOutcome;
  // The sides that were inactive (spec 8): each of their two players gets a
  // strike. Empty when both sides were active.
  inactive: Side[];
};

/** The Budapest hour the deadline step runs at, the morning after the deadline (D103). */
export const RESOLUTION_HOUR = 6;

/**
 * When the match is resolved: the first 06:00 Budapest after its deadline
 * (Monday morning for a Sunday 23:59 deadline). Until then a late result
 * can still be recorded, and then auto-accept or the organizer settles it.
 */
export function resolutionDue(deadline: Date): Date {
  const sameDay = budapestTime(budapestDay(deadline), RESOLUTION_HOUR, 0);
  return sameDay.getTime() > deadline.getTime() ? sameDay : budapestTime(addDays(budapestDay(deadline), 1), RESOLUTION_HOUR, 0);
}

/**
 * The matches resolvable at `now` are those whose deadline is before this:
 * the last 06:00 Budapest at or before `now`. The same as
 * resolutionDue(deadline) <= now, as a bound for a query.
 */
export function resolutionCutoff(now: Date): Date {
  const today = budapestTime(budapestDay(now), RESOLUTION_HOUR, 0);
  return today.getTime() <= now.getTime() ? today : budapestTime(addDays(budapestDay(now), -1), RESOLUTION_HOUR, 0);
}

/**
 * Who counts as active at the deadline (spec 8, D103):
 * - a side with valid activity before the deadline (a proposal or
 *   counter-proposal, recording or confirming an agreed time), and
 * - both sides when the match reached an agreed slot: it is scheduled at the
 *   deadline (also a scheduled slot that passed without a result);
 * - the other side of a late cancellation: its agreed slot was given up
 *   under 24 hours ahead, so the walkover is its (spec 6.6 and 8);
 * - but a side that cancelled under 24 hours before a slot is inactive
 *   whatever it did before (spec 6.6).
 */
export function activeAtDeadline(events: readonly SchedulingEvent[], deadline: Date): Side[] {
  const before = events.filter((e) => e.at.getTime() < deadline.getTime());
  const agreed = schedulingState(before, deadline).status === "scheduled";
  const active = new Set<Side>(agreed ? ["a", "b"] : activeSides(before, deadline));
  const late = lateCancellers(before, deadline);
  for (const side of late) active.add(other(side));
  for (const side of late) active.delete(side);
  return (["a", "b"] as const).filter((s) => active.has(s));
}

/**
 * The outcome of an unplayed match at the deadline (spec 8):
 * - one side active: a 4-0 4-0 walkover for it, a strike for the other;
 * - both active: unplayed (no points, no strike; the organizer may still
 *   award a walkover through an override);
 * - neither active: a 0-4 0-4 loss for both, a strike for both.
 */
export function resolveAtDeadline(events: readonly SchedulingEvent[], deadline: Date): DeadlineResolution {
  const active = activeAtDeadline(events, deadline);
  if (active.length === 2) return { outcome: { kind: "unplayed" }, inactive: [] };
  if (active.length === 1) {
    const winner = active[0]!;
    return { outcome: { kind: "walkover", winner }, inactive: [other(winner)] };
  }
  return { outcome: { kind: "both-inactive" }, inactive: ["a", "b"] };
}
