// Public pair and player profiles (#36, spec sections 11, 14 and 17). Pure:
// profiles.server.ts reads the database and hands in what is stored. Names,
// results and ratings only: nothing here can carry an email or phone.

import { DIVISION_NAMES, divisionOf, type MatchOutcome, type Side } from "@padel-liga/rules";

import { DELETED_NAME } from "./account-deletion";
import { signed } from "./format";
import { countedOutcome, groupTable } from "./ladder";
import { MATCH_LOST_BOTH_TEXT, scoreText, winnerOf } from "./results";

/** A player as a profile names them: a deleted or anonymized account has no profile and no old name. */
export type ProfilePerson = { id: string; name: string; deleted: boolean };

export function personView(p: { id: string; name: string | null; deletedAt: Date | null }): ProfilePerson {
  if (p.deletedAt) return { id: p.id, name: DELETED_NAME, deleted: true };
  return { id: p.id, name: p.name || "Névtelen", deleted: false };
}

/** Where a player links: their profile, or nowhere for a deleted account. */
export const playerPath = (p: ProfilePerson) => (p.deleted ? null : `/players/${p.id}`);
export const pairPath = (pairId: number) => `/pairs/${pairId}`;

/** A pair named on a profile: its two players and its page. */
export type ProfilePair = { id: number; players: [ProfilePerson, ProfilePerson] };

export const pairName = (p: ProfilePair) => `${p.players[0].name} – ${p.players[1].name}`;

/** A published group a pair played in, with what its table needs. */
export type GroupInput = {
  id: number;
  season: string;
  phase: number;
  number: number;
  /** The group's place among the phase's published groups (1 = top) and their count: the division. */
  position: number;
  groupCount: number;
  startsAt: Date;
  /** The group's pairs: their rating for the tiebreak, withdrawn mid-phase (#34). */
  pairs: { id: number; elo: number; withdrawn: boolean }[];
  matches: { a: number; b: number; status: string; outcome: MatchOutcome | null }[];
};

export type GroupHistoryRow = {
  season: string;
  phase: number;
  group: number;
  /** "Bronz divízió" */
  division: string;
  /** The pair's place in the table now, "2. hely"; null before the phase starts or when withdrawn. */
  place: number | null;
  withdrawn: boolean;
};

/**
 * The pair's groups, newest phase first: season, round, group, division and
 * its place in that group's table. The table is groupTable, the public league
 * page's own computation, so the place is the same there (final results
 * only, D80; withdrawn pairs left out, D87).
 */
export function groupHistory(pairId: number, groups: readonly GroupInput[], now: Date): GroupHistoryRow[] {
  return [...groups]
    .sort((x, y) => y.startsAt.getTime() - x.startsAt.getTime() || y.phase - x.phase)
    .map((g) => {
      const withdrawn = g.pairs.find((p) => p.id === pairId)?.withdrawn ?? false;
      let place: number | null = null;
      if (!withdrawn && g.startsAt <= now) {
        const table = groupTable(
          g.pairs,
          g.matches.map((m) => ({ a: m.a, b: m.b, outcome: countedOutcome(m) })),
        );
        place = table.find((r) => r.pairId === pairId)?.rank ?? null;
      }
      return {
        season: g.season,
        phase: g.phase,
        group: g.number,
        division: `${DIVISION_NAMES[divisionOf(g.position, g.groupCount)]} divízió`,
        place,
        withdrawn,
      };
    });
}

/** A final match of a pair, as stored. */
export type ProfileMatchInput = {
  id: number;
  season: string;
  phase: number;
  /** The phase's first day: orders the matches. */
  startsAt: Date;
  week: number;
  scheduledAt: Date | null;
  status: string;
  outcome: MatchOutcome | null;
  a: ProfilePair;
  b: ProfilePair;
  /** Either pair was withdrawn from the group mid-phase (#34): the match counts in no table. */
  withdrawn: boolean;
};

