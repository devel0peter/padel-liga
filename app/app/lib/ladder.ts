// The public ladder (#30, spec sections 4, 9 and 14): the phase's groups
// top-down in division bands, each group's table from the rules engine and
// its matches this week. Pure (no I/O): the loader (ladder.server.ts) hands
// in what is stored. Names only: nothing here can carry an email or phone.

import {
  type Day,
  type Division,
  DIVISIONS,
  DIVISION_NAMES,
  divisionOf,
  groupStandings,
  type GroupMatch,
  type MatchOutcome,
  type MatchScore,
  validateScore,
} from "@padel-liga/rules";

import { fixtureWeeks, moveZones, type FixtureWeek, type Zone } from "./fixtures";

const divisionLabel = (division: Division) => `${DIVISION_NAMES[division]} divízió`;

/**
 * A pair as the ladder shows it: the two players' names and the pair's rating
 * for the last tiebreak. `withdrawn`: taken out mid-phase (#34, rules 2).
 */
export type LadderPair = {
  id: number;
  names: [string, string];
  elo: number;
  withdrawn?: boolean;
};

/**
 * A group match. `scheduledAt` and `outcome` are null until the match is
 * agreed or played; `outcome` is the counted one (countedOutcome). `status`
 * is the stored one (matches.status), for the fixture list's state.
 */
export type LadderMatch = {
  id: number;
  a: number;
  b: number;
  week: number;
  status: string;
  scheduledAt: Date | null;
  outcome: MatchOutcome | null;
};

/** A stored group; `pairs` in seed order (strongest first). */
export type LadderGroupInput = {
  id: number;
  number: number;
  pairs: LadderPair[];
  matches: LadderMatch[];
};

/** A table row as groupTable computes it (the rules engine's numbers). */
export type TableRow = {
  rank: number;
  /** The pair's profile is /pairs/<pairId> (#36), linked for members only (D112): the one id on the page. */
  pairId: number;
  matches: number;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  points: number;
  setDiff: number;
  gameDiff: number;
};

export type LadderRow = TableRow & { names: [string, string]; zone: Zone; mine: boolean };

export type LadderGroup = {
  number: number;
  /** The viewer's pair is in it (D136). */
  mine: boolean;
  /** False before any final result: the order is only the seeding (D85). */
  ranked: boolean;
  rows: LadderRow[];
  /** Every match of the group by week (D133); no database id leaves the server. */
  weeks: FixtureWeek[];
  /** Pairs withdrawn mid-phase: out of the table, with all of their matches. */
  withdrawn: [string, string][];
};

export type LadderBand = {
  division: Division;
  label: string;
  groups: LadderGroup[];
};

/**
 * The outcome a match counts with (#186, #220): only a `final` match's, so a
 * result waiting for the other pair or disputed stays out of every table
 * whatever outcome is stored on the match. The one rule for both callers of
 * groupTable: the public league page and the Kezdőlap card.
 */
export function countedOutcome(m: { status: string; outcome: MatchOutcome | null }): MatchOutcome | null {
  return m.status === "final" ? m.outcome : null;
}

const isPair = (x: unknown) => Array.isArray(x) && x.length === 2;

/**
 * Whether a stored outcome is one a table can count (#190, D115): a known
 * kind, a walkover with its winner, a played match with a valid score. Every
 * write is validated, so a bad one means a bug or a hand edit; the rules engine
 * throws on it, and the public league page skips the match instead of failing.
 */
export function isValidOutcome(outcome: unknown): outcome is MatchOutcome {
  if (!outcome || typeof outcome !== "object") return false;
  const o = outcome as { kind?: unknown; winner?: unknown; score?: unknown };
  switch (o.kind) {
    case "both-inactive":
    case "unplayed":
      return true;
    case "walkover":
      return o.winner === "a" || o.winner === "b";
    case "played": {
      const score = o.score as { sets?: unknown; superTieBreak?: unknown } | null | undefined;
      if (!score || typeof score !== "object" || !Array.isArray(score.sets) || !score.sets.every(isPair)) return false;
      // null is no super tie-break, as validateScore reads it.
      if (score.superTieBreak != null && !isPair(score.superTieBreak)) return false;
      return validateScore(score as MatchScore).ok;
    }
    default:
      return false;
  }
}

