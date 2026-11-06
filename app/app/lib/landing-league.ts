// What the landing page says about a league city (#83): where the league is
// today and when a new pair can next start playing. Pure (no I/O): the loader
// passes the league's seasons and the time. "Today" is the Budapest calendar
// day, so the page switches exactly at Budapest midnight, and a day counts as
// a whole (registration that closes at 23:59 is open until midnight).

import { budapestDay, type Day } from "@padel-liga/rules";

import { formatDay, formatDeadline, formatShortDay } from "./format";
import type { Season } from "./seasons";

// What the page needs of a season.
export type LandingSeason = Pick<Season, "registrationOpensAt" | "registrationClosesAt"> & {
  phases: readonly { number: number; startsAt: Date; deadline: Date }[];
  // Rounds whose groups are published (locked). A pair approved now joins
  // the first round that has not started and is not published (joinsPhase in
  // season-entries.ts), so the joining point skips them. Default: none.
  publishedPhases?: readonly number[];
};

// When a new pair can next start playing (decision log, 2026-10-28).
export type Joining =
  | { kind: "round"; number: number; start: Day }
  // The next season's registration window.
  | { kind: "season"; opens: Day; closes: Day }
  // No next season is set up yet.
  | { kind: "soon" };

export type LeagueLanding =
  // Registration is open (the first round has not started).
  | { kind: "registration"; closes: Day; firstRound: Day; joining: Joining }
  // Registration is over, the first round has not started yet.
  | { kind: "starting"; firstRound: Day; joining: Joining }
  // A round is on.
  | { kind: "running"; round: number; deadline: Date; joining: Joining }
  // Between two rounds of a season (an organizer's break).
  | { kind: "break"; next: { number: number; start: Day }; joining: Joining }
  // No season is running: the next one's registration window, if it is set.
  | { kind: "between"; next: { opens: Day; closes: Day } | null; joining: Joining };

type Round = { number: number; start: Day; end: Day; deadline: Date };
type Prepared = { opens: Day; closes: Day; rounds: Round[]; end: Day; published: readonly number[] };

function prepare(season: LandingSeason): Prepared | null {
  const rounds = season.phases
    .map((p) => ({ number: p.number, start: budapestDay(p.startsAt), end: budapestDay(p.deadline), deadline: p.deadline }))
    .sort((a, b) => a.number - b.number);
  const last = rounds[rounds.length - 1];
  if (!last) return null;
  return {
    opens: budapestDay(season.registrationOpensAt),
    closes: budapestDay(season.registrationClosesAt),
    rounds,
    end: last.end,
    published: season.publishedPhases ?? [],
  };
}

/**
 * The state of one league on `now`. The current season is the earliest one
 * that has not ended. A pair can enter until its last round starts (spec
 * section 4), so the joining point is the next round that has not started,
 * or else the next season's registration.
 */
export function leagueLanding(seasons: readonly LandingSeason[], now: Date): LeagueLanding {
  const today = budapestDay(now);
  const list = seasons
    .map(prepare)
    .filter((s): s is Prepared => s !== null)
    .sort((a, b) => (a.rounds[0]!.start < b.rounds[0]!.start ? -1 : a.rounds[0]!.start > b.rounds[0]!.start ? 1 : 0));
  const current = list.find((s) => s.end >= today);
  if (!current) return { kind: "between", next: null, joining: { kind: "soon" } };

  // A later season whose registration has not closed yet.
  const later = list.slice(list.indexOf(current) + 1).find((s) => s.closes >= today);
  const nextSeason: Joining = later ? { kind: "season", opens: later.opens, closes: later.closes } : { kind: "soon" };
  const nextRound = (): Joining => {
    const r = current.rounds.find((round) => round.start > today && !current.published.includes(round.number));
    return r ? { kind: "round", number: r.number, start: r.start } : nextSeason;
  };

  const first = current.rounds[0]!;
  if (today < current.opens) {
    const window = { opens: current.opens, closes: current.closes };
    return { kind: "between", next: window, joining: { kind: "season", ...window } };
  }
  if (today < first.start) {
    return today <= current.closes
      ? { kind: "registration", closes: current.closes, firstRound: first.start, joining: nextRound() }
      : { kind: "starting", firstRound: first.start, joining: nextRound() };
  }
  const on = current.rounds.find((r) => r.start <= today && today <= r.end);
  if (on) return { kind: "running", round: on.number, deadline: on.deadline, joining: nextRound() };
  const next = current.rounds.find((r) => r.start > today)!;
  return { kind: "break", next: { number: next.number, start: next.start }, joining: nextRound() };
}

