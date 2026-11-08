// Slot rules for scheduling a match (spec section 6, issue #8, D144). Pure:
// no I/O.
//
// A proposal gives the other pair availability ranges ("szombat 14–18"); the
// other pair accepts by picking one start inside one of them. An agreed time
// is one start the pairs already settled elsewhere (spec 6.3). A match is 60
// minutes and courts are booked by the hour, so every range edge and every
// start is a whole hour. Times are UTC instants, judged on the Budapest wall
// clock (calendar.ts), so a range across a daylight-saving change is read as
// the players see it.

import { budapestClock } from "./calendar";

// From `start` to `end`: the pair can play any match that fits in it.
export type SlotRange = { start: Date; end: Date };

export type SlotRules = {
  minDays: number; // distinct Budapest days among a proposal's ranges
  earliest: number; // first allowed start, minutes after 00:00 Budapest
  latest: number; // last allowed start, minutes after 00:00 Budapest (included)
  matchMinutes: number; // how long a match is: every range fits at least one
};

// The league default (spec 6.1). League-specific settings come later (spec 12).
export const SLOT_RULES: SlotRules = { minDays: 2, earliest: 7 * 60, latest: 22 * 60, matchMinutes: 60 };

export type SlotErrorCode =
  | "invalid" // not a time at all
  | "too_few_days"
  | "too_short" // a range that doesn't fit one match
  | "not_whole_hour"
  | "outside_window"
  | "in_past"
  | "after_deadline"
  | "not_offered"; // accepting a start that isn't in the other pair's open ranges

// `slot` is the index of the offending range or time; none for a rule on the whole set.
export type SlotError = { code: SlotErrorCode; slot?: number };

const HOUR_MS = 60 * 60 * 1000;
const matchMs = (rules: SlotRules) => rules.matchMinutes * 60 * 1000;

const clock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

// Each rule's own Hungarian message (#8 requirement 6).
export function slotErrorMessage(code: SlotErrorCode, rules: SlotRules = SLOT_RULES): string {
  switch (code) {
    case "invalid":
      return "Hibás időpont. Válassz napot és órát.";
    case "too_few_days":
      return `Legalább ${rules.minDays} különböző napot adj meg.`;
    case "too_short":
      return `Minden időszakba férjen bele egy ${rules.matchMinutes} perces meccs.`;
    case "not_whole_hour":
      return "Csak egész órát adhatsz meg.";
    case "outside_window":
      return `Az időszak ${clock(rules.earliest)} és ${clock(rules.latest + rules.matchMinutes)} közé essen, egy napon belül.`;
    case "in_past":
      return "Ez az időpont már elmúlt.";
    case "after_deadline":
      return "Az időpont a kör határideje előtt legyen.";
    case "not_offered":
      return "Ez az időpont már nem választható. Frissítsd az oldalt.";
  }
}

const valid = (d: Date) => d instanceof Date && !Number.isNaN(d.getTime());

// On the hour. Budapest is always a whole number of hours off UTC, so a
// whole UTC hour is a whole Budapest hour.
export function isWholeHour(d: Date): boolean {
  return valid(d) && d.getTime() % HOUR_MS === 0;
}

/**
 * The starts the other pair can pick in `range` (spec 6.2): whole hours from
 * its start while a match still fits before its end, only those after
 * `after` when given. A range stored before D144 is one start that need not
 * be on the hour ("19:30", as a range one match long): its start counts too.
 */
export function rangeStarts(range: SlotRange, after?: Date, rules: SlotRules = SLOT_RULES): Date[] {
  if (!valid(range.start) || !valid(range.end)) return [];
  const out: Date[] = [];
  let t = range.start.getTime();
  while (t + matchMs(rules) <= range.end.getTime()) {
    if (!after || t > after.getTime()) out.push(new Date(t));
    // The next whole hour after t.
    t = (Math.floor(t / HOUR_MS) + 1) * HOUR_MS;
  }
  return out;
}

// Whether `start` is one of the starts of `range`.
export function fitsRange(start: Date, range: SlotRange, rules: SlotRules = SLOT_RULES): boolean {
  if (!valid(start)) return false;
  const t = start.getTime();
  return (
    t >= range.start.getTime() && t + matchMs(rules) <= range.end.getTime() && (t === range.start.getTime() || isWholeHour(start))
  );
}

