// Season calendar (spec sections 4 and 18, issue #22): 4 phases of 3 weeks,
// back to back from a Monday, skipping the organizer's breaks. Pure: no I/O.

// A calendar day in Budapest, "2026-11-09".
export type Day = string;

// A break, both days included: no phase runs on any of its days.
export type Break = { start: Day; end: Day };

export type Phase = {
  number: number; // 1–4
  start: Day; // a Monday
  end: Day; // the Sunday 3 weeks later
  startsAt: Date; // Monday 00:00 Budapest, as a UTC instant
  deadline: Date; // Sunday 23:59 Budapest, as a UTC instant
};

export const PHASES_PER_SEASON = 4;
export const PHASE_DAYS = 21;
export const TIME_ZONE = "Europe/Budapest";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function utcMidnight(day: Day): number {
  const m = DAY_RE.exec(day);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Rejects 2027-02-29, 2026-13-01 and the like, which Date.UTC would roll over.
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : NaN;
}

function toDay(utcMs: number): Day {
  return new Date(utcMs).toISOString().slice(0, 10);
}

export function isDay(value: string): boolean {
  return !Number.isNaN(utcMidnight(value));
}

function assertDay(day: Day): void {
  if (!isDay(day)) throw new Error(`Not a calendar day (YYYY-MM-DD): ${day}`);
}

export function addDays(day: Day, n: number): Day {
  assertDay(day);
  return toDay(utcMidnight(day) + n * DAY_MS);
}

export function isMonday(day: Day): boolean {
  assertDay(day);
  return new Date(utcMidnight(day)).getUTCDay() === 1;
}

// The first Monday strictly after `day`.
export function firstMondayAfter(day: Day): Day {
  let d = addDays(day, 1);
  while (!isMonday(d)) d = addDays(d, 1);
  return d;
}

const budapestParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// Budapest wall-clock time at `at`, read as if it were UTC.
function budapestWallMs(at: number): number {
  const p: Record<string, string> = {};
  for (const { type, value } of budapestParts.formatToParts(new Date(at))) p[type] = value;
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
}

// The UTC instant of hour:minute on `day` in Budapest.
export function budapestTime(day: Day, hour: number, minute: number): Date {
  assertDay(day);
  const wall = utcMidnight(day) + (hour * 60 + minute) * 60 * 1000;
  // Budapest is UTC+1 or UTC+2: take the offset at the first guess, then
  // correct once in case the guess fell on the other side of a clock change.
  let guess = wall - (budapestWallMs(wall) - wall);
  guess = wall - (budapestWallMs(guess) - guess);
  return new Date(guess);
}

// The Budapest calendar day of a UTC instant.
export function budapestDay(at: Date): Day {
  return toDay(budapestWallMs(at.getTime()));
}

/**
 * The season's 4 phases from the first phase's Monday. Phases run back to
 * back; a phase that would touch a break starts on the first Monday after
 * that break instead (a phase is never split). Each phase's deadline is its
 * last Sunday, 23:59 Budapest time.
 */
export function phaseCalendar(firstPhaseStart: Day, breaks: readonly Break[]): Phase[] {
  assertDay(firstPhaseStart);
  if (!isMonday(firstPhaseStart)) throw new Error(`The first phase must start on a Monday: ${firstPhaseStart}`);
  for (const b of breaks) {
    assertDay(b.start);
    assertDay(b.end);
    if (b.end < b.start) throw new Error(`A break can't end before it starts: ${b.start} – ${b.end}`);
  }

  const phases: Phase[] = [];
  let start = firstPhaseStart;
  for (let number = 1; number <= PHASES_PER_SEASON; number++) {
    // Each move goes past a break's end, so this stops after at most one
    // move per break.
    for (;;) {
      const end = addDays(start, PHASE_DAYS - 1);
      const hit = breaks.find((b) => b.start <= end && b.end >= start);
      if (!hit) break;
      start = firstMondayAfter(hit.end);
    }
    const end = addDays(start, PHASE_DAYS - 1);
    phases.push({ number, start, end, startsAt: budapestTime(start, 0, 0), deadline: budapestTime(end, 23, 59) });
    start = addDays(end, 1);
  }
  return phases;
}