/**
 * One group's table, from the final outcomes only (matches without an outcome
 * are left out). The one standing computation of the public ladder and of the
 * player's own group card on Kezdőlap (#201): same order, same numbers. A pair
 * withdrawn mid-phase (#34, rules 2) is left out with all of its matches.
 */
export function groupTable(
  pairs: readonly { id: number; elo: number; withdrawn?: boolean }[],
  matches: readonly { a: number; b: number; outcome: MatchOutcome | null }[],
): TableRow[] {
  const decided: GroupMatch[] = matches.flatMap((m) => (m.outcome ? [{ a: String(m.a), b: String(m.b), outcome: m.outcome }] : []));
  return groupStandings(
    pairs.map((p) => ({
      id: String(p.id),
      elo: p.elo,
      withdrawn: !!p.withdrawn,
    })),
    decided,
  ).map((r) => ({
    pairId: Number(r.id),
    rank: r.rank,
    matches: r.matches,
    wins: r.wins,
    losses: r.losses,
    setsWon: r.setsWon,
    setsLost: r.setsLost,
    gamesWon: r.gamesWon,
    gamesLost: r.gamesLost,
    points: r.points,
    setDiff: r.setDiff,
    gameDiff: r.gameDiff,
  }));
}

/** Whether any match of a table counts yet: before that the order is only the seeding (D85). */
export const isRanked = (rows: readonly { matches: number }[]) => rows.some((r) => r.matches > 0);

/**
 * The ladder of one phase: bands top-down (empty ones left out), each with
 * its groups' tables and fixture lists. `week` (1–3) is the week marked as
 * current, or null when none is (the phase hasn't started).
 */
/**
 * `mine`: the viewer's pairs (D136): their sides are marked and their own
 * matches link to the match page. Empty for nobody.
 */
export function buildLadder(
  groups: readonly LadderGroupInput[],
  week: number | null,
  phaseStartsAt: Date,
  mine: ReadonlySet<number> = new Set(),
): LadderBand[] {
  const ordered = [...groups].sort((x, y) => x.number - y.number);
  const bands = new Map<Division, LadderGroup[]>(DIVISIONS.map((d) => [d, []]));
  ordered.forEach((group, index) => {
    const byId = new Map(group.pairs.map((p) => [p.id, p]));
    const names = (id: number) => byId.get(id)!.names;
    const standings = groupTable(group.pairs, group.matches);
    const ranked = isRanked(standings);
    const zones = moveZones(standings.length, index + 1, ordered.length, ranked);
    bands.get(divisionOf(index + 1, ordered.length))!.push({
      number: group.number,
      mine: group.pairs.some((p) => mine.has(p.id) && !p.withdrawn),
      ranked,
      rows: standings.map((r, i) => ({
        ...r,
        names: names(r.pairId),
        zone: zones[i]!,
        mine: mine.has(r.pairId),
      })),
      // A withdrawn pair's matches leave the group (rules 2): fixtureWeeks
      // lists only the matches of the pairs given.
      weeks: fixtureWeeks(
        group.pairs.filter((p) => !p.withdrawn),
        group.matches,
        { phaseStartsAt, currentWeek: week, mine: group.pairs.find((p) => mine.has(p.id))?.id ?? null },
      ),
      withdrawn: group.pairs.filter((p) => p.withdrawn).map((p) => p.names),
    });
  });
  return DIVISIONS.map((division) => ({
    division,
    label: divisionLabel(division),
    groups: bands.get(division)!,
  })).filter((b) => b.groups.length > 0);
}

function dayNumber(day: Day): number {
  return Date.parse(`${day}T00:00:00Z`) / 86_400_000;
}

/**
 * The phase week (1–3) that `today` falls in, from the phase's first day. Before
 * the phase starts it is week 1 and `started` is false; after its last week it
 * stays 3.
 */
export function phaseWeek(phaseStart: Day, today: Day): { week: number; started: boolean } {
  const days = dayNumber(today) - dayNumber(phaseStart);
  if (days < 0) return { week: 1, started: false };
  return { week: Math.min(3, Math.floor(days / 7) + 1), started: true };
}
