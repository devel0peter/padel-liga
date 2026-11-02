// Group standings (spec section 9, rules section 6).
// Points: win 3, played loss 1, walkover or both-inactive loss 0, unplayed nothing.
// Order: points, head-to-head (2 tied only), set difference, game difference, average Elo.
// With 3+ tied, set difference, game difference and Elo apply in order; as soon as only
// 2 are still tied with each other, head-to-head decides between them.

import { BOTH_INACTIVE_SIDE, type MatchScore, type MatchTotals, type Side, validateScore, walkoverTotals } from "./results";

export const POINTS = { win: 3, playedLoss: 1, walkoverLoss: 0, bothInactiveLoss: 0 } as const;

/** How a group match ended (spec 7 and 8). */
export type MatchOutcome =
  | { readonly kind: "played"; readonly score: MatchScore }
  | { readonly kind: "walkover"; readonly winner: Side }
  /** Neither side active: a 0-4 0-4 loss for both. */
  | { readonly kind: "both-inactive" }
  /** Both active but no agreement: no points, not in set or game difference. */
  | { readonly kind: "unplayed" };

/** A group match between pairs `a` and `b`, by pair id. Matches not yet decided are left out. */
export interface GroupMatch {
  readonly a: string;
  readonly b: string;
  readonly outcome: MatchOutcome;
}

export interface StandingPair {
  readonly id: string;
  /** Average of the two players' current Elo (spec 11), the last tiebreaker. */
  readonly elo: number;
  /** Withdrew mid-phase: left out of the table, with all of its matches (rules 2). */
  readonly withdrawn?: boolean;
}

export interface StandingRow {
  readonly id: string;
  /** 1-based position. */
  readonly rank: number;
  readonly points: number;
  /** Matches that count in the table (played, walkover, both inactive). */
  readonly matches: number;
  readonly wins: number;
  readonly losses: number;
  readonly setsWon: number;
  readonly setsLost: number;
  readonly gamesWon: number;
  readonly gamesLost: number;
  readonly setDiff: number;
  readonly gameDiff: number;
  readonly elo: number;
}

interface Tally {
  points: number;
  matches: number;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
}

/** What each side of a match gets in the table; null when the match doesn't count. */
function sideResults(outcome: MatchOutcome): readonly [Tally, Tally] | null {
  if (outcome.kind === "unplayed") return null;
  if (outcome.kind === "both-inactive") {
    const loss: Tally = { points: POINTS.bothInactiveLoss, matches: 1, wins: 0, losses: 1, ...BOTH_INACTIVE_SIDE };
    return [loss, { ...loss }];
  }
  let totals: MatchTotals;
  let loserPoints: number;
  if (outcome.kind === "walkover") {
    totals = walkoverTotals(outcome.winner);
    loserPoints = POINTS.walkoverLoss;
  } else {
    const v = validateScore(outcome.score);
    if (!v.ok) throw new Error(`Invalid match score: ${v.errors.map((e) => e.kind).join(", ")}`);
    totals = v.totals;
    loserPoints = POINTS.playedLoss;
  }
  const side = (i: 0 | 1): Tally => {
    const won = totals.winner === (i === 0 ? "a" : "b");
    const o = i === 0 ? 1 : 0;
    return {
      points: won ? POINTS.win : loserPoints,
      matches: 1,
      wins: won ? 1 : 0,
      losses: won ? 0 : 1,
      setsWon: totals.sets[i],
      setsLost: totals.sets[o],
      gamesWon: totals.games[i],
      gamesLost: totals.games[o],
    };
  };
  return [side(0), side(1)];
}

const emptyTally = (): Tally => ({ points: 0, matches: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, gamesWon: 0, gamesLost: 0 });

/**
 * Ranks a group of 3 or 4 pairs (any size works). Pairs should be given in seed order:
 * pairs equal on every rule keep that order. Withdrawn pairs and all their matches are
 * left out; unplayed matches give nothing.
 */
export function groupStandings(pairs: readonly StandingPair[], matches: readonly GroupMatch[]): StandingRow[] {
  const known = new Set(pairs.map((p) => p.id));
  if (known.size !== pairs.length) throw new Error("Duplicate pair id in the group");
  for (const m of matches) {
    if (!known.has(m.a) || !known.has(m.b)) throw new Error(`Match ${m.a}-${m.b} has a pair outside the group`);
    if (m.a === m.b) throw new Error(`Pair ${m.a} can't play itself`);
  }

  const active = pairs.filter((p) => !p.withdrawn);
  const activeIds = new Set(active.map((p) => p.id));
  const counted = matches.filter((m) => activeIds.has(m.a) && activeIds.has(m.b));

  const tallies = new Map(active.map((p) => [p.id, emptyTally()]));
  for (const m of counted) {
    const results = sideResults(m.outcome);
    if (!results) continue;
    add(tallies.get(m.a)!, results[0]);
    add(tallies.get(m.b)!, results[1]);
  }

  const rows = active.map((p) => {
    const t = tallies.get(p.id)!;
    return { id: p.id, elo: p.elo, ...t, setDiff: t.setsWon - t.setsLost, gameDiff: t.gamesWon - t.gamesLost };
  });
  const seed = new Map(active.map((p, i) => [p.id, i]));

  type Row = (typeof rows)[number];
  const directWins = (x: Row, y: Row) =>
    counted.filter((m) => {
      if (!((m.a === x.id && m.b === y.id) || (m.a === y.id && m.b === x.id))) return false;
      const r = sideResults(m.outcome);
      return r !== null && r[m.a === x.id ? 0 : 1].wins === 1;
    }).length;

  const tiebreakers: ((r: Row) => number)[] = [(r) => r.setDiff, (r) => r.gameDiff, (r) => r.elo];

  /** Orders pairs already level on points, following spec 9. */
  function breakTie(tied: Row[], from: number): Row[] {
    if (tied.length === 1) return tied;
    if (tied.length === 2) {
      const [x, y] = tied as [Row, Row];
      const diff = directWins(x, y) - directWins(y, x);
      if (diff !== 0) return diff > 0 ? [x, y] : [y, x];
    }
    if (from >= tiebreakers.length) return [...tied].sort((x, y) => seed.get(x.id)! - seed.get(y.id)!);
    const key = tiebreakers[from]!;
    return splitBy(tied, key).flatMap((block) => (block.length === 2 && block.length < tied.length ? breakTie(block, 0) : breakTie(block, from + 1)));
  }

  const ordered = splitBy(rows, (r) => r.points).flatMap((block) => breakTie(block, 0));
  return ordered.map((r, i) => ({ ...r, rank: i + 1 }));
}

function add(t: Tally, r: Tally) {
  t.points += r.points;
  t.matches += r.matches;
  t.wins += r.wins;
  t.losses += r.losses;
  t.setsWon += r.setsWon;
  t.setsLost += r.setsLost;
  t.gamesWon += r.gamesWon;
  t.gamesLost += r.gamesLost;
}

/** Groups rows by a key, highest key first, keeping the input order inside a group. */
function splitBy<R>(rows: readonly R[], key: (r: R) => number): R[][] {
  const groups = new Map<number, R[]>();
  for (const r of rows) {
    const k = key(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  return [...groups.entries()].sort(([a], [b]) => b - a).map(([, g]) => g);
}
