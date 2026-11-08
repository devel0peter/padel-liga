// A group's fixture list (docs/player-ui.md section 3, D133): every match by
// week, each with its state, its time or its score and who won. One builder
// for the public league page and the player's Kezdőlap. Pure (no I/O); the
// loaders hand in what is stored. Names only.

import { DIVISION_NAMES, PHASES_PER_SEASON, divisionOf, type MatchOutcome } from "@padel-liga/rules";

import { formatSlot } from "./format";
import { weekRange } from "./groups";
import { MATCH_LOST_BOTH_TEXT, winnerOf } from "./results";

/**
 * Where a match stands, for lists: "final" counts in the table, "pending" waits
 * for the other pair's confirmation, "disputed" for the organizer,
 * "scheduled" has a fixed time, "open" is still being arranged.
 */
export type FixtureState = "final" | "pending" | "disputed" | "scheduled" | "open";

export type FixtureSide = { names: [string, string]; mine: boolean };

export type FixtureMatch = {
  week: number;
  a: FixtureSide;
  b: FixtureSide;
  state: FixtureState;
  /** "nov. 10., kedd 18:30" once a time is fixed (or the time it was played at). */
  when: string | null;
  venue: string | null;
  /** The sets in a/b order, with the super tie-break, once final and played. */
  sets: [number, number][] | null;
  superTieBreak: [number, number] | null;
  winner: "a" | "b" | null;
  /** A final outcome without a played score: "Játék nélkül", "Mindkét pár vereséget kap", "Elmaradt". */
  note: string | null;
  /** The match page, for the player's own matches only. */
  href: string | null;
};

export type FixtureWeek = {
  week: number;
  /** "nov. 2. – nov. 8." */
  range: string;
  current: boolean;
  matches: FixtureMatch[];
  /** A group of 3: the pair that rests this week. */
  resting: [string, string] | null;
};

export type FixtureInput = {
  id: number;
  a: number;
  b: number;
  week: number;
  /** The stored status (matches.status). */
  status: string;
  scheduledAt: Date | null;
  /** The outcome that counts: only a final match's, and only a valid one (D80, D115). */
  outcome: MatchOutcome | null;
  venue?: string | null;
};

const stateOf = (m: FixtureInput): FixtureState => {
  if (m.outcome) return "final";
  switch (m.status) {
    case "result_pending":
      return "pending";
    case "disputed":
      return "disputed";
    case "scheduled":
      return "scheduled";
    default:
      // "final" without a countable outcome (D115) reads as not played.
      return "open";
  }
};

function noteOf(outcome: MatchOutcome): string | null {
  switch (outcome.kind) {
    case "played":
      return null;
    case "walkover":
      return "Játék nélküli győzelem (4:0, 4:0)";
    case "both-inactive":
      return MATCH_LOST_BOTH_TEXT;
    case "unplayed":
      return "Elmaradt, nem számít";
  }
}

/**
 * The group's matches by week (1–3). `pairs`: the group's pairs that are
 * still in it (a withdrawn pair's matches are left out by the caller).
 * `mine`: the viewer's pair, whose matches get a link. `currentWeek`: the week
 * to mark, or null when none is (before the phase or after it).
 */
export function fixtureWeeks(
  pairs: readonly { id: number; names: [string, string] }[],
  matches: readonly FixtureInput[],
  opts: {
    phaseStartsAt: Date;
    currentWeek: number | null;
    mine?: number | null;
  },
): FixtureWeek[] {
  const byId = new Map(pairs.map((p) => [p.id, p]));
  const side = (id: number): FixtureSide => ({
    names: byId.get(id)?.names ?? ["Névtelen", "Névtelen"],
    mine: id === opts.mine,
  });
  const shown = matches.filter((m) => byId.has(m.a) && byId.has(m.b));
  return [1, 2, 3].map((week) => {
    const list = shown.filter((m) => m.week === week).sort((x, y) => x.id - y.id);
    const playing = new Set(list.flatMap((m) => [m.a, m.b]));
    const idle = pairs.filter((p) => !playing.has(p.id));
    return {
      week,
      range: weekRange(opts.phaseStartsAt, week),
      current: opts.currentWeek === week,
      resting: list.length > 0 && idle.length === 1 ? idle[0]!.names : null,
      matches: list.map((m) => {
        const played = m.outcome?.kind === "played" ? m.outcome.score : null;
        return {
          week,
          a: side(m.a),
          b: side(m.b),
          state: stateOf(m),
          when: m.scheduledAt ? formatSlot(m.scheduledAt) : null,
          venue: m.venue ?? null,
          sets: played ? played.sets.map(([x, y]) => [x, y] as [number, number]) : null,
          superTieBreak: played?.superTieBreak ? [played.superTieBreak[0], played.superTieBreak[1]] : null,
          winner: m.outcome ? winnerOf(m.outcome) : null,
          note: m.outcome ? noteOf(m.outcome) : null,
          href: opts.mine != null && (m.a === opts.mine || m.b === opts.mine) ? `/matches/${m.id}` : null,
        };
      }),
    };
  });
}

/** Up and down marks of a table (spec 10): who moves at the end of the round. */
export type Zone = "up" | "down" | null;

/**
 * The zone of each place in a group's table: 1st moves up (not in group 1),
 * last moves down (not in the last group). `ranked`: false before any final
 * result, when the order is only the seeding and nothing is marked (D85).
 */
export function moveZones(size: number, groupNumber: number, groupCount: number, ranked: boolean): Zone[] {
  return Array.from({ length: size }, (_, i) => {
    if (!ranked || size < 2) return null;
    if (i === 0 && groupNumber > 1) return "up";
    if (i === size - 1 && groupNumber < groupCount) return "down";
    return null;
  });
}

/**
 * Where the pair stands on the ladder (spec 14): "még 2 feljutás a divízió
 * éléig, 3 kör van hátra". The division's top group needs no more promotions.
 */
export function ladderStanding(groupNumber: number, groupCount: number, phase: number, phases = PHASES_PER_SEASON): string {
  const division = divisionOf(groupNumber, groupCount);
  let top = groupNumber;
  while (top > 1 && divisionOf(top - 1, groupCount) === division) top--;
  const steps = groupNumber - top;
  const left = Math.max(0, phases - phase);
  const where =
    steps === 0
      ? groupNumber === 1
        ? "a létra csúcsán vagytok"
        : `a ${DIVISION_NAMES[division]} divízió élén vagytok`
      : `még ${steps} feljutás a divízió éléig`;
  return `${where}, ${left === 0 ? "ez az utolsó kör" : `${left} kör van hátra`}`;
}
