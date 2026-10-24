// Elo ratings (spec section 11). Only the starting values and the pair rating
// so far; the per-match update is #13.

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

/** A pair's rating: the average of its two players' Elo. */
export function pairElo(a: number, b: number): number {
  return (a + b) / 2;
}
