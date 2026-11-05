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
} from "@padel-liga/rules";

import { formatSlot } from "./format";
import { MATCH_LOST_BOTH_TEXT, neutralScoreText } from "./results";

const divisionLabel = (division: Division) => `${DIVISION_NAMES[division]} divízió`;

/**
 * A pair as the ladder shows it: the two players' names and the pair's rating
 * for the last tiebreak. `withdrawn`: taken out mid-phase (#34, rules 2).
 */
export type LadderPair = { id: number; names: [string, string]; elo: number; withdrawn?: boolean };

/** A group match. `scheduledAt` and `outcome` are null until the match is agreed or played. */
export type LadderMatch = {
  id: number;
  a: number;
  b: number;
  week: number;
  scheduledAt: Date | null;
  outcome: MatchOutcome | null;
};

/** A stored group; `pairs` in seed order (strongest first). */
export type LadderGroupInput = { id: number; number: number; pairs: LadderPair[]; matches: LadderMatch[] };

export type LadderRow = {
  rank: number;
  /** The pair's public profile is /pairs/<pairId> (#36): the one id on the page. */
  pairId: number;
  names: [string, string];
  matches: number;
  points: number;
  setDiff: number;
  gameDiff: number;
};

// No database id: nothing internal goes into the public page's data.
export type LadderMatchView = {
  a: [string, string];
  b: [string, string];
  /** "nov. 10., kedd 18:30", or null when no time is set yet. */
  when: string | null;
  /** "4:2, 4:1", "kontumác", ... or null when the match is not played. */
  result: string | null;
};

export type LadderGroup = {
  number: number;
  rows: LadderRow[];
  /** The matches scheduled for the week shown, played or not. */
  weekMatches: LadderMatchView[];
  /** Every played match of the phase, in week order. */
  results: LadderMatchView[];
  /** Pairs withdrawn mid-phase: out of the table, with all of their matches. */
  withdrawn: [string, string][];
};

export type LadderBand = { division: Division; label: string; groups: LadderGroup[] };

// "4:2, 4:1", "4:1, 3:4, szuper tie-break 10:7": the app's score format (#202).
function scoreText(outcome: MatchOutcome): string | null {
  switch (outcome.kind) {
    case "played":
      return neutralScoreText(outcome.score);
    case "walkover":
      return "kontumác";
    case "both-inactive":
      return MATCH_LOST_BOTH_TEXT;
    case "unplayed":
      return null;
  }
}

/**
 * The outcome a match counts with (#186, #220): only a `final` match's, so a
 * result waiting for the other pair or disputed stays out of every table
 * whatever outcome is stored on the match. The one rule for both callers of
 * groupTable: the public league page and the Kezdőlap card.
 */
export function countedOutcome(m: { status: string; outcome: MatchOutcome | null }): MatchOutcome | null {
  return m.status === "final" ? m.outcome : null;
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
): Omit<LadderRow, "names">[] {
  const decided: GroupMatch[] = matches.flatMap((m) => (m.outcome ? [{ a: String(m.a), b: String(m.b), outcome: m.outcome }] : []));
  return groupStandings(
    pairs.map((p) => ({ id: String(p.id), elo: p.elo, withdrawn: !!p.withdrawn })),
    decided,
  ).map((r) => ({
    pairId: Number(r.id),
    rank: r.rank,
    matches: r.matches,
    points: r.points,
    setDiff: r.setDiff,
    gameDiff: r.gameDiff,
  }));
}

/**
 * The ladder of one phase: bands top-down (empty ones left out), each with
 * its groups. `week` (1–3) picks the matches shown as "this week".
 */
export function buildLadder(groups: readonly LadderGroupInput[], week: number): LadderBand[] {
  const ordered = [...groups].sort((x, y) => x.number - y.number);
  const bands = new Map<Division, LadderGroup[]>(DIVISIONS.map((d) => [d, []]));
  ordered.forEach((group, index) => {
    const byId = new Map(group.pairs.map((p) => [p.id, p]));
    const names = (id: number) => byId.get(id)!.names;
    // A withdrawn pair's matches leave the group (rules 2): not in the
    // table (groupTable drops them), this week's list or the results.
    const counts = (m: LadderMatch) => !byId.get(m.a)?.withdrawn && !byId.get(m.b)?.withdrawn;
    const shown = group.matches.filter(counts);
    const standings = groupTable(group.pairs, group.matches);
    const view = (m: LadderMatch): LadderMatchView => ({
      a: names(m.a),
      b: names(m.b),
      when: m.scheduledAt ? formatSlot(m.scheduledAt) : null,
      result: m.outcome ? scoreText(m.outcome) : null,
    });
    bands.get(divisionOf(index + 1, ordered.length))!.push({
      number: group.number,
      rows: standings.map((r) => ({ ...r, names: names(r.pairId) })),
      weekMatches: shown.filter((m) => m.week === week).map(view),
      // A result is listed once: a played match of the week shown is already
      // under "meccsei" (#202).
      results: [...shown]
        .filter((m) => m.week !== week && m.outcome && scoreText(m.outcome))
        .sort((x, y) => x.week - y.week || x.id - y.id)
        .map(view),
      withdrawn: group.pairs.filter((p) => p.withdrawn).map((p) => p.names),
    });
  });
  return DIVISIONS.map((division) => ({ division, label: divisionLabel(division), groups: bands.get(division)! })).filter(
    (b) => b.groups.length > 0,
  );
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
