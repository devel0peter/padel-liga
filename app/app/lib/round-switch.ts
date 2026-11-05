// The round switch's wording and small rules for the Csoportok page (#35,
// spec 10, D107). Pure, so every rule is unit tested; the D1 side is
// round-switch.server.ts.

import { withArticle } from "./groups";

/** Why a pair of the ending phase is not in the next phase's draft. */
export type LeaveReason = "withdrawn" | "strikes" | "dissolved" | "taken_out";

export const LEAVE_REASONS: Record<LeaveReason, string> = {
  withdrawn: "visszalépett a kör közben",
  strikes: "3 fekete pont",
  dissolved: "a pár megszűnt",
  taken_out: "kivetted a szezonból",
};

/** Where a pair of the draft comes from: its group and place in the ending phase's table, or a new pair. */
export type Origin = { kind: "continuing"; group: number; place: number } | { kind: "new" };

/** The move a draft pair makes: up, down, stays, or new. */
export function movement(origin: Origin, to: number): "up" | "down" | "stay" | "new" {
  if (origin.kind === "new") return "new";
  return to < origin.group ? "up" : to > origin.group ? "down" : "stay";
}

// "3. csoport, 1. hely", or "Új pár".
export function originText(origin: Origin): string {
  return origin.kind === "new" ? "Új pár" : `${origin.group}. csoport, ${origin.place}. hely`;
}

// The page's line before the draft exists.
export function waitingText(state: "running" | "resolving", endingPhase: number): string {
  return state === "running"
    ? `A tervezet ${withArticle(endingPhase)} kör határideje után, hétfőn reggel készül el.`
    : `${withArticle(endingPhase).replace(/^a/, "A")} kör le nem játszott meccseit még rendezzük (hétfő 6:00-tól). Utána készül el a tervezet.`;
}

/**
 * The round Csoportok shows: the one asked for (`?phase=`), else the newest
 * round with groups, or the round after it once that one's deadline has
 * passed (its draft, or why there is none yet); round 1 when there are no
 * groups.
 */
export function shownPhase(
  phases: readonly { number: number; deadline: Date }[],
  withGroups: readonly { phase: number; published: boolean }[],
  requested: number | null,
  now: Date,
): number {
  if (requested !== null && phases.some((p) => p.number === requested)) return requested;
  const latest = withGroups.at(-1);
  if (!latest) return 1;
  const deadline = phases.find((p) => p.number === latest.phase)?.deadline;
  const hasNext = phases.some((p) => p.number === latest.phase + 1);
  return latest.published && hasNext && deadline && deadline < now ? latest.phase + 1 : latest.phase;
}

export const DISPUTES_BLOCK = "Közzététel előtt döntsd el ezeket:";
export const DISPUTES_FIRST = "Előbb döntsd el a vitatott eredményeket és a meg nem jelenés bejelentéseket.";
export const BLOCKER_KINDS = { disputed: "vitatott eredmény", no_show: "meg nem jelenés bejelentése" } as const;
export const RECOMPUTE_HINT = "Ha közben rendeztél egy vitát vagy változtak a párok, számold újra a tervezetet. Az áthelyezéseid ilyenkor elvesznek.";
export const NOT_READY = "A kör még nem zárult le, a tervezet még nem készíthető el.";
export const NOTHING_TO_DRAFT = "Nincs pár a következő körre.";
export const LAST_PHASE = "Ez a szezon utolsó köre: a következő szezon beosztása később jön.";
