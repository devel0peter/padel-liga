// The profile level and the Élő-pont (#135). Pure.
//
// The level is the player's own guess and only sets the starting rating
// (szabályzat section 8). Once they took part in a season the league's
// results decide, so the level is locked (spec section 3).

import { currentElo } from "@padel-liga/rules";

export const LEVEL_LOCKED_NOTE =
  "A szinted lezárult: mostantól a liga eredményei döntik el, hol tartasz. Ezt az Élő-pontod mutatja.";
export const LEVEL_LOCKED_ERROR = "A szintedet már nem módosíthatod: a liga eredményei döntik el.";

// The Élő-pont to show, rounded: the rating from the player's played
// matches (#13), before the first one the starting value of the level. Null
// without either.
export function ratingFor(level: string | null | undefined, elo: number | null = null): number | null {
  const rating = currentElo(elo, level ?? null);
  return rating === null ? null : Math.round(rating);
}

// Which level the profile form may save. A locked level stays as it is: the
// form doesn't send it, and a hand-made post that tries another one is
// refused. `submitted` is the raw form value (null when the field is absent).
export function resolveLevel(opts: {
  locked: boolean;
  stored: string | null;
  submitted: unknown;
}): { ok: true; level: unknown } | { ok: false; error: string } {
  if (!opts.locked) return { ok: true, level: opts.submitted };
  if (opts.submitted != null && opts.submitted !== "" && opts.submitted !== opts.stored) {
    return { ok: false, error: LEVEL_LOCKED_ERROR };
  }
  return { ok: true, level: opts.stored };
}
