// Seasons (spec section 4, issue #22). Pure (no I/O); the D1 access lives in
// seasons.server.ts, the calendar itself in packages/rules (phaseCalendar).

import { budapestTime, isDay, isMonday, phaseCalendar, type Break, type Day, type Phase } from "@padel-liga/rules";

export type { Break, Day };

// What the organizer's form gives: Budapest calendar days.
export type SeasonInput = {
  name: string;
  registrationOpens: Day; // from 00:00
  registrationCloses: Day; // until 23:59
  firstPhaseStart: Day; // a Monday
  breaks: Break[]; // sorted by start
};

export type SeasonField = "name" | "registrationOpens" | "registrationCloses" | "firstPhaseStart" | "breaks";
export type SeasonResult =
  | { ok: true; data: SeasonInput; phases: Phase[] }
  | { ok: false; errors: Partial<Record<SeasonField, string>> };

export type StoredPhase = { number: number; startsAt: Date; deadline: Date };

// A season as the pages show it.
export type Season = {
  id: number;
  leagueId: number;
  name: string;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  firstPhaseStart: Day;
  breaks: Break[];
  phases: StoredPhase[];
};

export const MAX_NAME = 60;
export const MAX_BREAKS = 10;

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function strs(form: FormData, key: string): string[] {
  return form.getAll(key).map((v) => (typeof v === "string" ? v.trim() : ""));
}

// The registration window's instants: 00:00 of the first day to 23:59 of the
// last, Budapest time.
export function registrationWindow(input: Pick<SeasonInput, "registrationOpens" | "registrationCloses">) {
  return {
    opensAt: budapestTime(input.registrationOpens, 0, 0),
    closesAt: budapestTime(input.registrationCloses, 23, 59),
  };
}

// The "Új szezon" form. Breaks come as repeated breakStart/breakEnd fields;
// a row with both days empty is ignored.
export function parseSeason(form: FormData): SeasonResult {
  const name = str(form, "name").replace(/\s+/g, " ");
  const registrationOpens = str(form, "registrationOpens");
  const registrationCloses = str(form, "registrationCloses");
  const firstPhaseStart = str(form, "firstPhaseStart");
  const starts = strs(form, "breakStart");
  const ends = strs(form, "breakEnd");

  const errors: Partial<Record<SeasonField, string>> = {};
  if (!name) errors.name = "Add meg a szezon nevét.";
  else if (name.length > MAX_NAME) errors.name = `Legfeljebb ${MAX_NAME} karakter.`;

  if (!isDay(registrationOpens)) errors.registrationOpens = "Add meg, mikor nyílik a nevezés.";
  if (!isDay(registrationCloses)) errors.registrationCloses = "Add meg, mikor zárul a nevezés.";
  else if (isDay(registrationOpens) && registrationCloses < registrationOpens)
    errors.registrationCloses = "A nevezés nem zárulhat, mielőtt kinyílik.";

  if (!isDay(firstPhaseStart)) errors.firstPhaseStart = "Add meg az első kör kezdőnapját.";
  else if (!isMonday(firstPhaseStart)) errors.firstPhaseStart = "Az első kör csak hétfőn kezdődhet.";

  const breaks: Break[] = [];
  for (let i = 0; i < Math.max(starts.length, ends.length); i++) {
    const start = starts[i] ?? "";
    const end = ends[i] ?? "";
    if (!start && !end) continue;
    if (!isDay(start) || !isDay(end)) errors.breaks = "Minden szünetnek add meg a kezdetét és a végét.";
    else if (end < start) errors.breaks = "A szünet nem érhet véget, mielőtt elkezdődik.";
    else breaks.push({ start, end });
  }
  if (breaks.length > MAX_BREAKS) errors.breaks = `Legfeljebb ${MAX_BREAKS} szünet lehet.`;
  breaks.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const phases = phaseCalendar(firstPhaseStart, breaks);
  // Registration closes before the first phase starts (it may start later
  // than the picked Monday if a break covers it).
  if (registrationWindow({ registrationOpens, registrationCloses }).closesAt >= phases[0]!.startsAt)
    return { ok: false, errors: { registrationCloses: "A nevezésnek az első kör előtt kell zárulnia." } };

  return { ok: true, data: { name, registrationOpens, registrationCloses, firstPhaseStart, breaks }, phases };
}

// The live preview on the form: the phases, or null while the days don't
// make a calendar yet.
export function previewPhases(firstPhaseStart: string, breaks: { start: string; end: string }[]): Phase[] | null {
  if (!isDay(firstPhaseStart) || !isMonday(firstPhaseStart)) return null;
  const complete = breaks.filter((b) => isDay(b.start) && isDay(b.end) && b.start <= b.end);
  return phaseCalendar(firstPhaseStart, complete);
}

// What an organizer may still do with a season (README decision log,
// 2026-10-23): edit it until the phase 1 groups are published, delete it
// while nobody has entered.
export function seasonActions(state: { groupsPublished: boolean; entries: number }): { canEdit: boolean; canDelete: boolean } {
  return { canEdit: !state.groupsPublished, canDelete: state.entries === 0 };
}

export function seasonEnd(season: Pick<Season, "phases">): Date | null {
  const last = season.phases.reduce<StoredPhase | null>((a, p) => (!a || p.number > a.number ? p : a), null);
  return last?.deadline ?? null;
}

// The season a player sees on the home page, one per league: the earliest
// that hasn't ended yet.
export function currentSeasons<T extends Season>(seasons: readonly T[], now: Date): T[] {
  const start = (s: T) => Math.min(...s.phases.map((p) => p.startsAt.getTime()));
  const byLeague = new Map<number, T>();
  for (const s of seasons) {
    const end = seasonEnd(s);
    if (!end || end < now) continue;
    const seen = byLeague.get(s.leagueId);
    if (!seen || start(s) < start(seen)) byLeague.set(s.leagueId, s);
  }
  return [...byLeague.values()];
}