/**
 * The part of each range that can still be picked at `now`: it starts at its
 * first start after `now`; a range with none left drops out.
 */
export function openRanges(ranges: readonly SlotRange[], now: Date, rules: SlotRules = SLOT_RULES): SlotRange[] {
  return ranges.flatMap((r) => {
    const first = rangeStarts(r, now, rules)[0];
    return first ? [{ start: first, end: r.end }] : [];
  });
}

/**
 * Ranges in time order, with overlapping or touching ones joined: 14–16 and
 * 16–18 are 14–18. Invalid ranges are left out.
 */
export function mergeRanges(ranges: readonly SlotRange[]): SlotRange[] {
  const sorted = ranges
    .filter((r) => valid(r.start) && valid(r.end) && r.end.getTime() > r.start.getTime())
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((x, y) => x.start.getTime() - y.start.getTime());
  const out: SlotRange[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r.start.getTime() <= last.end.getTime()) {
      if (r.end.getTime() > last.end.getTime()) last.end = r.end;
    } else out.push(r);
  }
  return out;
}

/**
 * What is wrong with a proposal made at `now` for a match whose phase ends at
 * `deadline` (spec 6.1, D144): ranges on at least 2 Budapest days; each range
 * on whole hours, fits at least one 60-minute match, lies within 7:00–23:00
 * of one Budapest day (starts 7:00–22:00), starts after `now`, and its last
 * start is before the deadline. Empty when it is valid. Every broken rule is
 * listed, per range where it is about one range.
 */
export function proposalErrors(ranges: readonly SlotRange[], now: Date, deadline: Date, rules: SlotRules = SLOT_RULES): SlotError[] {
  const errors: SlotError[] = [];
  const good = ranges.filter((r) => valid(r.start) && valid(r.end));
  const days = new Set(good.map((r) => budapestClock(r.start).day));
  if (days.size < rules.minDays) errors.push({ code: "too_few_days" });
  ranges.forEach((r, slot) => {
    if (!valid(r.start) || !valid(r.end)) {
      errors.push({ code: "invalid", slot });
      return;
    }
    if (!isWholeHour(r.start) || !isWholeHour(r.end)) errors.push({ code: "not_whole_hour", slot });
    if (r.end.getTime() - r.start.getTime() < matchMs(rules)) errors.push({ code: "too_short", slot });
    const from = budapestClock(r.start);
    const to = budapestClock(r.end);
    if (from.minutes < rules.earliest || from.minutes > rules.latest || to.day !== from.day || to.minutes > rules.latest + rules.matchMinutes)
      errors.push({ code: "outside_window", slot });
    if (r.start.getTime() <= now.getTime()) errors.push({ code: "in_past", slot });
    if (r.end.getTime() - matchMs(rules) >= deadline.getTime()) errors.push({ code: "after_deadline", slot });
  });
  return errors;
}

/**
 * What is wrong with accepting `start` at `now` from the other pair's open
 * ranges (spec 6.2, D144): it must be on the hour, after `now`, and one of a
 * range's starts. Empty when it is valid; otherwise the first broken rule.
 */
export function acceptErrors(start: Date, ranges: readonly SlotRange[], now: Date, rules: SlotRules = SLOT_RULES): SlotError[] {
  if (!valid(start)) return [{ code: "invalid", slot: 0 }];
  if (start.getTime() <= now.getTime()) return [{ code: "in_past", slot: 0 }];
  if (ranges.some((r) => fitsRange(start, r, rules))) return [];
  // An off-hour start is only offered as the start of a range kept from before D144.
  return [{ code: isWholeHour(start) ? "not_offered" : "not_whole_hour", slot: 0 }];
}

/**
 * What is wrong with an agreed time recorded at `now` (spec 6.3, README
 * decision log 2026-10-05, D144): it only has to be on the hour, in the
 * future and before the deadline. No time window, no minimum. Empty when
 * valid.
 */
export function agreedTimeErrors(slot: Date, now: Date, deadline: Date): SlotError[] {
  if (!valid(slot)) return [{ code: "invalid", slot: 0 }];
  const errors: SlotError[] = [];
  if (!isWholeHour(slot)) errors.push({ code: "not_whole_hour", slot: 0 });
  if (slot.getTime() <= now.getTime()) errors.push({ code: "in_past", slot: 0 });
  else if (slot.getTime() >= deadline.getTime()) errors.push({ code: "after_deadline", slot: 0 });
  return errors;
}
