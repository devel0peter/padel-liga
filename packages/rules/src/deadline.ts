// Unplayed matches at the deadline (spec section 8, issue #11; README
// decision log D103): the outcome of a match nobody finished, from its
// scheduling log, and the sides that get a strike for it (spec 8, "Strikes").
// Pure: no I/O. Only a match without any result is resolved here; a recorded
// or disputed result is left to the 48-hour auto-accept and the organizer.

import { addDays, budapestDay, budapestTime } from "./calendar";
import type { Side } from "./results";
import { activeSides, lateCancellers, other, schedulingState, type SchedulingEvent } from "./scheduling";
import type { MatchOutcome } from "./standings";
import { applyStrikes, pairsLeaving, strikeNotice } from "./strikes";

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

/** A match's status (the `matches.status` column). */
export type MatchStatus = "open" | "scheduled" | "result_pending" | "disputed" | "final";

/**
 * Why the deadline resolution leaves a match alone (spec 8, D103, D108):
 * already final; a withdrawn pair's match (it doesn't count); a result
 * waiting for confirmation (auto-accept settles it) or disputed (the
 * organizer decides); a no-show report waiting for the organizer.
 */
export type DeadlineSkip = "final" | "withdrawn" | "result_pending" | "disputed" | "no_show";

export type DeadlineMatch = {
  status: MatchStatus;
  // A pair of the match withdrew mid-phase (D87).
  withdrawn: boolean;
  // A no-show report waits for the organizer (#33).
  openNoShow: boolean;
  events: readonly SchedulingEvent[];
  deadline: Date;
};

export type DeadlineDecision = { kind: "resolve"; resolution: DeadlineResolution } | { kind: "leave"; reason: DeadlineSkip };

/**
 * What the deadline resolution does with one match (spec 8, D103): resolve
 * it from its scheduling log (resolveAtDeadline), or leave it alone and why.
 * The one rule of the real run (deadline.server.ts) and of the organizer's
 * projection of it ("Ha most lenne a határidő", #362), so the two can't drift.
 */
export function deadlineDecision(m: DeadlineMatch): DeadlineDecision {
  if (m.withdrawn) return { kind: "leave", reason: "withdrawn" };
  if (m.status === "final" || m.status === "result_pending" || m.status === "disputed") return { kind: "leave", reason: m.status };
  if (m.openNoShow) return { kind: "leave", reason: "no_show" };
  return { kind: "resolve", resolution: resolveAtDeadline(m.events, m.deadline) };
}

export type ProjectedMatch = DeadlineMatch & { id: number; pairA: number; pairB: number };

export type DeadlineProjection = {
  // Every match given, by id.
  decisions: Map<number, DeadlineDecision>;
  // Each player of the pairs given: live strikes now, and after the
  // projection's strikes (spec 8: a strike belongs to the player).
  strikes: Map<string, { now: number; after: number }>;
  // The players the projection's strikes would bring to their 2nd strike
  // with the warning email (strikeNotice "warning"), in the run's order.
  warned: { pairId: number; userId: string }[];
  // The pairs with a player at STRIKE_LIMIT or more after the projection:
  // they would leave at the round switch (pairsLeaving).
  leaving: number[];
};

/**
 * What the deadline resolution would do if it ran now with the activity
 * recorded so far (#362): each match's decision, and the strikes it would
 * give on top of `counts` (each player's live strikes this season), counted
 * in the run's order (by match id), as the run counts them. `pairs`: the
 * round's pairs that count (not withdrawn) with their two players; a
 * substitute is never among them, so never gets a strike (spec 8).
 */
export function projectDeadline(
  matches: readonly ProjectedMatch[],
  pairs: readonly { id: number; players: readonly string[] }[],
  counts: ReadonlyMap<string, number>,
): DeadlineProjection {
  const playersOf = new Map(pairs.map((p) => [p.id, p.players]));
  const running = new Map(pairs.flatMap((p) => p.players.map((id) => [id, counts.get(id) ?? 0] as const)));
  const decisions = new Map<number, DeadlineDecision>();
  const warned: DeadlineProjection["warned"] = [];
  for (const m of [...matches].sort((x, y) => x.id - y.id)) {
    const decision = deadlineDecision(m);
    decisions.set(m.id, decision);
    if (decision.kind !== "resolve") continue;
    const grants = decision.resolution.inactive.map((s) => {
      const pairId = s === "a" ? m.pairA : m.pairB;
      return { pairId, players: playersOf.get(pairId) ?? [] };
    });
    for (const step of applyStrikes(running, grants))
      if (strikeNotice(step.count, step.pairCount) === "warning") warned.push({ pairId: step.pairId, userId: step.player });
  }
  const strikes = new Map([...running].map(([id, after]) => [id, { now: counts.get(id) ?? 0, after }]));
  const leaving = pairsLeaving(pairs, running).map((p) => p.id);
  return { decisions, strikes, warned, leaving };
}
