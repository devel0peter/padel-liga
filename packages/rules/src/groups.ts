// A phase's groups after seeding (#24, spec sections 4, 5 and 10): the
// organizer's moves, the size check before publishing, and the matches that
// publishing creates. Pure: no I/O.
import { groupRounds } from "./fixtures";
import type { SeedablePair } from "./seeding";

/** The league only has groups of 3 and 4 pairs (spec section 4). */
export function validGroupSize(size: number): boolean {
  return size === 3 || size === 4;
}

/**
 * The groups that block publishing, by index (0 = 1. csoport): every group that
 * doesn't have 3 or 4 pairs. A draft with no groups at all reports [-1].
 */
export function groupProblems(sizes: readonly number[]): number[] {
  if (sizes.length === 0) return [-1];
  return sizes.flatMap((size, i) => (validGroupSize(size) ? [] : [i]));
}

/**
 * Seed order within a group: average Elo, strongest first. Equal ratings keep
 * their input order (stable sort), so callers pass pairs in approval order, as
 * for seedGroups. The input is not modified.
 */
export function seedOrder<T extends SeedablePair>(pairs: readonly T[]): T[] {
  return [...pairs].sort((a, b) => b.averageElo - a.averageElo);
}

/**
 * Moves one pair into another group of the draft (index 0 = 1. csoport) and
 * re-seeds that group by Elo. Sizes are not checked here: a move may leave a
 * group of 2 or 5, which groupProblems then reports, so the organizer can make
 * several moves before publishing. Returns a new draft; the input is unchanged.
 */
export function movePair<T extends SeedablePair, K>(
  groups: readonly (readonly T[])[],
  pairKey: K,
  toGroup: number,
  keyOf: (pair: T) => K,
): T[][] {
  if (!Number.isInteger(toGroup) || toGroup < 0 || toGroup >= groups.length) {
    throw new Error(`There is no group ${toGroup} in a draft of ${groups.length}`);
  }
  const from = groups.findIndex((g) => g.some((pair) => keyOf(pair) === pairKey));
  if (from < 0) throw new Error(`Pair ${String(pairKey)} is not in the draft`);
  const next = groups.map((g) => [...g]);
  if (from === toGroup) return next;
  const pair = next[from]!.find((x) => keyOf(x) === pairKey)!;
  next[from] = next[from]!.filter((x) => keyOf(x) !== pairKey);
  // The moved pair goes last before sorting, so on an Elo tie it is seeded
  // below the pairs already there.
  next[toGroup] = seedOrder([...next[toGroup]!, pair]);
  return next;
}

export interface PhaseMatch<T> {
  /** Index of the group, 0 = 1. csoport. */
  readonly group: number;
  /** The match's scheduled week in the phase, 1–3. */
  readonly week: number;
  readonly a: T;
  readonly b: T;
}

/**
 * Every match of a phase: each group's round robin in fixture order (spec
 * section 5), each group ordered by seed. A group that isn't 3 or 4 pairs is
 * an error: check groupProblems first.
 */
export function phaseMatches<T>(groups: readonly (readonly T[])[]): PhaseMatch<T>[] {
  return groups.flatMap((group, gi) =>
    groupRounds(group).flatMap((round, ri) => round.map(([a, b]) => ({ group: gi, week: ri + 1, a, b }))),
  );
}
