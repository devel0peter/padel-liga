// Strikes ("fekete pont", spec section 8, issue #294; README decision log
// D82, D103). A strike belongs to a player, not to a pair: it follows them
// across partner changes and counts per season, so a new season starts from
// zero. A cancelled strike doesn't count. Pure: no I/O.

/** Where a strike came from: the deadline resolution (#11) or a no-show the organizer confirmed (#33). */
export const STRIKE_SOURCES = ["deadline", "no_show"] as const;
export type StrikeSource = (typeof STRIKE_SOURCES)[number];

/** The 2nd strike is the warning (an email, spec 13). */
export const STRIKE_WARNING = 2;
/** The 3rd strike: the player's pair leaves the league at the end of the phase. */
export const STRIKE_LIMIT = 3;

export type StrikeRecord = {
  userId: string;
  seasonId: number;
  cancelled: boolean;
};

/** Each player's strikes in `seasonId`, cancelled ones left out; a player without any is missing. */
export function strikeCounts(strikes: readonly StrikeRecord[], seasonId: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of strikes) if (s.seasonId === seasonId && !s.cancelled) out.set(s.userId, (out.get(s.userId) ?? 0) + 1);
  return out;
}

/** One player's strikes in `seasonId`. */
export function strikeCount(strikes: readonly StrikeRecord[], userId: string, seasonId: number): number {
  return strikeCounts(strikes, seasonId).get(userId) ?? 0;
}

export type StrikeNotice = "strike" | "warning" | "leaving";

/**
 * What a player is told after a strike that brought them to `count` (spec 13):
 * the 1st with the count, the 2nd as the warning (also by email), and that
 * the pair leaves at the end of the phase once a player of the pair has
 * STRIKE_LIMIT (`pairCount`: the pair's highest count, the player's own when
 * left out). A partner change can leave one player at 3 and the other below:
 * the pair leaves, so both are told so, and the warning, which says "one
 * more and you leave", is not sent then.
 */
export function strikeNotice(count: number, pairCount = count): StrikeNotice | null {
  if (count < 1) return null;
  if (Math.max(count, pairCount) >= STRIKE_LIMIT) return "leaving";
  if (count < STRIKE_WARNING) return "strike";
  return "warning";
}

/**
 * The pairs that leave at the round switch (spec 8 and 10, removed by #35
 * after promotion and relegation): those with a player at STRIKE_LIMIT or
 * more strikes this season. Recomputed from the counts, so a cancelled
 * strike takes a pair off the list again.
 */
export function pairsLeaving<P extends { players: readonly string[] }>(pairs: readonly P[], counts: ReadonlyMap<string, number>): P[] {
  return pairs.filter((p) => p.players.some((id) => (counts.get(id) ?? 0) >= STRIKE_LIMIT));
}
