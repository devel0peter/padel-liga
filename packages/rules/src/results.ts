// Match results (spec section 7, rules section 4; walkovers spec section 8).
// Best of 2 short sets: a set goes to 4 games, win by 2 (so 4-3 plays on to 5-3 or
// 4-4); at 4-4 a tie-break to 7 decides it, so the set ends 5-4. At 1-1 in sets a super tie-break to 10 (win by 2)
// replaces the third set. Only the final result is recorded.

/** Games (or tie-break points) of the two sides, in the order [a, b]. */
export type Score = readonly [number, number];

/** A result as the players record it: the two sets in games, plus the super tie-break at 1-1. */
export interface MatchScore {
  readonly sets: readonly Score[];
  readonly superTieBreak?: Score;
}

export type Side = "a" | "b";

/** Sets and games per side, ready for the standings (spec 7: super tie-break = 1 set and a 1-0 game). */
export interface MatchTotals {
  readonly winner: Side;
  readonly sets: Score;
  readonly games: Score;
}

export type ResultErrorKind =
  | "not-a-number"
  | "missing-set"
  | "third-set"
  | "invalid-set"
  | "missing-super-tie-break"
  | "unneeded-super-tie-break"
  | "invalid-super-tie-break";

export interface ResultError {
  readonly kind: ResultErrorKind;
  /** 1-based set number for "invalid-set" and "not-a-number" on a set. */
  readonly set?: number;
  /** Short Hungarian message for the player. */
  readonly message: string;
}

export type ScoreValidation =
  | { readonly ok: true; readonly totals: MatchTotals }
  | { readonly ok: false; readonly errors: readonly ResultError[] };

export const SET_GAMES = 4;
export const SUPER_TIE_BREAK_POINTS = 10;

const isCount = (n: number) => Number.isInteger(n) && n >= 0;
const show = ([a, b]: Score) => `${a}:${b}`;

/**
 * A finished short set (either side): 4-0, 4-1, 4-2; 5-3 after 4-3 (win by 2); or 5-4
 * after the tie-break at 4-4.
 */
export function isValidSet([a, b]: Score): boolean {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === SET_GAMES) return lo <= SET_GAMES - 2;
  return hi === SET_GAMES + 1 && (lo === SET_GAMES - 1 || lo === SET_GAMES);
}

/** A finished super tie-break: 10 points, win by 2 (10-8, 11-9, 12-10 ...). */
export function isValidSuperTieBreak([a, b]: Score): boolean {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === SUPER_TIE_BREAK_POINTS) return lo <= SUPER_TIE_BREAK_POINTS - 2;
  return hi > SUPER_TIE_BREAK_POINTS && hi - lo === 2;
}

const winnerOf = ([a, b]: Score): Side => (a > b ? "a" : "b");

/**
 * Checks a recorded result against the league format and, when it is valid, turns it
 * into sets and games per side. Returns every problem found, each with its own message.
 */
export function validateScore(score: MatchScore): ScoreValidation {
  const errors: ResultError[] = [];
  const { sets, superTieBreak } = score;

  if (sets.length < 2) {
    errors.push({ kind: "missing-set", message: "Mindkét szett eredményét add meg." });
  } else if (sets.length > 2) {
    errors.push({ kind: "third-set", message: "Harmadik szett nincs: 1:1-nél szuper tie-break dönt." });
  }

  sets.slice(0, 2).forEach((set, i) => {
    if (!set.every(isCount)) {
      errors.push({ kind: "not-a-number", set: i + 1, message: `${i + 1}. szett: a játékok száma 0 vagy pozitív egész szám.` });
    } else if (!isValidSet(set)) {
      errors.push({
        kind: "invalid-set",
        set: i + 1,
        message: `${i + 1}. szett: ${show(set)} nem lehet. Lehet 4:0, 4:1, 4:2, 5:3 vagy (tie-break után) 5:4.`,
      });
    }
  });
  if (errors.length > 0) return { ok: false, errors };

  const [first, second] = sets as readonly [Score, Score];
  const split = winnerOf(first) !== winnerOf(second);

  if (!split && superTieBreak) {
    return { ok: false, errors: [{ kind: "unneeded-super-tie-break", message: "2:0-s szettállásnál nincs szuper tie-break." }] };
  }
  if (split && !superTieBreak) {
    return { ok: false, errors: [{ kind: "missing-super-tie-break", message: "1:1-es szettállásnál add meg a szuper tie-break eredményét." }] };
  }
  if (superTieBreak && !superTieBreak.every(isCount)) {
    return { ok: false, errors: [{ kind: "not-a-number", message: "Szuper tie-break: a pontok száma 0 vagy pozitív egész szám." }] };
  }
  if (superTieBreak && !isValidSuperTieBreak(superTieBreak)) {
    return {
      ok: false,
      errors: [
        {
          kind: "invalid-super-tie-break",
          message: `Szuper tie-break: ${show(superTieBreak)} nem lehet. 10 pontig tart, 2 pont különbséggel (pl. 10:8, 11:9).`,
        },
      ],
    };
  }

  const setsWon = (side: Side) => sets.filter((s) => winnerOf(s) === side).length;
  const gamesWon = (i: 0 | 1) => first[i] + second[i];
  const winner = superTieBreak ? winnerOf(superTieBreak) : winnerOf(first);
  const stbSet: Score = superTieBreak ? (winner === "a" ? [1, 0] : [0, 1]) : [0, 0];

  return {
    ok: true,
    totals: {
      winner,
      sets: [setsWon("a") + stbSet[0], setsWon("b") + stbSet[1]],
      games: [gamesWon(0) + stbSet[0], gamesWon(1) + stbSet[1]],
    },
  };
}

/** Walkover (spec 8): the winner gets 4-0 4-0. */
export function walkoverTotals(winner: Side): MatchTotals {
  return winner === "a"
    ? { winner, sets: [2, 0], games: [2 * SET_GAMES, 0] }
    : { winner, sets: [0, 2], games: [0, 2 * SET_GAMES] };
}

/** Sets and games one side gets when neither side was active (spec 8): 0-4 0-4, a loss for both. */
export const BOTH_INACTIVE_SIDE = { setsWon: 0, setsLost: 2, gamesWon: 0, gamesLost: 2 * SET_GAMES } as const;
