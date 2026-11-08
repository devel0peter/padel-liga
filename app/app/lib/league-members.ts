// A league's players (D128, #331; replaces D93's interest-list rule). An
// account belongs to the leagues it joined (league_members) and to every
// league it has a pair in; to no other. Pure parts: the register button's
// league in the address, and which leagues the Kezdőlap card offers. The D1
// side is league-members.server.ts.

import { isWaiting, seasonEnd, type Season } from "./seasons";

// The query parameter the landing page's register button carries
// (`/register?league=<slug>`), kept through login, Google and the
// first-login page inside `returnTo`.
export const LEAGUE_PARAM = "league";

// The Kezdőlap card for an account in no league, and Párod without a league.
export const CHOOSE_LEAGUE_TITLE = "Melyik ligában játszol?";
export const CHOOSE_LEAGUE_TEXT = "Válaszd ki a ligádat, és utána párt is találsz, nevezni is tudsz.";
export const CHOOSE_LEAGUE_BUTTON = "Csatlakozom";
// The same card for a logged-in visitor who came through a league's register
// button: that league only.
export const OFFER_LEAGUE_TITLE = "Csatlakozol a ligához?";
export const OFFER_LEAGUE_TEXT = "Ennek a ligának a gombjával jöttél. Ha itt játszol, csatlakozz, és párt is találsz, nevezni is tudsz.";
export const NO_LEAGUE_TEXT = "Még nem csatlakoztál egyik ligához sem. Itt választhatsz:";

// How they joined (league_members.source).
export type JoinSource = "register" | "link" | "chosen" | "pair" | "entry" | "carried";

// A league slug as the address may carry it, or null. Only the shape: the
// server checks that such a league exists.
export function parseLeagueParam(value: string | null | undefined): string | null {
  return value && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value) ? value : null;
}

// `returnTo` with the league added, so whatever page the player lands on
// after logging in (or after the first-login page) still knows it.
export function withLeague(returnTo: string, slug: string): string {
  const url = new URL(returnTo, "http://x");
  url.searchParams.set(LEAGUE_PARAM, slug);
  return url.pathname + url.search + url.hash;
}

// The league a (safe, local) `returnTo` carries, or null.
export function leagueOfReturnTo(returnTo: string): string | null {
  try {
    return parseLeagueParam(new URL(returnTo, "http://x").searchParams.get(LEAGUE_PARAM));
  } catch {
    return null;
  }
}

export type JoinableLeague = { id: number; city: string; cityName: string; name: string };

// "Melyik ligában játszol?": the leagues (of listed cities, as given) with a
// season open for entries or running: registration opened and the last phase
// not over, or a first season waiting for its minimum entries (D124: open
// for entries, no phases yet). By city name, then league name.
export function joinableLeagues(
  leagues: readonly JoinableLeague[],
  seasons: readonly (Pick<Season, "leagueId" | "registrationOpensAt" | "phases"> & Partial<Pick<Season, "firstPhaseStart">>)[],
  now: Date,
): JoinableLeague[] {
  const live = new Set(
    seasons
      .filter((s) => {
        if (s.registrationOpensAt > now) return false;
        if (isWaiting(s)) return true;
        const end = seasonEnd(s);
        return end !== null && end >= now;
      })
      .map((s) => s.leagueId),
  );
  return leagues
    .filter((l) => live.has(l.id))
    .sort((a, b) => a.cityName.localeCompare(b.cityName, "hu") || a.name.localeCompare(b.name, "hu"));
}
