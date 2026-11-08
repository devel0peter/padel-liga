// Pair and player profiles (#36, spec sections 11, 14 and 17; logged-in
// members only, D112). Pure:
// profiles.server.ts reads the database and hands in what is stored. Names,
// results and ratings only: nothing here can carry an email or phone.

import { DIVISION_NAMES, divisionOf, type MatchOutcome, type Side } from "@padel-liga/rules";

import { DELETED_NAME } from "./account-deletion";
import { signed } from "./format";
import { countedOutcome, groupTable } from "./ladder";
import { MATCH_LOST_BOTH_TEXT, scoreText, winnerOf } from "./results";

/**
 * A player as a profile names them. A deleted or anonymized account has no
 * profile, no old name and no id: its account id was public in its old
 * profile's address, so keeping it would tie the anonymized results back to
 * the person (D60).
 */
export type ProfilePerson = { id: string | null; name: string };

export function personView(p: { id: string; name: string | null; deletedAt: Date | null }): ProfilePerson {
  if (p.deletedAt) return { id: null, name: DELETED_NAME };
  return { id: p.id, name: p.name || "Névtelen" };
}

/** Where a player links: their profile, or nowhere for a deleted account. */
export const playerPath = (p: ProfilePerson) => (p.id ? `/players/${p.id}` : null);
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
  /** "Visszalépés miatt nem számít bele a tabellába." */
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
        note: m.withdrawn ? "Visszalépés miatt nem számít bele a tabellába." : null,
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

/** A player's summary on their profile (D136). */
export type PlayerStats = { seasons: number; rounds: number; matches: number; wins: number; losses: number };

/**
 * The summary of a player profile (D136): the seasons and rounds (phases)
 * the player played in, a published group whose phase has started, and the
 * matches with a final result (D80), split into wins and losses. `groups`:
 * one row per group of the player's pairs, `season` unique per league.
 */
export function playerStats(
  groups: readonly { season: string; startsAt: Date }[],
  matches: readonly Pick<ProfileMatchView, "verdict">[],
  now: Date,
): PlayerStats {
  const played = groups.filter((g) => g.startsAt <= now);
  const wins = matches.filter((m) => m.verdict === "Győzelem").length;
  const losses = matches.filter((m) => m.verdict === "Vereség").length;
  return { seasons: new Set(played.map((g) => g.season)).size, rounds: played.length, matches: wins + losses, wins, losses };
}

/** How a former pair ended (#347, D142). */
export type PairEnd = "Felbontva" | "Partnercsere";

/** A former pair on the player's own Profil, "Korábbi párjaid" (#347, D142). */
export type FormerPairView = {
  pairId: number;
  /** The former partner: "Törölt játékos" with no id when deleted or anonymized. */
  partner: ProfilePerson;
  /** The pair's page; none for a deleted or anonymized partner. */
  link: string | null;
  league: string;
  /** "2026/27 tél, 1–2. kör" */
  rounds: string;
  end: PairEnd;
  /** "2026. 11. 08.", Budapest; "" when the pair has no stored end. */
  endedOn: string;
};

// "1–3., 5." from [1, 2, 3, 5]: runs of consecutive rounds as a range.
function roundRuns(phases: readonly number[]): string {
  const sorted = [...new Set(phases)].sort((x, y) => x - y);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    runs.push(j > i ? `${sorted[i]}–${sorted[j]}.` : `${sorted[i]}.`);
    i = j + 1;
  }
  return runs.join(", ");
}

/**
 * The seasons and rounds a pair played in, oldest season first:
 * "2026/27 tél, 1–2. kör; 2027 tavasz, 1. kör". `groups`: one row per
 * published group of the pair.
 */
export function roundsText(groups: readonly { season: string; phase: number; startsAt: Date }[]): string {
  const bySeason = new Map<string, { first: number; phases: number[] }>();
  for (const g of groups) {
    const s = bySeason.get(g.season) ?? { first: g.startsAt.getTime(), phases: [] };
    s.first = Math.min(s.first, g.startsAt.getTime());
    s.phases.push(g.phase);
    bySeason.set(g.season, s);
  }
  return [...bySeason]
    .sort(([, x], [, y]) => x.first - y.first)
    .map(([season, s]) => `${season}, ${roundRuns(s.phases)} kör`)
    .join("; ");
}

/**
 * The pairs a partner change ended (#347, D142): "Partner cseréje" writes a
 * pair.change audit entry whose detail names the old pair, "league:1; from
 * pair:12; user:… -> user:…" (changePartner in pairs.server.ts). Every other
 * end (a dissolve, an account deletion) is "Felbontva".
 */
export function changedPairIds(details: readonly (string | null)[]): Set<number> {
  const ids = new Set<number>();
  for (const d of details) {
    const m = d ? /(?:^|; )from pair:(\d+)(?:;|$)/.exec(d) : null;
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

/** A former pair as stored, with its published groups. */
export type FormerPairInput = {
  pairId: number;
  partner: ProfilePerson;
  league: string;
  dissolvedAt: Date | null;
  groups: readonly { season: string; phase: number; startsAt: Date }[];
};

/**
 * "Korábbi párjaid" (#347, D142): the player's dissolved pairs that played in
 * a published group (one without has no pair page and is left out), the
 * newest ended first. Names only: never a partner's email or phone.
 */
export function formerPairViews(
  list: readonly FormerPairInput[],
  changed: ReadonlySet<number>,
  formatDate: (d: Date) => string,
): FormerPairView[] {
  return list
    .filter((p) => p.groups.length > 0)
    .sort((x, y) => (y.dissolvedAt?.getTime() ?? 0) - (x.dissolvedAt?.getTime() ?? 0) || y.pairId - x.pairId)
    .map((p) => ({
      pairId: p.pairId,
      partner: p.partner,
      link: p.partner.id ? pairPath(p.pairId) : null,
      league: p.league,
      rounds: roundsText(p.groups),
      end: changed.has(p.pairId) ? "Partnercsere" : "Felbontva",
      endedOn: p.dissolvedAt ? formatDate(p.dissolvedAt) : "",
    }));
}
