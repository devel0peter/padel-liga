// First-phase groups (#24, spec section 10, decision log D20-D22).
// Pure (no I/O) so every rule is unit tested; the D1 side is
// groups.server.ts, the seeding and fixtures are in packages/rules.
//
// The system drafts the groups from the approved pairs by average starting
// Elo (ties by approval order); the Szervező moves pairs between groups and
// publishes. Publishing creates the matches, emails every player and locks
// the groups.

import { addDays, budapestDay, groupProblems, groupSizes, type PhaseMatch } from "@padel-liga/rules";

import { formatShortDate } from "./format";

// The first phase of a season: drafted from the entries (#24); every later
// phase comes from a round switch (#35).
export const FIRST_PHASE = 1;

export type PlayerName = { name: string };

// "Kiss Anna – Nagy Béla": a pair's two names, as on the entries page.
export function pairName(players: readonly PlayerName[]): string {
  return players.map((p) => p.name || "Névtelen").join(" – ");
}

// "az 1.", "a 2.", "az 5.", "a 10.": "az" before a number read with a vowel
// (egy, öt, ötven, ötszáz), for "az 1. csoportban".
export function withArticle(n: number): string {
  const vowel = n === 1 || n === 5 || (n >= 50 && n < 60) || (n >= 500 && n < 600);
  return `${vowel ? "az" : "a"} ${n}.`;
}

const elo = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 1 });

// "1287,5": an Elo with a decimal comma.
export function formatElo(value: number): string {
  return elo.format(value);
}

// A group's average pair Elo, null for an empty group.
export function groupAverage(pairs: readonly { averageElo: number }[]): number | null {
  return pairs.length === 0 ? null : pairs.reduce((sum, p) => sum + p.averageElo, 0) / pairs.length;
}

// Why there is no draft: the entered pairs can't be split into groups of 3
// and 4 (0, 1, 2 or 5 pairs). Null when they can.
export function cannotSplit(pairCount: number): string | null {
  if (groupSizes(pairCount)) return null;
  const pairs = pairCount === 0 ? "Még nincs nevezett pár" : `${pairCount} nevezett pár van`;
  return `${pairs}. Csoportot 3, 4 vagy legalább 6 párból lehet összeállítani.`;
}

// The size warning on a group card, or null when it can be published.
export function sizeWarning(size: number): string | null {
  return groupProblems([size]).length === 0 ? null : `${size} pár: egy csoportban 3 vagy 4 pár lehet.`;
}

// Whether the draft still holds exactly the pairs that should be in it: the
// entered, active pairs. A pair entered, taken out or dissolved since the
// draft was made (or a pair in two groups) makes it stale.
export function draftIsStale(draftPairIds: readonly number[], eligiblePairIds: readonly number[]): boolean {
  if (draftPairIds.length !== eligiblePairIds.length) return true;
  const eligible = new Set(eligiblePairIds);
  return new Set(draftPairIds).size !== draftPairIds.length || draftPairIds.some((id) => !eligible.has(id));
}

export const STALE_DRAFT = "A nevezett párok változtak a javaslat óta. Generáld újra.";
export const BAD_SIZES = "Minden csoportban 3 vagy 4 pár legyen. Helyezz át párokat, vagy generáld újra.";

// What keeps a draft from being published, or null.
export function publishBlocker(draft: { sizes: readonly number[]; stale: boolean }): string | null {
  if (draft.stale) return STALE_DRAFT;
  if (groupProblems(draft.sizes).length > 0) return BAD_SIZES;
  return null;
}

// Monday to Sunday of a phase's week (1–3), as Budapest days.
export function weekDays(phaseStartsAt: Date, week: number): { start: string; end: string } {
  const start = addDays(budapestDay(phaseStartsAt), 7 * (week - 1));
  return { start, end: addDays(start, 6) };
}

// "nov. 9. – nov. 15."
export function weekRange(phaseStartsAt: Date, week: number): string {
  const { start, end } = weekDays(phaseStartsAt, week);
  // Noon UTC is the same calendar day in Budapest.
  const at = (day: string) => formatShortDate(new Date(`${day}T12:00:00Z`));
  return `${at(start)} – ${at(end)}`;
}

export type WeekPlan<T> = { week: number; opponent: T | null };

// A pair's three weeks: its opponent each week, or null when it rests (a
// group of 3). From the phase's matches as phaseMatches gives them.
export function pairWeeks<T>(matches: readonly Pick<PhaseMatch<T>, "week" | "a" | "b">[], pair: T, weeks = 3): WeekPlan<T>[] {
  return Array.from({ length: weeks }, (_, i) => {
    const m = matches.find((x) => x.week === i + 1 && (x.a === pair || x.b === pair));
    return { week: i + 1, opponent: m ? (m.a === pair ? m.b : m.a) : null };
  });
}