// The league city's block on the page: plain strings, so the loader can hand
// it to the page as is. `chip` is the short state on the city chip under the
// hero; `cta` the register button, `ctaNote` the line under it.
export type LandingBlock = {
  title: string;
  facts: [label: string, value: string][];
  joining: string;
  chip: string;
  cta: string;
  ctaNote: string | null;
  // The league's public page (groups, tables, matches; #30), when the league
  // is known by its slug.
  ladderPath?: string;
  // The register button: the league rides along, so the new account joins
  // it (D127, #331).
  registerPath?: string;
};

// The article before a round number: "az 1.", "a 2.", "az 5.".
function article(n: number): string {
  return n === 1 || n === 5 ? "az" : "a";
}

// "az 1. körtől", "a 2. körtől"
function fromRound(n: number): string {
  return `${article(n)} ${n}. körtől`;
}

export function joiningSentence(joining: Joining): string {
  switch (joining.kind) {
    case "round":
      return `Nevezz most, és ${fromRound(joining.number)} játszotok (${formatShortDay(joining.start)}).`;
    case "season":
      return `A következő szezonra ${formatShortDay(joining.opens)} – ${formatShortDay(joining.closes)} között lehet nevezni.`;
    case "soon":
      return "A következő szezonra hamarosan nyílik a nevezés.";
  }
}

// "Nevezek a 2. körre" when a round is open for new pairs; otherwise an
// account is still worth making (anyone can sign up, #113).
function cta(joining: Joining): Pick<LandingBlock, "cta" | "ctaNote"> {
  return joining.kind === "round"
    ? { cta: `Nevezek ${article(joining.number)} ${joining.number}. körre`, ctaNote: null }
    : { cta: "Regisztrálok", ctaNote: "Hozz létre fiókot, és nevezz, amint nyílik." };
}

export function landingBlock(state: LeagueLanding): LandingBlock {
  return { ...stateBlock(state), ...cta(state.joining) };
}

function stateBlock(state: LeagueLanding): Omit<LandingBlock, "cta" | "ctaNote"> {
  const joining = joiningSentence(state.joining);
  switch (state.kind) {
    case "registration":
      return {
        title: "Nyitva a nevezés",
        facts: [
          ["Nevezés zárul", `${formatDay(state.closes)} 23:59`],
          ["1. kör indul", formatDay(state.firstRound)],
        ],
        joining,
        chip: "nevezés nyitva",
      };
    case "starting":
      return {
        title: "Hamarosan indul",
        facts: [["1. kör indul", formatDay(state.firstRound)]],
        joining,
        chip: "hamarosan indul",
      };
    case "running":
      return {
        title: "Zajlik a szezon",
        facts: [
          ["Most", `${state.round}. kör`],
          ["Határidő", formatDeadline(state.deadline)],
        ],
        joining,
        chip: `zajlik ${article(state.round)} ${state.round}. kör`,
      };
    case "break":
      return {
        title: "Szünet a körök között",
        facts: [["Következő kör", `${state.next.number}. kör, ${formatDay(state.next.start)}`]],
        joining,
        chip: "szünet a körök között",
      };
    case "between":
      return {
        title: "Következő szezon",
        facts: state.next
          ? [
              ["Nevezés nyílik", formatDay(state.next.opens)],
              ["Nevezés zárul", `${formatDay(state.next.closes)} 23:59`],
            ]
          : [["Nevezés", "hamarosan"]],
        joining,
        chip: "készül a következő szezon",
      };
  }
}

// The block for each city that has a league, by city slug. A city with
// several leagues shows the first one that has a season (else the first).
export function landingByCity(
  leagues: readonly { id: number; city: string; slug?: string }[],
  seasons: readonly (LandingSeason & { leagueId: number })[],
  now: Date,
): Map<string, LandingBlock> {
  const withSeasons = new Set(seasons.map((s) => s.leagueId));
  const pick = new Map<string, { id: number; slug?: string }>();
  for (const league of leagues) {
    const chosen = pick.get(league.city);
    if (!chosen || (!withSeasons.has(chosen.id) && withSeasons.has(league.id))) pick.set(league.city, league);
  }
  return new Map(
    [...pick].map(([city, league]) => [
      city,
      {
        ...landingBlock(leagueLanding(seasons.filter((s) => s.leagueId === league.id), now)),
        ...(league.slug ? { ladderPath: `/league/${league.slug}`, registerPath: `/register?league=${league.slug}` } : {}),
      },
    ]),
  );
}
