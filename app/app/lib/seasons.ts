// Seasons (spec section 4, issue #22). Pure (no I/O); the D1 access lives in
// seasons.server.ts, the calendar itself in packages/rules (phaseCalendar).

import { budapestTime, entriesMissing, isDay, isMonday, phaseCalendar, type Break, type Day, type Phase } from "@padel-liga/rules";

export type { Break, Day };

// What the organizer's form gives: Budapest calendar days.
export type SeasonInput = {
  name: string;
  registrationOpens: Day; // from 00:00
  registrationCloses: Day; // until 23:59
  firstPhaseStart: Day; // a Monday
  breaks: Break[]; // sorted by start
};

// A first season that starts at the minimum entries (D124): no registration
// window or first Monday, only the name and the breaks the start skips.
export type WaitingSeasonInput = Pick<SeasonInput, "name" | "breaks">;

export type SeasonField = "name" | "registrationOpens" | "registrationCloses" | "firstPhaseStart" | "breaks" | "start";
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
  // Both null while a first season waits for its minimum entries (D124):
  // it has no calendar yet, and no phases.
  registrationClosesAt: Date | null;
  firstPhaseStart: Day | null;
  breaks: Break[];
  phases: StoredPhase[];
  // A league's first season that starts once its entries reach the minimum
  // (D124, #335), and when they did (null: still waiting).
  startsAtMinimum: boolean;
  startFixedAt: Date | null;
};

// A first season still waiting for its minimum entries: no start, no phases.
export function isWaiting(season: Partial<Pick<Season, "firstPhaseStart">>): boolean {
  return season.firstPhaseStart === null;
}

// A first season started at the minimum entries (D124): every entered player
// was sent its round 1 day, so editing it as an ordinary season can't move
// that day (the name, the registration window, later phases' breaks can
// still change).
export const FIXED_START_LOCKED =
  "Ennek a szezonnak a kezdését a minimum elérése döntötte el, és a játékosok már megkapták: az 1. kör kezdete nem módosítható.";

export function movesFixedStart(
  stored: Pick<Season, "startsAtMinimum" | "phases">,
  phases: readonly { number: number; startsAt: Date }[],
): boolean {
  if (!stored.startsAtMinimum) return false;
  const was = stored.phases.find((p) => p.number === 1)?.startsAt;
  const next = phases.find((p) => p.number === 1)?.startsAt;
  return !!was && next?.getTime() !== was.getTime();
}

export const WAITING_NO_GROUPS =
  "Ez a szezon még a nevezésekre vár: a csoportokat akkor készítheted el, ha összegyűlt a minimum, és kiderült a kezdés napja.";

export const MAX_NAME = 60;
export const MAX_BREAKS = 10;

// Days the form accepts. A date input lets anyone type year 9999, and a
// break that long would push the calendar past what a day string can hold.
export const MIN_DAY = "2020-01-01";
export const MAX_DAY = "2100-12-31";
const OUT_OF_RANGE = "Adj meg egy 2020 és 2100 közötti dátumot.";

function inRange(day: string): boolean {
  return isDay(day) && day >= MIN_DAY && day <= MAX_DAY;
}

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

// The name and the breaks, which both kinds of season have. Breaks come as
// repeated breakStart/breakEnd fields; a row with both days empty is ignored.
function parseNameAndBreaks(form: FormData, errors: Partial<Record<SeasonField, string>>): WaitingSeasonInput {
  const name = str(form, "name").replace(/\s+/g, " ");
  const starts = strs(form, "breakStart");
  const ends = strs(form, "breakEnd");
  if (!name) errors.name = "Add meg a szezon nevét.";
  else if (name.length > MAX_NAME) errors.name = `Legfeljebb ${MAX_NAME} karakter.`;

  const breaks: Break[] = [];
  for (let i = 0; i < Math.max(starts.length, ends.length); i++) {
    const start = starts[i] ?? "";
    const end = ends[i] ?? "";
    if (!start && !end) continue;
    if (!isDay(start) || !isDay(end)) errors.breaks = "Minden szünetnek add meg a kezdetét és a végét.";
    else if (!inRange(start) || !inRange(end)) errors.breaks = OUT_OF_RANGE;
    else if (end < start) errors.breaks = "A szünet nem érhet véget, mielőtt elkezdődik.";
    else breaks.push({ start, end });
  }
  if (breaks.length > MAX_BREAKS) errors.breaks = `Legfeljebb ${MAX_BREAKS} szünet lehet.`;
  breaks.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return { name, breaks };
}

