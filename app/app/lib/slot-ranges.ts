// Availability ranges (D144): how a proposal's ranges are stored, sent by the
// match page's forms, shown, and which days and hours the pickers offer.
// Pure (no I/O); the rules themselves are in packages/rules (slots.ts).

import {
  SLOT_RULES,
  addDays,
  budapestDay,
  budapestTime,
  isDay,
  slotErrorMessage,
  type Day,
  type SlotError,
  type SlotRange,
  type SlotRules,
} from "@padel-liga/rules";

import { formatClockTime, formatDeadline, formatShortDay } from "./format";

const HOUR_S = 3600;

/**
 * `match_events.slots` as stored: a range is [start, end] in UTC seconds.
 * Proposals before D144 stored bare starts; each is a range one match long.
 */
export type StoredSlots = (number | [number, number])[];

/** A proposal's ranges from `match_events.slots`, either format; anything unreadable is left out. */
export function storedRanges(stored: unknown): SlotRange[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((v): SlotRange[] => {
    if (typeof v === "number" && Number.isFinite(v)) return [{ start: new Date(v * 1000), end: new Date((v + HOUR_S) * 1000) }];
    if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n)))
      return [{ start: new Date(v[0] * 1000), end: new Date(v[1] * 1000) }];
    return [];
  });
}

const secs = (d: Date) => Math.floor(d.getTime() / 1000);

/** Ranges as `match_events.slots` stores them now. */
export function toStoredRanges(ranges: readonly SlotRange[]): [number, number][] {
  return ranges.map((r) => [secs(r.start), secs(r.end)]);
}

/** "nov. 14., szombat 14:00–18:00"; a range one match long is its start: "nov. 14., szombat 14:00". */
export function formatRange(r: SlotRange, rules: SlotRules = SLOT_RULES): string {
  const start = formatDeadline(r.start);
  return r.end.getTime() - r.start.getTime() <= rules.matchMinutes * 60_000 ? start : `${start}–${formatClockTime(r.end)}`;
}

// --- Form fields: Budapest days and whole hours, whatever the browser's time zone.

/** "2026-11-14|14|18": a range on a Budapest day, from and to a whole hour. */
export const rangeField = (day: Day, from: number, to: number) => `${day}|${from}|${to}`;

/** "2026-11-14|18": a start on a Budapest day at a whole hour. */
export const startField = (day: Day, hour: number) => `${day}|${hour}`;

const RANGE_RE = /^(\d{4}-\d{2}-\d{2})\|(\d{1,2})\|(\d{1,2})$/;
const START_RE = /^(\d{4}-\d{2}-\d{2})\|(\d{1,2})$/;
const INVALID = () => new Date(Number.NaN);
const hourOk = (h: number, max: number) => Number.isInteger(h) && h >= 0 && h <= max;

/** A range field; an unreadable one has invalid dates, so the slot rules report it. */
export function parseRangeField(value: string): SlotRange {
  const m = RANGE_RE.exec(value.trim());
  if (!m || !isDay(m[1]!)) return { start: INVALID(), end: INVALID() };
  const [from, to] = [Number(m[2]), Number(m[3])];
  if (!hourOk(from, 23) || !hourOk(to, 24)) return { start: INVALID(), end: INVALID() };
  return { start: budapestTime(m[1]!, from, 0), end: budapestTime(m[1]!, to, 0) };
}

/** A start field; an invalid date when unreadable. */
export function parseStartField(value: string): Date {
  const m = START_RE.exec(value.trim());
  if (!m || !isDay(m[1]!)) return INVALID();
  const hour = Number(m[2]);
  return hourOk(hour, 23) ? budapestTime(m[1]!, hour, 0) : INVALID();
}

/** The first error of each kind, in Hungarian, for the form. */
export function slotErrorText(errors: readonly SlotError[]): string {
  return [...new Set(errors.map((e) => slotErrorMessage(e.code)))].join(" ");
}

// --- The pickers -----------------------------------------------------------------

/** A day the pickers offer and its whole-hour starts still possible. */
export type PickerDay = { day: Day; hours: number[] };

/**
 * The days from today to the deadline's day with at least one start left:
 * whole hours 7:00–22:00 Budapest, after `now` and before the deadline.
 */
export function pickerDays(now: Date, deadline: Date, rules: SlotRules = SLOT_RULES): PickerDay[] {
  const out: PickerDay[] = [];
  const last = budapestDay(deadline);
  for (let day = budapestDay(now); day <= last; day = addDays(day, 1)) {
    const hours: number[] = [];
    for (let h = Math.ceil(rules.earliest / 60); h * 60 <= rules.latest; h++) {
      const t = budapestTime(day, h, 0).getTime();
      if (t > now.getTime() && t < deadline.getTime()) hours.push(h);
    }
    if (hours.length > 0) out.push({ day, hours });
  }
  return out;
}

/** The hours a range on `day` can end at, after starting at `from`: up to an hour after the last start. */
export function endHours(day: PickerDay, from: number, rules: SlotRules = SLOT_RULES): number[] {
  const last = Math.max(...day.hours) + rules.matchMinutes / 60;
  const out: number[] = [];
  for (let h = from + 1; h <= last; h++) out.push(h);
  return out;
}

const PRESETS = [
  { label: "Délelőtt", from: 8, to: 12 },
  { label: "Délután", from: 14, to: 18 },
  { label: "Este", from: 18, to: 22 },
] as const;

/** The quick ranges for `day`, cut to its starts left; one with no start left is not offered. */
export function presetRanges(day: PickerDay, rules: SlotRules = SLOT_RULES): { label: string; from: number; to: number }[] {
  const first = Math.min(...day.hours);
  const end = Math.max(...day.hours) + rules.matchMinutes / 60;
  return PRESETS.flatMap((p) => {
    const from = Math.max(p.from, first);
    const to = Math.min(p.to, end);
    return to - from >= rules.matchMinutes / 60 ? [{ label: p.label, from, to }] : [];
  });
}

const WEEKDAYS = ["v", "h", "k", "sze", "cs", "p", "szo"];

/** A day chip's two lines: "nov. 14." and "szo". */
export function dayChip(day: Day): { date: string; weekday: string } {
  return { date: formatShortDay(day), weekday: WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]! };
}
