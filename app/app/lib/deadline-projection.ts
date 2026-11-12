// "Ha most lenne a határidő" on Meccsek (#362, D162): the wording and the
// totals of the deadline projection. Pure; the D1 side is
// deadline-projection.server.ts, the rule packages/rules deadlineDecision.

import type { DeadlineDecision, DeadlineSkip } from "@padel-liga/rules";

import { neutralOutcomeText } from "./results";

/** What the deadline would do with a counting match now: its tile on Meccsek and the `?deadline=` filter. */
export type ProjectionKind = "final" | "walkover" | "both_lose" | "unplayed" | "left";

export const PROJECTION_KINDS: { value: ProjectionKind; label: string }[] = [
  { value: "walkover", label: "Játék nélküli győzelem" },
  { value: "both_lose", label: "Mindkét pár veszít" },
  { value: "unplayed", label: "Elmarad" },
  { value: "left", label: "Nem dönt róla a határidő" },
  { value: "final", label: "Már lejátszva vagy eldöntve" },
];

export const isProjectionKind = (v: string): v is ProjectionKind => PROJECTION_KINDS.some((k) => k.value === v);

export function projectionKind(d: DeadlineDecision): ProjectionKind {
  if (d.kind === "leave") return d.reason === "final" ? "final" : "left";
  switch (d.resolution.outcome.kind) {
    case "walkover":
      return "walkover";
    case "both-inactive":
      return "both_lose";
    default:
      return "unplayed";
  }
}

// Why the deadline leaves a counting match alone (a withdrawn pair's match
// isn't listed at all).
const LEFT_TEXT: Record<Exclude<DeadlineSkip, "final" | "withdrawn">, string> = {
  result_pending: "az eredmény megerősítésre vár, 48 óra után magától elfogadjuk",
  disputed: "vitatott eredmény, te döntesz róla",
  no_show: "meg nem jelenés bejelentése vár a döntésedre",
};

/**
 * The match's line under its status on Meccsek: "Ha most lenne a
 * határidő: Játék nélküli győzelem: Kiss–Nagy (4:0, 4:0)", or why the
 * deadline leaves it alone; null for a final match (its status says it all).
 */
export function projectionLine(d: DeadlineDecision, names: { a: string; b: string }): string | null {
  if (d.kind === "resolve") return `Ha most lenne a határidő: ${neutralOutcomeText(d.resolution.outcome, names)}`;
  if (d.reason === "final" || d.reason === "withdrawn") return null;
  return `Nem dönt róla a határidő: ${LEFT_TEXT[d.reason]}`;
}

/** How many counting matches fall under each kind, in PROJECTION_KINDS order. */
export function projectionTotals(kinds: readonly ProjectionKind[]): { kind: ProjectionKind; label: string; count: number }[] {
  return PROJECTION_KINDS.map((k) => ({ kind: k.value, label: k.label, count: kinds.filter((x) => x === k.value).length }));
}

type Person = { id: string; name: string };

/** The parts of a phase projection (deadline-projection.server.ts) the page shows. */
export type ProjectionInput = {
  matches: readonly { id: number; decision: DeadlineDecision }[];
  pairs: ReadonlyMap<number, { players: readonly Person[] }>;
  strikes: ReadonlyMap<string, { now: number; after: number }>;
  warned: readonly { pairId: number; userId: string }[];
  leaving: readonly number[];
};

export type StrikeLine = { id: string; name: string; now: number; after: number };

export type ProjectionView = {
  totals: { kind: ProjectionKind; label: string; count: number }[];
  // How many strikes the projection would give, in all.
  newStrikes: number;
  // The players reaching their 2nd strike (the warning email), with their pair.
  warned: { player: StrikeLine; pair: Person[] }[];
  // The pairs that would leave at the round switch, each player's counts.
  leaving: { pairId: number; pair: Person[]; players: StrikeLine[] }[];
};

/** The section's numbers and lists. Names only: never an email or phone (strikes stay off public pages). */
export function projectionView(p: ProjectionInput): ProjectionView {
  const line = (u: Person): StrikeLine => ({ id: u.id, name: u.name, ...(p.strikes.get(u.id) ?? { now: 0, after: 0 }) });
  const players = (pairId: number) => (p.pairs.get(pairId)?.players ?? []).map((u) => ({ id: u.id, name: u.name }));
  const leaving = new Set(p.leaving);
  return {
    totals: projectionTotals(p.matches.map((m) => projectionKind(m.decision))),
    newStrikes: [...p.strikes.values()].reduce((n, s) => n + s.after - s.now, 0),
    // A player whose pair would leave anyway is listed there.
    warned: p.warned.flatMap((w) => {
      const player = players(w.pairId).find((u) => u.id === w.userId);
      return player && !leaving.has(w.pairId) ? [{ player: line(player), pair: players(w.pairId) }] : [];
    }),
    leaving: p.leaving.map((pairId) => ({ pairId, pair: players(pairId), players: players(pairId).map(line) })),
  };
}

export const PROJECTION_TITLE = "Ha most lenne a határidő";
export const PROJECTION_NOTE =
  "Ez csak előrejelzés: a határidőig minden lépéssel változik. A határidő után is felülbírálhatsz bármelyik döntést.";

/** The section's first line, with the round's current deadline (an extended one too). */
export function projectionIntro(deadline: string): string {
  return `Ezt döntené a rendszer a még le nem játszott meccsekről, ha a határidő (${deadline}) most lenne.`;
}
