/** A pair that can be seeded: only its average Elo matters (spec section 10, no discount, no cap). */
export interface SeedablePair {
  readonly averageElo: number;
}

export type SeedingResult<T> =
  | {
      readonly ok: true;
      /** Group 1 first (strongest). Each group is ordered by seed, strongest first. */
      readonly groups: readonly (readonly T[])[];
    }
  | {
      readonly ok: false;
      readonly reason: "not-splittable";
      readonly pairCount: number;
    };

/**
 * Group sizes for a pair count, strongest group first: as many groups of 4 as possible,
 * groups of 3 for the rest at the bottom (9 = 3+3+3, 10 = 4+3+3, 11 = 4+4+3), spec section 4.
 * Returns null when the count can't be split into 3s and 4s: 0, 1, 2 and 5 pairs.
 */
export function groupSizes(pairCount: number): number[] | null {
  if (!Number.isInteger(pairCount) || pairCount <= 0) return null;
  const threes = (4 - (pairCount % 4)) % 4;
  const fours = (pairCount - 3 * threes) / 4;
  if (fours < 0) return null;
  return [...Array<number>(fours).fill(4), ...Array<number>(threes).fill(3)];
}

/**
 * First-phase seeding (spec section 10): sort the approved pairs by average Elo, strongest
 * first, and cut them into groups of 4 and 3 with the 3-pair groups at the bottom.
 *
 * Pairs with equal average Elo keep their input order (stable sort), so callers pass the
 * pairs in approval order and the earlier-approved pair is seeded higher. The input is not
 * modified. A pair count that can't be split (0, 1, 2 or 5) is reported, never guessed.
 */
export function seedGroups<T extends SeedablePair>(pairs: readonly T[]): SeedingResult<T> {
  for (const pair of pairs) {
    if (!Number.isFinite(pair.averageElo)) {
      throw new Error(`Average Elo must be a finite number, got ${pair.averageElo}`);
    }
  }
  const sizes = groupSizes(pairs.length);
  if (!sizes) return { ok: false, reason: "not-splittable", pairCount: pairs.length };

  const sorted = [...pairs].sort((a, b) => b.averageElo - a.averageElo);
  const groups: T[][] = [];
  let start = 0;
  for (const size of sizes) {
    groups.push(sorted.slice(start, start + size));
    start += size;
  }
  return { ok: true, groups };
}
