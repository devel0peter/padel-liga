// Season entries ("Nevezünk", #23, spec section 4, README decision log
// D17-D19). Pure (no I/O) so every rule is unit tested; the D1 side is
// season-entries.server.ts.
//
// Either player of an active pair applies while the season is open: from the
// day registration opens until the last phase starts. Both players need a
// level (the starting Elo). A Szervező approves or rejects, with an optional
// note, and can change the decision later. One entry per season and pair, so
// a rejected pair can't apply again. A pair approved after phase 1 started
// joins at the next phase; approved during the last phase, it moves into the
// next season.

import { isLevel, pairElo, startingElo } from "@padel-liga/rules";

import type { Season, StoredPhase } from "./seasons";

export type EntryStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type Decision = "approve" | "reject";

export const MAX_NOTE = 500;

type Calendar = Pick<Season, "registrationOpensAt" | "registrationClosesAt" | "phases">;

function lastPhase(phases: readonly StoredPhase[]): StoredPhase | undefined {
  return phases.reduce<StoredPhase | undefined>((a, p) => (!a || p.number > a.number ? p : a), undefined);
}

// Whether a pair can apply now: registration has opened and the last phase
// hasn't started (D18).
export function entryOpen(season: Calendar, now: Date): boolean {
  const last = lastPhase(season.phases);
  return !!last && now >= season.registrationOpensAt && now < last.startsAt;
}

// Applying once phase 1 has started: approved, the pair joins a later phase.
export function lateEntry(season: Pick<Season, "phases">, now: Date): boolean {
  const first = season.phases.reduce<StoredPhase | undefined>((a, p) => (!a || p.number < a.number ? p : a), undefined);
  return !!first && now >= first.startsAt;
}

// The phase a pair approved at `at` starts in: the first phase that hasn't
// started yet (1 before the season starts) and whose groups aren't published
// yet (#24: a published phase is locked), or null once there is none (it
// moves into the next season).
export function joinsPhase(phases: readonly StoredPhase[], at: Date, published: readonly number[] = []): number | null {
  const next = [...phases]
    .sort((a, b) => a.number - b.number)
    .find((p) => p.startsAt > at && !published.includes(p.number));
  return next?.number ?? null;
}

// The entries a decision may change: the Szervező can flip an earlier
// decision, but a withdrawn entry (the pair was dissolved) stays withdrawn.
export const DECIDABLE_FROM: Record<Decision, readonly EntryStatus[]> = {
  approve: ["pending", "rejected"],
  reject: ["pending", "approved"],
};

export function canDecide(status: EntryStatus, decision: Decision, pairActive: boolean): boolean {
  if (!DECIDABLE_FROM[decision].includes(status)) return false;
  // A dissolved pair can't be approved; rejecting its leftover entry is fine.
  return decision === "reject" || pairActive;
}

export type EntryRefusal = "no_pair" | "closed" | "entered" | "no_level" | "partner_no_level";

export const ENTRY_REFUSALS: Record<EntryRefusal, string> = {
  no_pair: "Nevezni párban lehet, és még nincs párod.",
  closed: "Erre a szezonra most nem lehet nevezni.",
  entered: "Erre a szezonra már neveztetek.",
  no_level: "Nevezés előtt add meg a szinted a profilodban.",
  partner_no_level: "Nevezés előtt a párodnak is meg kell adnia a szintjét a profiljában.",
};

export type EntryCheck = {
  hasPair: boolean;
  open: boolean;
  // Any entry of this pair for this season, whatever its status.
  entered: boolean;
  myLevel: string | null;
  partnerLevel: string | null;
};

export function checkEntry(c: EntryCheck): EntryRefusal | null {
  if (!c.hasPair) return "no_pair";
  if (c.entered) return "entered";
  if (!c.open) return "closed";
  if (!c.myLevel) return "no_level";
  if (!c.partnerLevel) return "partner_no_level";
  return null;
}

// The organizer's optional note: trimmed, empty is none.
export function parseNote(value: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  const note = typeof value === "string" ? value.trim() : "";
  if (note.length > MAX_NOTE) return { ok: false, error: `Legfeljebb ${MAX_NOTE} karakter.` };
  return { ok: true, note: note || null };
}

// The pair's starting rating: the average of the two players' starting Elo
// (spec section 11); null while a level is missing.
export function averageStartingElo(a: string | null, b: string | null): number | null {
  if (!a || !b || !isLevel(a) || !isLevel(b)) return null;
  return pairElo(startingElo(a), startingElo(b));
}

// "az 1. körtől", "a 2. körtől": "az" before a number read with a vowel.
export function fromPhase(n: number): string {
  return `${n === 1 || n === 5 ? "az" : "a"} ${n}. körtől`;
}

export function entryStatusText(entry: { status: EntryStatus; joinsPhase: number | null }): string {
  switch (entry.status) {
    case "pending":
      return "Neveztetek. A szervező jóváhagyására vár.";
    case "approved":
      return entry.joinsPhase === null
        ? "Jóváhagyva: a következő szezontól játszotok."
        : `Jóváhagyva: ${fromPhase(entry.joinsPhase)} játszotok.`;
    case "rejected":
      return "A szervező nem fogadta el a nevezéseteket.";
    case "withdrawn":
      return "A nevezés visszavonva.";
  }
}

// What a player sees for one season: the entry's status, the "Nevezünk"
// button, why they can't apply yet, or nothing (not open, no entry).
export type EntryView =
  | { kind: "status"; status: EntryStatus; text: string; note: string | null }
  | { kind: "apply"; late: boolean }
  | { kind: "blocked"; reason: EntryRefusal; text: string };

export function entryView(input: {
  season: Calendar;
  now: Date;
  hasPair: boolean;
  myLevel: string | null;
  partnerLevel: string | null;
  entry: { status: EntryStatus; joinsPhase: number | null; note: string | null } | null;
}): EntryView | null {
  const { entry } = input;
  if (entry) return { kind: "status", status: entry.status, text: entryStatusText(entry), note: entry.note };
  const open = entryOpen(input.season, input.now);
  if (!open) return null;
  const refusal = checkEntry({ ...input, open, entered: false });
  if (refusal) return { kind: "blocked", reason: refusal, text: ENTRY_REFUSALS[refusal] };
  return { kind: "apply", late: lateEntry(input.season, input.now) };
}

// The organizer page's filter (?status=), pending by default.
export const ENTRY_FILTERS = {
  pending: "Függőben",
  approved: "Jóváhagyva",
  rejected: "Elutasítva",
} as const satisfies Partial<Record<EntryStatus, string>>;

export type EntryFilter = keyof typeof ENTRY_FILTERS;

export function parseEntryFilter(value: string | null): EntryFilter {
  return value && Object.hasOwn(ENTRY_FILTERS, value) ? (value as EntryFilter) : "pending";
}
