// Results (#28) and organizer decisions (#29): the form parsing, the score and
// outcome texts, the status lines, Teendők and log lines. Pure (no I/O); the
// D1 side is results.server.ts, the rules are in packages/rules
// (results.ts, reporting.ts).

import { flipScore, type MatchOutcome, type MatchScore, type ResultEventKind, type ResultState, type Side } from "@padel-liga/rules";

import { formatDeadline } from "./format";
import type { StatusView } from "./matches";

// --- Parsing --------------------------------------------------------------------

// The result form: games per set from the player's side ("ti") and the other
// pair's ("ők"), plus the super tie-break at 1-1. Field names: set1-us,
// set1-them, set2-us, set2-them, stb-us, stb-them.
export const SCORE_FIELDS = ["set1", "set2", "stb"] as const;

// A field as an integer; anything else (empty, "4.5", "x") is NaN, so the
// engine's "not-a-number" message names it.
function count(value: FormDataEntryValue | null): number {
  const v = String(value ?? "").trim();
  return /^\d{1,2}$/.test(v) ? Number(v) : Number.NaN;
}

const blank = (value: FormDataEntryValue | null) => String(value ?? "").trim() === "";

/**
 * The form as two integers per set (#28 comment: validateScore wants
 * integers), from `side`'s point of view turned into the match's a/b order.
 * An empty super tie-break (both fields) means there was none.
 */
export function parseScore(form: { get(name: string): FormDataEntryValue | null }, side: Side): MatchScore {
  const set = (n: string) => [count(form.get(`${n}-us`)), count(form.get(`${n}-them`))] as const;
  const stb = blank(form.get("stb-us")) && blank(form.get("stb-them")) ? undefined : set("stb");
  const ours: MatchScore = { sets: [set("set1"), set("set2")], ...(stb ? { superTieBreak: stb } : {}) };
  return side === "a" ? ours : flipScore(ours);
}

// --- Texts ----------------------------------------------------------------------

/** A score as `side` sees it (own games first): "4:1, 2:4, szuper tie-break 10:8". */
export function scoreText(score: MatchScore, side: Side): string {
  const s = side === "a" ? score : flipScore(score);
  const sets = s.sets.map(([x, y]) => `${x}:${y}`).join(", ");
  return s.superTieBreak ? `${sets}, szuper tie-break ${s.superTieBreak[0]}:${s.superTieBreak[1]}` : sets;
}

/** A score in the match's a/b order, for the organizer: "4:1, 2:4, szuper tie-break 10:8". */
export const neutralScoreText = (score: MatchScore) => scoreText(score, "a");

// Who won a played or walkover outcome.
export function winnerOf(outcome: MatchOutcome): Side | null {
  if (outcome.kind === "walkover") return outcome.winner;
  if (outcome.kind !== "played") return null;
  const [s1, s2] = outcome.score.sets;
  const won = (x?: readonly [number, number]) => (x ? (x[0] > x[1] ? "a" : "b") : null);
  return outcome.score.superTieBreak ? won(outcome.score.superTieBreak) : won(s1 ?? s2);
}

/** An outcome as a player of `side` sees it (#28, #29). */
export function outcomeText(outcome: MatchOutcome, side: Side): string {
  switch (outcome.kind) {
    case "played":
      return `${scoreText(outcome.score, side)} (${winnerOf(outcome) === side ? "nyertetek" : "kikaptatok"})`;
    case "walkover":
      return outcome.winner === side ? "Játék nélküli győzelem nektek (4:0, 4:0)" : "Játék nélküli vereség (0:4, 0:4)";
    case "both-inactive":
      return "Mindkét pár vereséget kap (0:4, 0:4)";
    case "unplayed":
      return "Elmaradt: nem számít a tabellába";
  }
}

/** An outcome for the organizer, naming the pairs. */
export function neutralOutcomeText(outcome: MatchOutcome, names: { a: string; b: string }): string {
  switch (outcome.kind) {
    case "played":
      return `${neutralScoreText(outcome.score)} (nyert: ${names[winnerOf(outcome)!]})`;
    case "walkover":
      return `Játék nélküli győzelem: ${names[outcome.winner]} (4:0, 4:0)`;
    case "both-inactive":
      return "Mindkét pár vereséget kap (0:4, 0:4)";
    case "unplayed":
      return "Elmaradt: nem számít a tabellába";
  }
}

