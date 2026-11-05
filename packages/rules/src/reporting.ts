// Recording a result and settling it (spec section 7, issues #28 and #29):
// one pair records the final score, the other confirms or disputes it; an
// unanswered result is accepted after 48 hours; a disputed one waits for the
// organizer, who can also set or override any match's outcome with a reason.
// Pure: no I/O. The score rules are in results.ts, the table in standings.ts.

import { validateScore, type MatchScore, type Side } from "./results";
import { other } from "./scheduling";
import type { MatchOutcome } from "./standings";

// What the pairs do, in the match's log.
export const RESULT_EVENT_KINDS = [
  "result_recorded", // the final score, by either pair (again by the same pair: a correction)
  "result_confirmed", // the other pair agrees: the result counts
  "result_disputed", // the other pair disagrees, with its own version: the organizer decides
] as const;

export type ResultEventKind = (typeof RESULT_EVENT_KINDS)[number];

export type ResultEvent = {
  kind: ResultEventKind;
  side: Side;
  at: Date;
  // The recorded score, or the disputing pair's version.
  score?: MatchScore | null;
};

// An outcome set from outside the two pairs: the 48-hour rule, the deadline
// resolution of an unplayed match (deadline.ts, #11), or the organizer (a
// decision on a dispute, or an override of any match).
export const RULING_KINDS = ["auto_accepted", "deadline", "organizer"] as const;
export type RulingKind = (typeof RULING_KINDS)[number];
export type Ruling = { kind: RulingKind; at: Date; outcome: MatchOutcome };

/** A result nobody answered is accepted this many hours after it was recorded (spec 7). */
export const AUTO_ACCEPT_HOURS = 48;

export type ResultState =
  | { status: "none" }
  // Waiting for the other pair since `at`.
  | { status: "recorded"; by: Side; score: MatchScore; at: Date }
  // `by` recorded `score`; the other pair disputed it with `counter`.
  | { status: "disputed"; by: Side; score: MatchScore; at: Date; counter: MatchScore | null; disputedAt: Date }
  // The outcome that counts.
  | { status: "final"; outcome: MatchOutcome; how: "confirmed" | RulingKind; at: Date };

/**
 * The match's result from its log (the pairs' steps, in order) and the
 * rulings (in order). The latest ruling decides, whatever the pairs did; a
 * step that doesn't fit the state (confirming your own result, recording
 * over a confirmed one) changes nothing.
 */
export function resultState(events: readonly ResultEvent[], rulings: readonly Ruling[] = []): ResultState {
  const ruling = rulings.at(-1);
  if (ruling) return { status: "final", outcome: ruling.outcome, how: ruling.kind, at: ruling.at };
  let state: ResultState = { status: "none" };
  for (const e of events) {
    switch (e.kind) {
      case "result_recorded":
        if (e.score && (state.status === "none" || (state.status === "recorded" && state.by === e.side)))
          state = { status: "recorded", by: e.side, score: e.score, at: e.at };
        break;
      case "result_confirmed":
        if (state.status === "recorded" && state.by !== e.side)
          state = { status: "final", outcome: { kind: "played", score: state.score }, how: "confirmed", at: e.at };
        break;
      case "result_disputed":
        if (state.status === "recorded" && state.by !== e.side)
          state = { status: "disputed", by: state.by, score: state.score, at: state.at, counter: e.score ?? null, disputedAt: e.at };
        break;
    }
  }
  return state;
}

export type ResultActions = {
  record: boolean; // a first result, or correcting your own while it waits
  confirm: boolean;
  dispute: boolean;
};

/**
 * What `side` can do with the result: record it while there is none (either
 * pair), correct its own while the other pair hasn't answered, confirm or
 * dispute the other pair's. A disputed or final result takes no player step:
 * the organizer decides (#29).
 */
export function resultActions(state: ResultState, side: Side): ResultActions {
  if (state.status === "none") return { record: true, confirm: false, dispute: false };
  if (state.status === "recorded") {
    const theirs = state.by !== side;
    return { record: !theirs, confirm: theirs, dispute: theirs };
  }
  return { record: false, confirm: false, dispute: false };
}

// When a waiting result is accepted by itself.
export function autoAcceptAt(state: ResultState): Date | null {
  return state.status === "recorded" ? new Date(state.at.getTime() + AUTO_ACCEPT_HOURS * 3600_000) : null;
}

/** True once a recorded result has waited 48 hours without an answer (spec 7). */
export function autoAcceptDue(state: ResultState, now: Date): boolean {
  const due = autoAcceptAt(state);
  return due !== null && now.getTime() >= due.getTime();
}

// Whose answer the result waits for: the other pair while recorded.
export function resultWaitingFor(state: ResultState): Side[] {
  return state.status === "recorded" ? [other(state.by)] : [];
}

/** The same score, set by set (the order of the sides matters). */
export function sameScore(x: MatchScore, y: MatchScore): boolean {
  const pairs = (s: MatchScore) => [...s.sets, ...(s.superTieBreak ? [s.superTieBreak] : [])].map(([a, b]) => `${a}:${b}`).join(",");
  return pairs(x) === pairs(y);
}

/** The score as the other side sees it: every set turned round. */
export function flipScore(score: MatchScore): MatchScore {
  const flip = ([a, b]: readonly [number, number]) => [b, a] as const;
  return { sets: score.sets.map(flip), ...(score.superTieBreak ? { superTieBreak: flip(score.superTieBreak) } : {}) };
}

/**
 * Problems with a dispute's own version, in Hungarian: it must be a valid
 * result (spec 7) and differ from the recorded one (otherwise it is a
 * confirmation).
 */
export function disputeErrors(recorded: MatchScore, counter: MatchScore): string[] {
  const v = validateScore(counter);
  if (!v.ok) return v.errors.map((e) => e.message);
  return sameScore(recorded, counter) ? ["Ez ugyanaz az eredmény, amit rögzítettek: erősítsd meg inkább."] : [];
}

export const OUTCOME_KINDS = ["played", "walkover", "both-inactive", "unplayed"] as const satisfies readonly MatchOutcome["kind"][];

/** The organizer's reason is required for every decision and override (#29). */
export const REASON_MAX = 500;

/**
 * Problems with an organizer decision or override (#29), in Hungarian: a
 * played outcome needs a valid score (spec 7); every decision needs a reason.
 */
export function decisionErrors(outcome: MatchOutcome, reason: string): string[] {
  const errors: string[] = [];
  if (outcome.kind === "played") {
    const v = validateScore(outcome.score);
    if (!v.ok) errors.push(...v.errors.map((e) => e.message));
  }
  const r = reason.trim();
  if (r === "") errors.push("Írd meg az indoklást: a döntés a meccs naplójába kerül.");
  else if (r.length > REASON_MAX) errors.push(`Az indoklás legfeljebb ${REASON_MAX} karakter legyen.`);
  return errors;
}
