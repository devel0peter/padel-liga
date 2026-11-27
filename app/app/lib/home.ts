// Kezdőlap in direction A (#420, D181): what each of the player's matches
// says there. Pure, so every state is unit tested (home.test.ts). What counts
// as a to-do is unchanged (todoFor, resultTodo); only the words are shorter.

import { autoAcceptAt, budapestDay, daysBetween, type ResultState, type SchedulingState, type SetGames, type Side } from "@padel-liga/rules";

import { formatDeadline } from "./format";
import { weekRange, withArticle } from "./groups";
import { fixesAtText, formatSlot } from "./matches";
import { formatFromDate, leftText, optedOutText, type OptOutState } from "./opt-out";
import { scoreText, walkoverScoreText, winnerOf } from "./results";

// The status colours (docs/ui-guidelines.md); the same names as StatusPill's.
export type PillTone = "success" | "warning" | "info" | "danger" | "neutral";
export type MatchPill = { tone: PillTone; label: string };

export type MatchLike = {
  id: number;
  week: number;
  /** The other pair's team label. */
  opponents: string;
  side: Side;
  state: SchedulingState;
  result: ResultState;
  setGames: SetGames;
};

/** The match's state as a short pill: green won, amber waits on the player, blue needs a time, red lost or disputed. */
export function matchPill(m: Pick<MatchLike, "side" | "state" | "result">): MatchPill {
  switch (m.result.status) {
    case "final": {
      const outcome = m.result.outcome;
      if (outcome.kind === "unplayed") return { tone: "neutral", label: "Elmaradt" };
      return winnerOf(outcome) === m.side ? { tone: "success", label: "Győzelem" } : { tone: "danger", label: "Vereség" };
    }
    case "disputed":
      return { tone: "danger", label: "Vitatott" };
    case "recorded":
      return m.result.by === m.side ? { tone: "neutral", label: "Ellenfélre vár" } : { tone: "warning", label: "Megerősítésre vár" };
    case "none":
      break;
  }
  switch (m.state.status) {
    case "scheduled":
      return { tone: "neutral", label: "Fix időpont" };
    case "agreed_time":
      return m.state.by === m.side ? { tone: "neutral", label: "Ellenfélre vár" } : { tone: "warning", label: "Megbeszélt időpont" };
    case "proposed":
      return m.state.by === m.side ? { tone: "neutral", label: "Ellenfélre vár" } : { tone: "info", label: "Időpont kell" };
    case "to_schedule":
      // After a late cancellation only the cancelling pair proposes (D74).
      return m.state.nextBy && m.state.nextBy !== m.side ? { tone: "neutral", label: "Ellenfélre vár" } : { tone: "info", label: "Időpont kell" };
  }
}

// "4:5, 2:4" or "1:4, 4:2, 8:10": the player's own games first, a super
// tie-break as the third pair (a row has no room for its name).
const shortScore = (score: Parameters<typeof scoreText>[0], side: Side) =>
  scoreText(score, side).replace("szuper tie-break ", "");

/** The score a match row shows, the player's side first; null while there is none (and for an unplayed match). */
export function matchScore(m: Pick<MatchLike, "side" | "result" | "setGames">): string | null {
  switch (m.result.status) {
    case "none":
      return null;
    case "recorded":
    case "disputed":
      return shortScore(m.result.score, m.side);
    case "final": {
      const outcome = m.result.outcome;
      if (outcome.kind === "played") return shortScore(outcome.score, m.side);
      if (outcome.kind === "walkover") return walkoverScoreText(m.setGames, outcome.winner === m.side);
      if (outcome.kind === "both-inactive") return walkoverScoreText(m.setGames, false);
      return null;
    }
  }
}

/** When a match without a score is due: its fixed or agreed start, else its week ("nov. 30. – dec. 6."). */
export function matchWhen(m: Pick<MatchLike, "week" | "state">, phaseStartsAt: Date): string {
  if (m.state.status === "scheduled" || m.state.status === "agreed_time") return formatSlot(m.state.slot);
  return weekRange(phaseStartsAt, m.week);
}