/** A player's Elo change in a match (elo_changes). */
export type EloChangeInput = { matchId: number; before: number; after: number; delta: number; at: Date };

export type ProfileMatchView = {
  /** "2026/27 tél, 1. kör, 2. hét" */
  when: string;
  /** "nov. 10." when a time was agreed. */
  date: string | null;
  opponents: ProfilePair;
  /** "Győzelem", "Vereség" */
  verdict: string;
  /** From the pair's side: "4:1, 2:4, szuper tie-break 10:8", "Játék nélküli győzelem (4:0, 4:0)". */
  result: string;
  /** "Visszalépés miatt nem számít a tabellába." */
  note: string | null;
  /** The player's Elo change, on a player profile: "+12", and the rating after it. */
  elo: { delta: string; after: number } | null;
};

function sideText(outcome: MatchOutcome, side: Side): { verdict: string; result: string } | null {
  switch (outcome.kind) {
    case "played":
      return { verdict: winnerOf(outcome) === side ? "Győzelem" : "Vereség", result: scoreText(outcome.score, side) };
    case "walkover":
      return outcome.winner === side
        ? { verdict: "Győzelem", result: "Játék nélkül (4:0, 4:0)" }
        : { verdict: "Vereség", result: "Játék nélkül (0:4, 0:4)" };
    case "both-inactive":
      return { verdict: "Vereség", result: MATCH_LOST_BOTH_TEXT };
    case "unplayed":
      return null;
  }
}

/** A rating as profiles show it: rounded (spec 11). */
export const shownElo = (rating: number) => Math.round(rating);

/**
 * The final matches of the pairs in `ownPairs`, newest first, from their own
 * side. Only a final outcome counts (countedOutcome, D80): a result waiting
 * for the other pair or disputed is not listed; an unplayed match has no
 * result and is left out, like on the league page. `elo`: the player's
 * changes by match, for a player profile.
 */
export function matchViews(
  ownPairs: ReadonlySet<number>,
  list: readonly ProfileMatchInput[],
  formatDate: (d: Date) => string,
  elo: ReadonlyMap<number, EloChangeInput> = new Map(),
): ProfileMatchView[] {
  const views: { order: number[]; view: ProfileMatchView }[] = [];
  for (const m of list) {
    const outcome = countedOutcome(m);
    const side: Side | null = ownPairs.has(m.a.id) ? "a" : ownPairs.has(m.b.id) ? "b" : null;
    if (!outcome || !side) continue;
    const text = sideText(outcome, side);
    if (!text) continue;
    const change = elo.get(m.id);
    views.push({
      order: [m.startsAt.getTime(), m.week, m.scheduledAt?.getTime() ?? 0, m.id],
      view: {
        when: `${m.season}, ${m.phase}. kör, ${m.week}. hét`,
        date: m.scheduledAt ? formatDate(m.scheduledAt) : null,
        opponents: side === "a" ? m.b : m.a,
        ...text,
        note: m.withdrawn ? "Visszalépés miatt nem számít a tabellába." : null,
        elo: change ? { delta: signed(Math.round(change.delta)), after: shownElo(change.after) } : null,
      },
    });
  }
  // Newest first: phase start, week, agreed time, id.
  const later = (x: number[], y: number[]) => y.reduce((d, v, i) => d || v - x[i]!, 0);
  return views.sort((x, y) => later(x.order, y.order)).map((v) => v.view);
}

/**
 * The points of the Elo chart, oldest first: the rating before the first
 * rated match, then after each one (elo_changes in replay order).
 */
export function eloSeries(changes: readonly EloChangeInput[]): number[] {
  const ordered = [...changes].sort((x, y) => x.at.getTime() - y.at.getTime() || x.matchId - y.matchId);
  if (ordered.length === 0) return [];
  return [ordered[0]!.before, ...ordered.map((c) => c.after)];
}
