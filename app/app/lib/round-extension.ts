// The organizer extends the running round (#356, D151): which round can be
// extended, the new deadlines on offer, the season's rounds after it, and the
// wording on Szezonok. Pure, so every rule is unit tested; the D1 side is
// round-extension.server.ts, the shift of the later rounds packages/rules
// extendRound.

import { addDays, budapestDay, extendRound, isSunday, weeksLater, type Break, type Day, type Phase } from "@padel-liga/rules";

import { formatDeadline, formatShortDate } from "./format";
import { withArticle } from "./groups";
import type { StoredPhase } from "./seasons";

/** The new deadlines on offer: the next this many Sundays after the current one. */
export const MAX_EXTENSION_WEEKS = 4;

export const NOT_EXTENDABLE =
  "Ezt a kört már nem hosszabbíthatod meg: lejárt a határideje, vagy még nincsenek kint a csoportjai.";
export const NOT_LATER = `Az új határidő a mostaninál 1–${MAX_EXTENSION_WEEKS} héttel későbbi vasárnap lehet.`;
export const CHANGED = "Közben változott a kör határideje. Frissítsd az oldalt, és nézd meg újra.";

/**
 * The round that can be extended at `now`: a published one (its groups are
 * out) whose deadline hasn't passed. At most one round is like that (the
 * next one is published only after this one's deadline); null if none.
 */
export function extendableRound<T extends Pick<StoredPhase, "number" | "deadline">>(
  phases: readonly T[],
  published: readonly number[],
  now: Date,
): T | null {
  return phases.find((p) => published.includes(p.number) && now.getTime() <= p.deadline.getTime()) ?? null;
}

/** The Sundays the deadline can move to, 1 to MAX_EXTENSION_WEEKS weeks later, as Budapest days. */
export function extensionOptions(deadline: Date): { day: Day; weeks: number }[] {
  const current = budapestDay(deadline);
  return Array.from({ length: MAX_EXTENSION_WEEKS }, (_, i) => ({ day: addDays(current, 7 * (i + 1)), weeks: i + 1 }));
}

/** The new deadline from the form: one of the offered Sundays, else the error to show. */
export function parseNewDeadline(value: FormDataEntryValue | null, deadline: Date): { ok: true; day: Day } | { ok: false; error: string } {
  const day = typeof value === "string" ? value.trim() : "";
  if (!isSunday(day) || !extensionOptions(deadline).some((o) => o.day === day)) return { ok: false, error: NOT_LATER };
  return { ok: true, day };
}

export type ExtensionPlan = {
  // Every round of the season after the extension.
  phases: Phase[];
  // The rounds after the extended one, with how many weeks later each starts.
  later: { number: number; startsAt: Date; deadline: Date; weeks: number }[];
};

/** The season's rounds once round `number`'s deadline moves to `newEnd`; the later rounds' break rule is the engine's. */
export function planExtension(
  season: { phases: readonly StoredPhase[]; breaks: readonly Break[] },
  number: number,
  newEnd: Day,
): ExtensionPlan {
  const spans = season.phases.map((p) => ({ number: p.number, start: budapestDay(p.startsAt), end: budapestDay(p.deadline) }));
  const phases = extendRound(spans, number, newEnd, season.breaks);
  const later = phases
    .filter((p) => p.number > number)
    .map((p) => ({ number: p.number, startsAt: p.startsAt, deadline: p.deadline, weeks: weeksLater(spans.find((s) => s.number === p.number)!, p) }));
  return { phases, later };
}

// "1 héttel", "3 héttel"
const weeksText = (weeks: number) => `${weeks} héttel`;

/**
 * The confirmation's lines: the round's old and new deadline, then how much
 * later the later rounds move (one line when they all move the same).
 * "Az 1. kör határideje: nov. 29., vasárnap 23:59 → dec. 6., vasárnap 23:59."
 */
export function extensionSummary(number: number, oldDeadline: Date, plan: ExtensionPlan): string[] {
  const own = plan.phases.find((p) => p.number === number)!;
  const lines = [`${capitalArticle(number)} kör határideje: ${formatDeadline(oldDeadline)} → ${formatDeadline(own.deadline)}.`];
  const { later } = plan;
  if (later.length === 0) lines.push("Ez a szezon utolsó köre, más kör nem mozdul.");
  else if (later.every((p) => p.weeks === later[0]!.weeks))
    lines.push(`${roundsText(later)} ${weeksText(later[0]!.weeks)} később kezdődik.`);
  else {
    lines.push("A szünet miatt a későbbi körök nem egyformán tolódnak:");
    for (const p of later) lines.push(`${capitalArticle(p.number)} kör ${weeksText(p.weeks)} később kezdődik (${formatShortDate(p.startsAt)}).`);
  }
  return lines;
}

// "A 2. kör", "A 2–4. kör"
function roundsText(rounds: readonly { number: number }[]): string {
  const first = rounds[0]!.number;
  const last = rounds[rounds.length - 1]!.number;
  return first === last ? `${capitalArticle(first)} kör` : `${capitalArticle(first)}–${last}. kör`.replace(/\.–/, "–");
}

// "Az 1." / "A 2.": the article and number, starting a sentence.
const capitalArticle = (n: number) => withArticle(n).replace(/^a/, "A");

/** The audit entry's detail: "phase 1: 2026-11-29 → 2026-12-06". */
export function extensionDetail(number: number, oldDeadline: Date, newEnd: Day): string {
  return `phase ${number}: ${budapestDay(oldDeadline)} → ${newEnd}`;
}
