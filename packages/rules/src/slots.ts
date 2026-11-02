// Slot rules for scheduling a match (spec section 6, issue #8). Pure: no I/O.
//
// A proposal offers the other pair several start times; an agreed time is
// one start time the pairs already settled elsewhere (spec 6.3). Times are
// UTC instants, judged on the Budapest wall clock (calendar.ts), so a slot
// across a daylight-saving change is read as the players see it.

import { budapestClock } from "./calendar";

export type SlotRules = {
  minSlots: number; // distinct start times in a proposal
  minDays: number; // distinct Budapest days among them
  earliest: number; // first allowed start, minutes after 00:00 Budapest
  latest: number; // last allowed start, minutes after 00:00 Budapest (included)
  leadHours: number; // each slot at least this long after the proposal
};

// The league default (spec 6.1). League-specific settings come later (spec 12).
export const SLOT_RULES: SlotRules = { minSlots: 3, minDays: 2, earliest: 7 * 60, latest: 22 * 60, leadHours: 48 };

export type SlotErrorCode =
  | "invalid" // not a time at all
  | "too_few_slots"
  | "too_few_days"
  | "outside_window"
  | "too_soon"
  | "in_past"
  | "after_deadline";

// `slot` is the index of the offending slot; none for a rule on the whole set.
export type SlotError = { code: SlotErrorCode; slot?: number };

const HOUR_MS = 60 * 60 * 1000;

const clock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

// Each rule's own Hungarian message (#8 requirement 6).
export function slotErrorMessage(code: SlotErrorCode, rules: SlotRules = SLOT_RULES): string {
  switch (code) {
    case "invalid":
      return "Hibás időpont. Adj meg napot és órát.";
    case "too_few_slots":
      return `Legalább ${rules.minSlots} különböző időpontot ajánlj.`;
    case "too_few_days":
      return `Az időpontok legalább ${rules.minDays} különböző napra essenek.`;
    case "outside_window":
      return `Az időpont ${clock(rules.earliest)} és ${clock(rules.latest)} között kezdődjön.`;
    case "too_soon":
      return `Az időpont legalább ${rules.leadHours} órával későbbi legyen, mint most.`;
    case "in_past":
      return "Ez az időpont már elmúlt.";
    case "after_deadline":
      return "Az időpont a kör határideje előtt legyen.";
  }
}

const valid = (d: Date) => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * What is wrong with a proposal made at `now` for a match whose phase ends at
 * `deadline` (spec 6.1): at least 3 distinct slots on at least 2 Budapest
 * days, each starting 07:00–22:00 Budapest, at least 48 hours after `now`,
 * and before the deadline. Empty when it is valid. Every broken rule is
 * listed, per slot where it is about one slot.
 */
export function proposalErrors(slots: readonly Date[], now: Date, deadline: Date, rules: SlotRules = SLOT_RULES): SlotError[] {
  const errors: SlotError[] = [];
  const good = slots.filter(valid);
  // The same start twice is one slot: it can't make up the count.
  const distinct = new Set(good.map((d) => d.getTime()));
  if (distinct.size < rules.minSlots) errors.push({ code: "too_few_slots" });
  const days = new Set(good.map((d) => budapestClock(d).day));
  if (days.size < rules.minDays) errors.push({ code: "too_few_days" });
  slots.forEach((d, slot) => {
    if (!valid(d)) {
      errors.push({ code: "invalid", slot });
      return;
    }
    const { minutes } = budapestClock(d);
    if (minutes < rules.earliest || minutes > rules.latest) errors.push({ code: "outside_window", slot });
    if (d.getTime() - now.getTime() < rules.leadHours * HOUR_MS) errors.push({ code: "too_soon", slot });
    if (d.getTime() >= deadline.getTime()) errors.push({ code: "after_deadline", slot });
  });
  return errors;
}

/**
 * What is wrong with an agreed time recorded at `now` (spec 6.3, README
 * decision log 2026-10-05): it only has to be in the future and before the
 * deadline. No lead time, no time window, no minimum count. Empty when valid.
 */
export function agreedTimeErrors(slot: Date, now: Date, deadline: Date): SlotError[] {
  if (!valid(slot)) return [{ code: "invalid", slot: 0 }];
  if (slot.getTime() <= now.getTime()) return [{ code: "in_past", slot: 0 }];
  if (slot.getTime() >= deadline.getTime()) return [{ code: "after_deadline", slot: 0 }];
  return [];
}
