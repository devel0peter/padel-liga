// No-shows (spec 8, #33, D108): at an accepted slot one side didn't turn up.
// A player of the side that did reports it from the match page, after the
// slot's start and before the deadline resolution runs; the league's
// organizer confirms (a 4-0 4-0 walkover for the reporting side, a strike for
// both players of the other) or rejects it. Pure; the reports live in
// no_show_reports (app/lib/no-shows.server.ts).

import { resolutionDue } from "./deadline";
import type { Side } from "./results";
import { other } from "./scheduling";
import type { MatchOutcome } from "./standings";

export type NoShowStatus = "open" | "withdrawn" | "confirmed" | "rejected";

export type NoShowRefusal =
  // A pair of the match was withdrawn mid-phase: the match doesn't count.
  | "voided"
  // No agreed slot (or a result is already recorded): nothing to miss.
  | "not_scheduled"
  // The agreed slot hasn't started yet.
  | "too_early"
  // The deadline resolution's time came: the match is resolved there.
  | "too_late"
  // The match has a report waiting already (one per match).
  | "already"
  // Only a waiting report can be withdrawn, confirmed or rejected.
  | "not_open"
  // Only the player who reported it can withdraw it.
  | "not_reporter"
  // The match is final already (e.g. a result was accepted meanwhile).
  | "final";

export interface NoShowMatch {
  readonly voided: boolean;
  // The match's mirrored status: "scheduled" while an agreed slot stands and no result is recorded.
  readonly status: string;
  readonly scheduledAt: Date | null;
  readonly deadline: Date;
}

/**
 * Until when a no-show can be reported: the deadline resolution's time (the
 * first 06:00 Budapest after the deadline, D103). Then the match is resolved
 * by the cron, unless a report is waiting for the organizer.
 */
export function noShowClosesAt(deadline: Date): Date {
  return resolutionDue(deadline);
}

/**
 * Why a player can't report a no-show on this match now, or null (spec 8):
 * only on an agreed slot that has started, before the deadline resolution,
 * and only one waiting report per match. Either pair may report it: the
 * reporting pair is the one that says it showed up.
 */
export function reportRefusal(m: NoShowMatch & { openReport: boolean }, now: Date): NoShowRefusal | null {
  if (m.voided) return "voided";
  if (m.status !== "scheduled" || !m.scheduledAt) return "not_scheduled";
  if (now.getTime() < m.scheduledAt.getTime()) return "too_early";
  if (now.getTime() >= noShowClosesAt(m.deadline).getTime()) return "too_late";
  if (m.openReport) return "already";
  return null;
}

/** Why the reporting player can't withdraw this report, or null: only their own, while it waits. */
export function reportWithdrawalRefusal(r: { status: NoShowStatus; reportedBy: string | null }, userId: string): NoShowRefusal | null {
  if (r.status !== "open") return "not_open";
  return r.reportedBy === userId ? null : "not_reporter";
}

/**
 * Why the organizer can't confirm this report, or null: only a waiting one,
 * on a match that counts and isn't final (a final match is overridden on the
 * decision page instead).
 */
export function confirmRefusal(r: { status: NoShowStatus }, m: { voided: boolean; status: string }): NoShowRefusal | null {
  if (r.status !== "open") return "not_open";
  if (m.voided) return "voided";
  if (m.status === "final") return "final";
  return null;
}

/** Why the organizer can't reject this report, or null: any waiting one can be turned down. */
export function rejectRefusal(r: { status: NoShowStatus }): NoShowRefusal | null {
  return r.status === "open" ? null : "not_open";
}

/**
 * What a confirmed no-show records (spec 8): a 4-0 4-0 walkover for the side
 * that reported it, and a strike for both players of the other side.
 */
export function noShowOutcome(reporting: Side): { outcome: MatchOutcome; absent: Side } {
  return { outcome: { kind: "walkover", winner: reporting }, absent: other(reporting) };
}
