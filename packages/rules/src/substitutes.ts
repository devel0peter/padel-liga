// Temporary substitutes (spec 4 "Substitute", spec 11, #400, decision log
// D175; replaces the named and approved substitute of D109): a pair marks
// which of its players didn't play a match, and anyone (no account needed)
// plays instead. No name, no approval. Before the match on the match page,
// after it on the result form. Pure; the marks live in match_absences
// (app/lib/substitutes.server.ts).

/**
 * When marking an absence before the match closes: the agreed start of the
 * match, or its deadline while no time is agreed. After that it is marked
 * with the result (resultAbsences).
 */
export function absenceClosesAt(m: { scheduledAt: Date | null; deadline: Date }): Date {
  return m.scheduledAt ?? m.deadline;
}

/** Whether the match page's window is still open: before the start, no result yet, and the match counts. */
export function absenceOpen(m: { closesAt: Date; hasResult: boolean; voided: boolean }, now: Date): boolean {
  return !m.voided && !m.hasResult && now.getTime() < m.closesAt.getTime();
}

export type AbsenceRefusal =
  // The match started, has a result, or doesn't count (withdrawal).
  | "closed"
  // The player is not of the marking player's own pair.
  | "not_own"
  // Already marked on this match.
  | "already"
  // Not marked, so nothing to take back.
  | "not_marked";

export interface AbsenceCheck {
  /** absenceOpen() for the match now. */
  readonly open: boolean;
  /** The marking player's pair. */
  readonly pair: readonly string[];
  readonly absentId: string;
  /** The players marked absent on this match so far. */
  readonly marked: readonly string[];
}

/** Why a player of `pair` can't mark `absentId` as not playing now, or null. Both players of a pair may be. */
export function markRefusal(c: AbsenceCheck): AbsenceRefusal | null {
  if (!c.open) return "closed";
  if (!c.pair.includes(c.absentId)) return "not_own";
  return c.marked.includes(c.absentId) ? "already" : null;
}

/** Why a player of `pair` can't take back the mark of `absentId` now, or null: either player of the pair, before the start. */
export function unmarkRefusal(c: AbsenceCheck): AbsenceRefusal | null {
  if (!c.open) return "closed";
  if (!c.pair.includes(c.absentId)) return "not_own";
  return c.marked.includes(c.absentId) ? null : "not_marked";
}

/**
 * The marks the result form leaves for the recording pair (#400): exactly
 * the pair's players it ticks; anyone else ticked is ignored. What it adds
 * and what it takes away from the pair's current marks.
 */
export function resultAbsences(pair: readonly string[], current: readonly string[], ticked: readonly string[]): { add: string[]; remove: string[] } {
  const want = new Set(ticked.filter((id) => pair.includes(id)));
  const now = new Set(current.filter((id) => pair.includes(id)));
  return { add: pair.filter((id) => want.has(id) && !now.has(id)), remove: pair.filter((id) => now.has(id) && !want.has(id)) };
}
