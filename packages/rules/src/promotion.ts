// The round switch (spec section 10, szabalyzat section 7, #12): promotion
// and relegation of the continuing pairs, the pairs that leave (withdrawn,
// a 3rd strike, dissolved, taken out) removed afterwards with the groups
// re-cut top-down, then the new pairs placed one by one. Pure: no I/O.
import { seedOrder } from "./groups";
import { groupSizes, type SeedablePair } from "./seeding";

/** A full group (spec 4). */
export const FULL_GROUP = 4;

/** A new pair's player without a rated match counts this much lower (spec 10 step 1). */
export const UNRATED_DISCOUNT = 100;

/** The default number of fast switches of a league (spec 10: the first switch only). */
export const DEFAULT_FAST_SWITCHES = 1;

/**
 * Whether the switch after `endingPhase` is a fast-calibration switch: only
 * in the league's first season, for its first `fastSwitches` switches (the
 * switch after phase 1 is the first).
 */
export function isFastSwitch(input: { firstSeason: boolean; endingPhase: number; fastSwitches: number }): boolean {
  return input.firstSeason && input.endingPhase >= 1 && input.endingPhase <= input.fastSwitches;
}

/**
 * How many pairs swap at the border between two adjacent groups, from the
 * number of pairs in each group's final table: 2 at a fast switch when both
 * have 4, else 1 (spec 10).
 */
export function borderSwaps(upper: number, lower: number, fast: boolean): number {
  return fast && upper >= FULL_GROUP && lower >= FULL_GROUP ? 2 : 1;
}

/**
 * Promotion and relegation (spec 10): each group's final table (pairs in
 * table order, withdrawn pairs left out as in the table, rules 2), top group
 * first. At every border the lower group's top pairs go up and the upper
 * group's bottom pairs go down (borderSwaps); nobody goes up from the top
 * group or down from the bottom one. A group too small for both moves sends
 * its winners up first (a single pair goes up, never both ways).
 *
 * Each resulting group lists its pairs by last-phase group, then place
 * (spec 10, season switch step 4): the pairs relegated into it, its own
 * pairs that stay, then the pairs promoted into it. The re-cut after the
 * leavers are removed follows this order.
 */
export function promoteAndRelegate<T>(tables: readonly (readonly T[])[], fast: boolean): T[][] {
  const last = tables.length - 1;
  const up = tables.map((t, i) => (i === 0 ? 0 : Math.min(borderSwaps(tables[i - 1]!.length, t.length, fast), t.length)));
  const down = tables.map((t, i) => (i === last ? 0 : Math.min(borderSwaps(t.length, tables[i + 1]!.length, fast), t.length - up[i]!)));
  return tables.map((t, i) => {
    const fromAbove = i === 0 ? [] : tables[i - 1]!.slice(tables[i - 1]!.length - down[i - 1]!);
    const stay = t.slice(up[i]!, t.length - down[i]!);
    const fromBelow = i === last ? [] : tables[i + 1]!.slice(0, up[i + 1]!);
    return [...fromAbove, ...stay, ...fromBelow];
  });
}

/**
 * Group sizes for a pair count: the section 4 sizes, or, for a count that
 * can't be split into 3s and 4s (1, 2 or 5), groups of 4 top-down and the
 * rest in a last, short group, which then blocks publishing until new pairs
 * or the organizer fix it.
 */
export function switchSizes(pairCount: number): number[] {
  if (pairCount <= 0) return [];
  return groupSizes(pairCount) ?? [...Array<number>(Math.floor(pairCount / FULL_GROUP)).fill(FULL_GROUP), pairCount % FULL_GROUP].filter((n) => n > 0);
}

/** Cuts pairs, in order, top-down into groups of the given sizes. */
function cut<T>(order: readonly T[], sizes: readonly number[]): T[][] {
  const out: T[][] = [];
  let start = 0;
  for (const size of sizes) {
    out.push(order.slice(start, start + size));
    start += size;
  }
  return out;
}

/**
 * Removes the leaving pairs and re-cuts the rest top-down into groups of the
 * section 4 sizes, so pairs below move up into the holes (spec 8 and 10).
 */
export function recut<T>(groups: readonly (readonly T[])[], leaves: (pair: T) => boolean): T[][] {
  const order = groups.flat().filter((p) => !leaves(p));
  return cut(order, switchSizes(order.length));
}

/** A new pair's player: their current Elo and whether they have a rated match (a substitute appearance counts). */
export interface PlacementPlayer {
  readonly elo: number;
  readonly rated: boolean;
}

/** A new pair's placement rating: the average of its players' Elo, each without a rated match 100 lower (spec 10 step 1). */
export function placementRating(a: PlacementPlayer, b: PlacementPlayer): number {
  const own = (p: PlacementPlayer) => p.elo - (p.rated ? 0 : UNRATED_DISCOUNT);
  return (own(a) + own(b)) / 2;
}

/** A new pair and its placement rating. */
export interface NewPair<T> {
  readonly pair: T;
  readonly rating: number;
}

/**
 * Places the new pairs (late entries, re-formed pairs) into the groups of the
 * continuing pairs. INTERIM (Peter, 2026-11-05): the placement policy of spec
 * 10 steps 2–4 (target group, free spot, push-down) is under discussion and
 * may change, so until it is decided every new pair goes to the bottom,
 * highest placement rating first (ties in entry order), and the groups are
 * re-cut top-down to the section 4 sizes: the bottom group's free spots fill
 * first, then the bottom groups are cut again. This is the one function the
 * decided rule replaces. Returns new groups; the input is unchanged.
 */
export function placeNewPairs<T>(groups: readonly (readonly T[])[], newPairs: readonly NewPair<T>[]): T[][] {
  if (newPairs.length === 0) return groups.map((g) => [...g]);
  const order = [...groups.flat(), ...[...newPairs].sort((a, b) => b.rating - a.rating).map((n) => n.pair)];
  return cut(order, switchSizes(order.length));
}

export interface RoundSwitchInput<T extends SeedablePair> {
  /** The ending phase's final tables, top group first, each in table order (withdrawn pairs left out). */
  readonly tables: readonly (readonly T[])[];
  /** Whether this is a fast-calibration switch (isFastSwitch). */
  readonly fast: boolean;
  /** Pairs of the tables that leave after promotion and relegation: a 3rd strike, dissolved, taken out. */
  readonly leaves: (pair: T) => boolean;
  /** New pairs (late entries, re-formed pairs), in entry order: it breaks rating ties. */
  readonly newPairs: readonly NewPair<T>[];
}

/**
 * The next phase's draft groups (spec 10): promotion and relegation of the
 * ending phase's tables, the leavers removed and the groups re-cut top-down,
 * then the new pairs placed (placeNewPairs).
 * Each group comes out by seed: average Elo, strongest first (ties keep the
 * order above). Top group first.
 */
export function roundSwitchDraft<T extends SeedablePair>(input: RoundSwitchInput<T>): T[][] {
  const continuing = recut(promoteAndRelegate(input.tables, input.fast), input.leaves);
  return placeNewPairs(continuing, input.newPairs).map((g) => seedOrder(g));
}
