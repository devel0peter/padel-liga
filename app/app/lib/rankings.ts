// The Ranglista (D137): a league's players and pairs by Élő-pont. Pure: the
// loader hands in what is stored. Equal shown Élő-pont shares a place and is
// listed by name until the tiebreak rules exist (#345).

export type RankInput = {
  key: string;
  name: string;
  /** The Élő-pont, unrounded: the player's own, or the pair's two players' average. */
  rating: number;
  /** The profile's address. */
  href: string | null;
  /** The viewer, or the viewer's pair. */
  mine: boolean;
  /** Rated matches, for players; null for pairs. */
  matches: number | null;
};

export type RankRow = Omit<RankInput, "rating"> & {
  /** "1." for the first; tied rows share the place of the first of them. */
  place: number;
  /** The Élő-pont as shown: rounded (spec 11). */
  elo: number;
};

const byName = new Intl.Collator("hu", { sensitivity: "base" });

/**
 * The rows by shown Élő-pont, highest first. Equal shown values share a
 * place (1, 2, 2, 4) and are ordered by name (#345 brings the tiebreaks).
 */
export function rankRows(list: readonly RankInput[]): RankRow[] {
  const rows = list
    .map(({ rating, ...r }) => ({ ...r, elo: Math.round(rating) }))
    .sort((x, y) => y.elo - x.elo || byName.compare(x.name, y.name) || x.key.localeCompare(y.key));
  return rows.map((r) => ({ ...r, place: rows.findIndex((x) => x.elo === r.elo) + 1 }));
}