// The outcome choices of the organizer's form (#29 requirement 2).
export type OutcomeChoice = "played" | "walkover-a" | "walkover-b" | "both-inactive" | "unplayed";

/**
 * The organizer's form as an outcome: the score fields are in the match's
 * a/b order (1. pár = a). Null for an unknown choice.
 */
export function parseOutcome(form: { get(name: string): FormDataEntryValue | null }): MatchOutcome | null {
  switch (String(form.get("outcome") ?? "")) {
    case "played":
      return { kind: "played", score: parseScore(form, "a") };
    case "walkover-a":
      return { kind: "walkover", winner: "a" };
    case "walkover-b":
      return { kind: "walkover", winner: "b" };
    case "both-inactive":
      return { kind: "both-inactive" };
    case "unplayed":
      return { kind: "unplayed" };
    default:
      return null;
  }
}

// --- Status, Teendők, log ----------------------------------------------------------

/**
 * The match's status line once a result exists (#28), as the player of `me`
 * sees it; null while there is none (the scheduling status applies).
 */
export function resultStatusView(state: ResultState, me: Side): StatusView | null {
  switch (state.status) {
    case "none":
      return null;
    case "recorded":
      return state.by === me
        ? { label: `Rögzítettétek: ${scoreText(state.score, me)}, a másik pár megerősítésére vár`, tone: "waiting" }
        : { label: `Eredmény: ${scoreText(state.score, me)}, erősítsd meg`, tone: "todo" };
    case "disputed":
      return { label: "Vitatott eredmény, a szervező dönt", tone: "waiting" };
    case "final":
      // "Lejátszva" only for a played match; a walkover, both losing or an
      // unplayed match is the final outcome without a game.
      return { label: `${state.outcome.kind === "played" ? "Lejátszva" : "Végeredmény"}: ${outcomeText(state.outcome, me)}`, tone: "done" };
  }
}

// The Teendő for the result, or null (#28): only the other pair's answer.
export function resultTodo(state: ResultState, me: Side, opponents: string): string | null {
  return state.status === "recorded" && state.by !== me ? `Erősítsd meg az eredményt (${opponents})` : null;
}

// When a waiting result is accepted by itself, for the page.
export function autoAcceptLine(due: Date): string {
  return `Ha addig nem válaszol senki, ${formatDeadline(due)} után magától elfogadjuk.`;
}

// A log line for a result step (#28), as `viewer` sees the score.
export function resultEventText(e: { kind: ResultEventKind; score?: MatchScore | null; note?: string | null }, viewer: Side): string {
  switch (e.kind) {
    case "result_recorded":
      return `Rögzítette az eredményt: ${e.score ? scoreText(e.score, viewer) : "?"}`;
    case "result_confirmed":
      return "Megerősítette az eredményt";
    case "result_disputed":
      return `Vitatta az eredményt${e.score ? `, ezt írta be helyette: ${scoreText(e.score, viewer)}` : ""}${e.note ? `. Megjegyzés: ${e.note}` : ""}`;
  }
}

// A log line for a ruling (#28, #29).
export function decisionText(d: { kind: "auto_accepted" | "organizer"; outcome: MatchOutcome; reason: string | null }, viewer: Side): string {
  if (d.kind === "auto_accepted") return "48 óra után magától elfogadtuk az eredményt";
  return `A szervező döntött: ${outcomeText(d.outcome, viewer)}. Indoklás: ${d.reason ?? ""}`;
}

// A ruling for the organizer, naming the pairs (#29).
export function neutralDecisionText(
  d: { kind: "auto_accepted" | "organizer"; outcome: MatchOutcome; reason: string | null },
  names: { a: string; b: string },
): string {
  if (d.kind === "auto_accepted") return "48 óra után magától elfogadtuk az eredményt";
  return `Döntés: ${neutralOutcomeText(d.outcome, names)}. Indoklás: ${d.reason ?? ""}`;
}

/** The note a disputing pair may add for the organizer. */
export const NOTE_MAX = 300;
