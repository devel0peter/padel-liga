// Season entries ("Nevezünk", #23, spec section 4, README decision log
// D17-D19). Pure (no I/O) so every rule is unit tested; the D1 side is
// season-entries.server.ts.
//
// Either player of an active pair enters while the season is open: from the
// day registration opens until the last phase starts. Both players need a
// level (the starting Elo). The entry counts at once, no organizer approval
// (#153, D62). One entry per season and pair. A pair entered after phase 1
// started (or once its groups are out) joins at the next phase. "pending"
// and "rejected" are left from the approval step: nothing writes them now.

import { isLevel, pairElo, startingElo } from "@padel-liga/rules";

import type { Season, StoredPhase } from "./seasons";

export type EntryStatus = "pending" | "approved" | "rejected" | "withdrawn";
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

// Entering once phase 1 has started: the pair joins a later phase.
export function lateEntry(season: Pick<Season, "phases">, now: Date): boolean {
  const first = season.phases.reduce<StoredPhase | undefined>((a, p) => (!a || p.number < a.number ? p : a), undefined);
  return !!first && now >= first.startsAt;
}

// The phase a pair entered at `at` starts in: the first phase that hasn't
// started yet (1 before the season starts) and whose groups aren't published
// yet (#24: a published phase is locked), or null once there is none (it
// moves into the next season).
export function joinsPhase(phases: readonly StoredPhase[], at: Date, published: readonly number[] = []): number | null {
  const next = [...phases]
    .sort((a, b) => a.number - b.number)
    .find((p) => p.startsAt > at && !published.includes(p.number));
  return next?.number ?? null;
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
      return "Neveztetek.";
    case "approved":
      return entry.joinsPhase === null
        ? "Beneveztetek: a következő szezontól játszotok."
        : `Beneveztetek: ${fromPhase(entry.joinsPhase)} játszotok.`;
    case "rejected":
      return "A szervező nem fogadta el a nevezéseteket.";
    case "withdrawn":
      return TAKEN_OUT_TEXT;
  }
}

// A withdrawn entry on Párom and Kezdőlap (#174): the organizer took the pair
// out (between rounds, or mid-round, #34); only they can enter it again. A
// dissolved pair's withdrawn entry never shows (entryFor skips it).
export const TAKEN_OUT_TEXT =
  "A szervező kivett titeket a szezonból. Ha újra játszanátok, szóljatok neki: ő újra be tud nevezni titeket.";

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

// An entry's status on the organizer pages, in a word. "pending" is left
// from the approval step (#153): nothing writes it now.
export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = {
  approved: "Nevezett",
  pending: "Függőben",
  rejected: "Elutasítva",
  // Also Párok's filter option (#174): taken out, or dissolved before playing.
  withdrawn: "Visszavonva",
};

// A pair's entry the admin tables show: in the first of the league's home
// seasons (current before next, see homeSeasons) the pair entered, or null.
export function homeEntry(
  seasons: readonly { id: number; name: string }[],
  entries: readonly { pairId: number; seasonId: number; status: EntryStatus; joinsPhase?: number | null }[],
  pairId: number,
): { seasonId: number; season: string; status: EntryStatus; joinsPhase: number | null } | null {
  for (const s of seasons) {
    const e = entries.find((x) => x.pairId === pairId && x.seasonId === s.id);
    if (e) return { seasonId: s.id, season: s.name, status: e.status, joinsPhase: e.joinsPhase ?? null };
  }
  return null;
}

// What the organizer can do on Párok with an active pair's entry (#154): take
// an entered pair out of its season, or enter a pair that has no entry (or
// was taken out) for the first home season open for entries. A rejected
// entry (left from the approval step) offers nothing. Whether the pair plays
// in a running phase is checked on the server.
export type OrganizerEntryAction = { kind: "enter" | "remove"; seasonId: number; season: string };

export function organizerEntryAction(
  seasons: readonly (Calendar & { id: number; name: string })[],
  entry: { seasonId: number; status: EntryStatus } | null,
  now: Date,
): OrganizerEntryAction | null {
  const seasonOf = (id: number) => seasons.find((s) => s.id === id);
  if (entry && (entry.status === "approved" || entry.status === "pending")) {
    const s = seasonOf(entry.seasonId);
    return s ? { kind: "remove", seasonId: s.id, season: s.name } : null;
  }
  if (entry?.status === "rejected") return null;
  const target = entry ? seasonOf(entry.seasonId) : seasons.find((s) => entryOpen(s, now));
  return target && entryOpen(target, now) ? { kind: "enter", seasonId: target.id, season: target.name } : null;
}

// Why the organizer can't enter a pair (#154), for the organizer.
export const ORGANIZER_ENTRY_REFUSALS = {
  no_pair: "Ez a pár már nem aktív ebben a ligában.",
  closed: "Erre a szezonra most nem lehet nevezni.",
  entered: "Ez a pár (vagy ugyanez a két játékos) már nevezett erre a szezonra.",
} as const;

// "Kovács Anna még nem adta meg a szintjét…": who is missing a level.
export function noLevelRefusal(names: readonly string[]): string {
  return `${names.join(" és ")} még nem adta meg a szintjét a profiljában, ezért a pár nem nevezhető.`;
}

export const IN_RUNNING_PHASE =
  "Ennek a párnak már kihirdetett csoportja van: csak indokkal veheted ki (visszaléptetés). Frissítsd az oldalt.";

// --- Withdrawing mid-phase (#34, D87) ----------------------------------------
// The organizer takes a pair out of the running round: every match it has
// in its group leaves the table, played or not, the rest are off, and the
// pair leaves the season as after "Kivétel a szezonból". Entered again, it
// joins at the next phase. A reason is required; only the organizer and the
// pair itself see it.

export const WITHDRAWAL_REASON_MAX = 300;

export function withdrawalReasonError(reason: string): string | null {
  const r = reason.trim();
  if (!r) return "Írd meg röviden, miért lép vissza a pár.";
  if (r.length > WITHDRAWAL_REASON_MAX) return `Az indok legfeljebb ${WITHDRAWAL_REASON_MAX} karakter lehet.`;
  return null;
}

export const NOT_IN_RUNNING_PHASE = "Ez a pár most nem játszik kihirdetett csoportban. Frissítsd az oldalt.";
