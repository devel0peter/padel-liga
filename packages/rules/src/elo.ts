// Elo ratings (spec section 11, szabalyzat section 8): starting values, the
// pair rating and the update after every played match (#13).

import { type Side, validateScore } from "./results";
import type { MatchOutcome } from "./standings";

/** The signup levels (the same keys as the app's level field). */
export type Level = "kezdo" | "kozephalado" | "halado" | "versenyzo";

/** A player's starting Elo from their self-assessed level. */
export const STARTING_ELO: Readonly<Record<Level, number>> = {
  kezdo: 1000,
  kozephalado: 1200,
  halado: 1400,
  versenyzo: 1600,
};

export function isLevel(value: string): value is Level {
  return Object.hasOwn(STARTING_ELO, value);
}

export function startingElo(level: Level): number {
  return STARTING_ELO[level];
}

/**
 * A player's current rating: the stored one once they have a rated match,
 * else the starting value of their level; null without either.
 */
export function currentElo(rating: number | null, level: string | null): number | null {
  if (rating !== null) return rating;
  return level !== null && isLevel(level) ? startingElo(level) : null;
}

/** A pair's rating: the average of its two players' Elo. */
export function pairElo(a: number, b: number): number {
  return (a + b) / 2;
}

/** K is 40 for a player's first this many rated matches, then 20 (spec 11). */
export const NEW_PLAYER_MATCHES = 10;
export const NEW_PLAYER_K = 40;
export const K = 20;

/** A player's K for their next match, from how many rated matches they have played. */
export function playerK(ratedMatches: number): number {
  return ratedMatches < NEW_PLAYER_MATCHES ? NEW_PLAYER_K : K;
}

/** A side's K: the average of its two players' K (40, 30 or 20; D104). */
export function sideK(a: number, b: number): number {
  return (a + b) / 2;
}

/** The chance a pair rated `own` beats one rated `opponent` (400 scale). */
export function expectedScore(own: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - own) / 400));
}

/**
 * The winning side of an outcome that changes Elo, or null: only a played
 * match does. A walkover, both-inactive and unplayed match change nothing.
 */
export function ratedWinner(outcome: MatchOutcome | null): Side | null {
  if (outcome?.kind !== "played") return null;
  const v = validateScore(outcome.score);
  return v.ok ? v.totals.winner : null;
}

/** A side of a rated match: the two players who actually played. */
export type EloSide = readonly [string, string];

/** A played, final match in the order it first became final. */
export interface RatedMatch {
  readonly id: number;
  readonly a: EloSide;
  readonly b: EloSide;
  readonly winner: Side;
}

/** One player's change in one match. */
export interface EloChange {
  readonly matchId: number;
  readonly playerId: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly k: number;
}

export interface EloState {
  /** Each player's rating so far. */
  readonly rating: number;
  /** How many rated matches they have played. */
  readonly matches: number;
}

/**
 * The changes of one match for the four players who played it (a
 * substitute counts as who played, spec 11). Both players of a side get the
 * same delta, K × (result − E), with the side's K and E from the two pairs'
 * average ratings. Not zero-sum when the sides' K differ.
 */
export function matchEloChanges(match: RatedMatch, state: (playerId: string) => EloState): EloChange[] {
  const sides = { a: match.a, b: match.b } as const;
  const rating = (side: Side) => pairElo(state(sides[side][0]).rating, state(sides[side][1]).rating);
  const changes: EloChange[] = [];
  for (const side of ["a", "b"] as const) {
    const other: Side = side === "a" ? "b" : "a";
    const [p, q] = sides[side];
    const k = sideK(playerK(state(p).matches), playerK(state(q).matches));
    const delta = k * ((match.winner === side ? 1 : 0) - expectedScore(rating(side), rating(other)));
    for (const playerId of sides[side]) {
      const before = state(playerId).rating;
      changes.push({ matchId: match.id, playerId, before, after: before + delta, delta, k });
    }
  }
  return changes;
}

/**
 * Every rated match replayed from the starting values, in the order given
 * (the order the matches first became final). An organizer's later ruling
 * keeps the match in its place, so the ratings end up as if the new outcome
 * had been there from the start. Returns each change and each player's
 * final state; players without a rated match are not in `players`.
 */
export function replayElo(
  start: (playerId: string) => number,
  matches: readonly RatedMatch[],
): { changes: EloChange[]; players: Map<string, EloState> } {
  const players = new Map<string, EloState>();
  const state = (id: string): EloState => players.get(id) ?? { rating: start(id), matches: 0 };
  const changes: EloChange[] = [];
  for (const match of matches) {
    const these = matchEloChanges(match, state);
    for (const c of these) players.set(c.playerId, { rating: c.after, matches: state(c.playerId).matches + 1 });
    changes.push(...these);
  }
  return { changes, players };
}
