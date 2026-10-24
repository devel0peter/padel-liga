export type Pairing<T> = readonly [T, T];
export type Round<T> = readonly Pairing<T>[];

// Seed positions (1-based) per week for a group of 4, spec section 5.
const GROUP_OF_4_ROUNDS = [
  [[1, 4], [2, 3]],
  [[1, 3], [2, 4]],
  [[1, 2], [3, 4]],
] as const;

/**
 * Round-robin schedule for a group of 4 pairs, ordered by seed (strongest first).
 * Returns one round per week; every pair plays every other pair exactly once.
 */
export function groupOf4Rounds<T>(seeded: readonly T[]): Round<T>[] {
  if (seeded.length !== 4) {
    throw new Error(`A group of 4 needs exactly 4 pairs, got ${seeded.length}`);
  }
  const at = (seed: number) => seeded[seed - 1] as T;
  return GROUP_OF_4_ROUNDS.map((round) => round.map(([a, b]) => [at(a), at(b)] as const));
}

// Seed positions (1-based) per week for a group of 3, spec section 5: the group-of-4
// order with seed 4 as the bye, so each week one pairing remains and one pair rests.
const GROUP_OF_3_ROUNDS = [
  [[2, 3]], // seed 1 rests
  [[1, 3]], // seed 2 rests
  [[1, 2]], // seed 3 rests
] as const;

/**
 * Round-robin schedule for a group of 3 pairs, ordered by seed (strongest first).
 * Returns one round per week with a single match; the pair missing from a round rests
 * that week. Every pair plays 2 matches and rests once.
 */
export function groupOf3Rounds<T>(seeded: readonly T[]): Round<T>[] {
  if (seeded.length !== 3) {
    throw new Error(`A group of 3 needs exactly 3 pairs, got ${seeded.length}`);
  }
  const at = (seed: number) => seeded[seed - 1] as T;
  return GROUP_OF_3_ROUNDS.map((round) => round.map(([a, b]) => [at(a), at(b)] as const));
}

/**
 * Round-robin schedule for a group of 3 or 4 pairs, ordered by seed. Any other size
 * is an error: the league only has groups of 4 and 3 (spec section 4).
 */
export function groupRounds<T>(seeded: readonly T[]): Round<T>[] {
  if (seeded.length === 4) return groupOf4Rounds(seeded);
  if (seeded.length === 3) return groupOf3Rounds(seeded);
  throw new Error(`A group needs 3 or 4 pairs, got ${seeded.length}`);
}
