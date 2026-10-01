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