// The "Új szezon" form with dates.
export function parseSeason(form: FormData): SeasonResult {
  const registrationOpens = str(form, "registrationOpens");
  const registrationCloses = str(form, "registrationCloses");
  const firstPhaseStart = str(form, "firstPhaseStart");

  const errors: Partial<Record<SeasonField, string>> = {};
  const { name, breaks } = parseNameAndBreaks(form, errors);

  if (!isDay(registrationOpens)) errors.registrationOpens = "Add meg, mikor nyílik a nevezés.";
  else if (!inRange(registrationOpens)) errors.registrationOpens = OUT_OF_RANGE;
  if (!isDay(registrationCloses)) errors.registrationCloses = "Add meg, mikor zárul a nevezés.";
  else if (!inRange(registrationCloses)) errors.registrationCloses = OUT_OF_RANGE;
  else if (isDay(registrationOpens) && registrationCloses < registrationOpens)
    errors.registrationCloses = "A nevezés nem zárulhat, mielőtt kinyílik.";

  if (!isDay(firstPhaseStart)) errors.firstPhaseStart = "Add meg az első kör kezdőnapját.";
  else if (!inRange(firstPhaseStart)) errors.firstPhaseStart = OUT_OF_RANGE;
  else if (!isMonday(firstPhaseStart)) errors.firstPhaseStart = "Az első kör csak hétfőn kezdődhet.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const phases = phaseCalendar(firstPhaseStart, breaks);
  // Registration closes before the first phase starts (it may start later
  // than the picked Monday if a break covers it).
  if (registrationWindow({ registrationOpens, registrationCloses }).closesAt >= phases[0]!.startsAt)
    return { ok: false, errors: { registrationCloses: "A nevezésnek az első kör előtt kell zárulnia." } };

  return { ok: true, data: { name, registrationOpens, registrationCloses, firstPhaseStart, breaks }, phases };
}

// The form of a first season that starts at the minimum entries (D124):
// the name and the breaks only.
export function parseWaitingSeason(
  form: FormData,
): { ok: true; data: WaitingSeasonInput } | { ok: false; errors: Partial<Record<SeasonField, string>> } {
  const errors: Partial<Record<SeasonField, string>> = {};
  const data = parseNameAndBreaks(form, errors);
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, data };
}

// The live preview on the form: the phases, or null while the days don't
// make a calendar yet.
export function previewPhases(firstPhaseStart: string, breaks: { start: string; end: string }[]): Phase[] | null {
  if (!inRange(firstPhaseStart) || !isMonday(firstPhaseStart)) return null;
  const complete = breaks.filter((b) => inRange(b.start) && inRange(b.end) && b.start <= b.end);
  return phaseCalendar(firstPhaseStart, complete);
}

// What an organizer may still do with a season (decision log,
// 2026-10-23): edit it until the phase 1 groups are published, delete it
// while nobody has entered and nothing is published.
export function seasonActions(state: { groupsPublished: boolean; entries: number }): { canEdit: boolean; canDelete: boolean } {
  return { canEdit: !state.groupsPublished, canDelete: state.entries === 0 && !state.groupsPublished };
}

export function seasonEnd(season: Pick<Season, "phases">): Date | null {
  const last = season.phases.reduce<StoredPhase | null>((a, p) => (!a || p.number > a.number ? p : a), null);
  return last?.deadline ?? null;
}

// The league's season on show (the public table, the strikes on Párok): the
// earliest one that has not ended, else the latest. A waiting first season
// (no start yet, D124) sorts first: it is the league's only season.
export function currentSeason<T extends Pick<Season, "firstPhaseStart" | "phases">>(seasons: readonly T[], now: Date): T | undefined {
  const byStart = [...seasons].sort((a, b) => ((a.firstPhaseStart ?? "") < (b.firstPhaseStart ?? "") ? -1 : 1));
  const ongoing = byStart.find((s) => s.phases.length > 0 && s.phases[s.phases.length - 1]!.deadline >= now);
  return ongoing ?? byStart[byStart.length - 1];
}

// The seasons a player sees on the home page, per league: the earliest that
// hasn't ended yet (the current or next one), and any later one whose
// registration hasn't closed, so the next season's registration shows while
// the current season's last phase runs (spec section 10). A first season
// waiting for its minimum entries (D124) is shown too: it takes entries.
// Ordered by league, then start.
export function homeSeasons<T extends Season>(seasons: readonly T[], now: Date): T[] {
  const start = (s: T) => (isWaiting(s) ? -Infinity : Math.min(...s.phases.map((p) => p.startsAt.getTime())));
  const running = seasons
    .filter((s) => {
      const end = seasonEnd(s);
      return isWaiting(s) || (end !== null && end >= now);
    })
    .sort((a, b) => a.leagueId - b.leagueId || start(a) - start(b));
  return running.filter(
    (s, i) => running[i - 1]?.leagueId !== s.leagueId || s.registrationClosesAt === null || s.registrationClosesAt >= now,
  );
}

// The minimum entries a league's organizer can set (D124): at least one
// group of three.
export const MIN_ENTRIES_RANGE = { min: 3, max: 200 } as const;

export function parseMinEntries(value: FormDataEntryValue | null): { ok: true; value: number } | { ok: false; error: string } {
  const text = typeof value === "string" ? value.trim() : "";
  const n = Number(text);
  if (!text || !Number.isInteger(n) || n < MIN_ENTRIES_RANGE.min || n > MIN_ENTRIES_RANGE.max)
    return { ok: false, error: `Adj meg egy egész számot ${MIN_ENTRIES_RANGE.min} és ${MIN_ENTRIES_RANGE.max} között.` };
  return { ok: true, value: n };
}

// While a first season waits (landing card, league page, Kezdőlap):
// "9 pár nevezett, még 3 kell, utána indul."
export function waitingText(entries: number, minimum: number): string {
  const missing = entriesMissing(entries, minimum);
  return missing > 0
    ? `${entries} pár nevezett, még ${missing} kell, utána indul.`
    : `${entries} pár nevezett, hamarosan kiderül, mikor indul.`;
}
