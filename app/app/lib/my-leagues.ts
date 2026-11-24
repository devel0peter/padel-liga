// Ligáim (#394): the player's leagues, one card each. Pure: the loader
// (my-leagues.server.ts) hands in what is stored and what the Tabella
// computes, so the card's numbers are the Tabella's own. Names only: nothing
// here carries an email or phone.

import { formatDeadline, formatOnDate, formatShortDate } from "./format";
import { withArticle } from "./groups";
import type { LadderBand } from "./ladder";
import { WAITING_START } from "./season-entries";
import type { StoredPhase } from "./seasons";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The card's round line: the round being played with its dates and deadline;
 * between rounds (or before the season) when the next one starts; a first
 * season waiting for its minimum entries (D124); or the season is over.
 */
export type RoundInfo =
  | { kind: "running"; round: number; from: string; to: string; deadline: string }
  | { kind: "next"; round: number; startsOn: string }
  | { kind: "waiting"; text: string }
  | { kind: "over" }
  | { kind: "none" };

/**
 * `phases`: the season's rounds; `waiting`: the waiting text of a first
 * season with no start yet (D124), else null. No season: "none".
 */
export function roundInfo(season: { phases: readonly StoredPhase[]; waiting: string | null } | null, now: Date): RoundInfo {
  if (!season) return { kind: "none" };
  if (season.waiting !== null) return { kind: "waiting", text: season.waiting };
  const running = season.phases.find((p) => p.startsAt <= now && now <= p.deadline);
  if (running)
    return {
      kind: "running",
      round: running.number,
      from: formatShortDate(running.startsAt),
      to: formatShortDate(running.deadline),
      deadline: formatDeadline(running.deadline),
    };
  const next = [...season.phases].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).find((p) => p.startsAt > now);
  if (next) return { kind: "next", round: next.number, startsOn: formatOnDate(next.startsAt) };
  return { kind: "over" };
}

/** "A 2. kör december 7-én indul." */
export const nextRoundText = (r: Extract<RoundInfo, { kind: "next" }>) => `${capitalize(withArticle(r.round))} kör ${r.startsOn} indul.`;

/**
 * The league in numbers, for the round the Tabella shows: its pairs (a pair
 * withdrawn mid-round is out, as in the tables), its groups, and its matches
 * with a final result out of all of them (the Tabella's fixture lists).
 */
export type LeagueSummary = { round: number; pairs: number; groups: number; played: number; total: number };

export function leagueSummary(round: number, bands: readonly LadderBand[]): LeagueSummary {
  const groups = bands.flatMap((b) => b.groups);
  const matches = groups.flatMap((g) => g.weeks.flatMap((w) => w.matches));
  return {
    round,
    pairs: groups.reduce((n, g) => n + g.rows.length, 0),
    groups: groups.length,
    played: matches.filter((m) => m.state === "final").length,
    total: matches.length,
  };
}

/** The viewer's group in the Tabella's round, and its place there; `rank` null before any final result (D85). */
export type OwnPlace = { group: number; rank: number | null };

export function ownPlace(bands: readonly LadderBand[]): OwnPlace | null {
  for (const band of bands)
    for (const group of band.groups) {
      if (!group.mine) continue;
      const row = group.rows.find((r) => r.mine);
      return { group: group.number, rank: group.ranked && row ? row.rank : null };
    }
  return null;
}

/** "A 3. csoportban vagytok, most 2. helyen"; before any final result only the group. */
export function placeText(p: OwnPlace): string {
  const group = `${capitalize(withArticle(p.group))} csoportban vagytok`;
  return p.rank === null ? group : `${group}, most ${p.rank}. helyen`;
}

/** "A 2. körben kezdtek (dec. 7.)"; in a first season with no start yet, without a date. */
export function startsText(round: number, startsAt: Date | null): string {
  const text = `${capitalize(withArticle(round))} körben kezdtek`;
  return startsAt ? `${text} (${formatShortDate(startsAt)})` : `${text}. ${WAITING_START}`;
}

export const NOT_ENTERED = "Nem neveztetek";
export const NO_PAIR = "Nincs párod";
export const INVITE_PARTNER = "Hívd meg a párodat";
export const NOT_PUBLISHED = "Még nincsenek kint a csoportok.";

/** The player's own season so far: final matches, wins, and the Élő-pont now (null without a level). */
export type OwnSeason = { matches: number; wins: number; elo: number | null };

/** A card's order key: the season's first day (a waiting first season is the newest); no season last. */
export function seasonOrder(season: { phases: readonly StoredPhase[]; waiting: string | null } | null): number {
  if (!season) return -Infinity;
  if (season.waiting !== null || season.phases.length === 0) return Infinity;
  return Math.min(...season.phases.map((p) => p.startsAt.getTime()));
}

/** Newest season first (#394); equal ones by league name. */
export function newestFirst<T extends { order: number; league: { name: string } }>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => (b.order === a.order ? a.league.name.localeCompare(b.league.name, "hu") : b.order > a.order ? 1 : -1));
}