/**
 * One card under "Rád vár". `confirm`: the opponents' result, answered on
 * the card itself ("Megerősítem"); `open`: a step done on the match page.
 */
export type HomeTodo = {
  matchId: number;
  kind: "confirm" | "open";
  title: string;
  description: string;
  /** The recorded score (the player's side first), on a result to confirm. */
  score: string | null;
  note: string | null;
};

/** The to-do of one match, or null when nothing waits on this player (the rules of todoFor and resultTodo). */
export function homeTodo(m: MatchLike): HomeTodo | null {
  const card = (kind: HomeTodo["kind"], title: string, description: string, note: string | null = null, score: string | null = null): HomeTodo => ({
    matchId: m.id,
    kind,
    title,
    description,
    score,
    note,
  });
  // Once a result exists, only its confirmation can wait on the player (#28).
  if (m.result.status !== "none") {
    if (m.result.status !== "recorded" || m.result.by === m.side) return null;
    const auto = autoAcceptAt(m.result);
    return card(
      "confirm",
      "Erősítsd meg az eredményt",
      `${m.opponents} ellen:`,
      auto ? `${formatDeadline(auto)} után magától elfogadjuk.` : null,
      scoreText(m.result.score, m.side),
    );
  }
  switch (m.state.status) {
    case "to_schedule":
      return m.state.nextBy && m.state.nextBy !== m.side ? null : card("open", "Ajánlj időpontot", `${m.opponents} ellen`);
    case "proposed":
      return m.state.by === m.side ? null : card("open", "Válassz időpontot", `${m.opponents} időpontokat ajánlott`);
    case "agreed_time":
      // It becomes fixed by itself (D148): the card says when.
      return m.state.by === m.side
        ? null
        : card("open", "Nézd meg a megbeszélt időpontot", `${m.opponents}: ${formatSlot(m.state.slot)}`, `${fixesAtText(m.state.fixesAt)} magától fix lesz.`);
    case "scheduled":
      return null;
  }
}

export const homeTodos = (matches: readonly MatchLike[]): HomeTodo[] => matches.flatMap((m) => homeTodo(m) ?? []);

/** How far the round is: whole Budapest days to the deadline's day (0 on it), and the share of its time gone (0 to 1). */
export function roundClock(startsAt: Date, deadline: Date, now: Date): { daysLeft: number; progress: number } {
  const span = deadline.getTime() - startsAt.getTime();
  const gone = span > 0 ? (now.getTime() - startsAt.getTime()) / span : 1;
  return {
    daysLeft: Math.max(0, daysBetween(budapestDay(now), budapestDay(deadline))),
    progress: Math.min(1, Math.max(0, gone)),
  };
}

/** "1 / 3 meccsetek kész": the pair's matches with a final result. */
export function doneText(matches: readonly Pick<MatchLike, "result">[]): string {
  return `${matches.filter((m) => m.result.status === "final").length} / ${matches.length} meccsetek kész`;
}

/** Whether the pair plays on in the next round (#395), in short; Ligáim has the whole of it and the buttons. */
export type NextRound = { tone: "success" | "warning"; title: string; detail: string | null; to: string };

export function nextRound(state: OptOutState, leagueSlug: string): NextRound {
  const to = `/leagues/${leagueSlug}`;
  switch (state.kind) {
    case "in":
      return {
        tone: "success",
        title: `Benne vagytok ${withArticle(state.window.nextRound)} körben`,
        detail: `${formatFromDate(state.window.nextStart)}, nem kell tenned semmit`,
        to,
      };
    case "out":
      return { tone: "warning", title: "Nem folytatjátok", detail: optedOutText(state.window, state.mine), to };
    case "left":
      return { tone: "warning", title: leftText(state.round), detail: null, to };
  }
}
