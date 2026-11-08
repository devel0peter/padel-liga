// Scheduling a match (spec section 6, issue #26): the state of a match from
// its log, and what each pair can do next. Pure: no I/O. The slot rules
// themselves are in slots.ts.
//
// The log is the source of truth (spec 6.5): every step is an event with its
// pair and time, kept for the walkover decision at the deadline (spec 8).
// Later steps (results: #28) add their own kinds.

// The match's two pairs, as in results.ts: "a" is pair_a, "b" pair_b.
import type { Side } from "./results";
import { budapestDay } from "./calendar";
import { fitsRange, openRanges, type SlotRange } from "./slots";

export const SCHEDULING_EVENT_KINDS = [
  "proposal", // availability ranges by the slot rules (D144)
  "counter_proposal", // the same, while the other pair's proposal or agreed time was open
  "accepted", // one start inside the other pair's ranges
  "agreed_time", // one slot agreed elsewhere (spec 6.3)
  "agreed_confirmed", // the other pair confirmed it
  "agreed_declined", // the other pair declined it: back to scheduling
  "venue", // either pair recorded where the court is booked (#27)
  "cancelled", // either pair cancelled the scheduled slot: back to scheduling (#27)
  "contacted", // a player tapped "SMS mindenkinek" or "E-mail mindenkinek" (D148): valid activity, no state change
  "agreed_auto_fixed", // the system logged that an unanswered agreed time became fixed by itself (D148)
] as const;

export type SchedulingEventKind = (typeof SCHEDULING_EVENT_KINDS)[number];

export type SchedulingEvent = {
  kind: SchedulingEventKind;
  side: Side;
  at: Date;
  ranges?: readonly SlotRange[] | null; // proposal, counter_proposal
  slot?: Date | null; // accepted, agreed_time; cancelled: the slot given up
  clubId?: number | null; // the venue offered with a proposal or agreed time, or recorded (venue)
  court?: string | null; // venue: the court, free text (optional)
};

export type SchedulingState =
  // `nextBy`: after a late cancellation, the cancelling pair must make the
  // next proposal (spec 6.6).
  | { status: "to_schedule"; nextBy?: Side }
  // `ranges`: the parts that can still be picked (openRanges).
  | { status: "proposed"; by: Side; ranges: SlotRange[]; clubId: number | null; at: Date }
  // `fixesAt`: when it becomes fixed by itself unless the other pair
  // declines first (D148).
  | { status: "agreed_time"; by: Side; slot: Date; clubId: number | null; at: Date; fixesAt: Date }
  | { status: "scheduled"; slot: Date; clubId: number | null; court?: string | null };

// A cancellation under 24 hours before the slot is late (spec 6.6, #27);
// exactly 24 hours is not.
export const LATE_CANCEL_MS = 24 * 60 * 60 * 1000;

export function isLateCancel(slot: Date, at: Date): boolean {
  return slot.getTime() - at.getTime() < LATE_CANCEL_MS;
}

export const other = (side: Side): Side => (side === "a" ? "b" : "a");

// An agreed time the other pair doesn't answer becomes fixed by itself 24
// hours after it was recorded, or at its start if that is sooner (D148).
export const AGREED_FIX_MS = 24 * 60 * 60 * 1000;

export function agreedFixAt(slot: Date, recordedAt: Date): Date {
  return new Date(Math.min(recordedAt.getTime() + AGREED_FIX_MS, slot.getTime()));
}

// An agreed time that became fixed by itself (D148): `side` is the pair that
// didn't answer, `at` the moment it became fixed.
export type AutoFix = { side: Side; at: Date; slot: Date; clubId: number | null };

function fold(events: readonly SchedulingEvent[], now: Date): { state: SchedulingState; autoFix: AutoFix | null } {
  let state: SchedulingState = { status: "to_schedule" };
  // The last fix by itself while the log doesn't have its line yet.
  let autoFix: AutoFix | null = null;
  // An unanswered agreed time whose moment came by `t` is fixed (D148).
  const settle = (t: Date) => {
    if (state.status !== "agreed_time" || state.fixesAt.getTime() > t.getTime()) return;
    autoFix = { side: other(state.by), at: state.fixesAt, slot: state.slot, clubId: state.clubId };
    state = { status: "scheduled", slot: state.slot, clubId: state.clubId };
  };
  for (const e of events) {
    settle(e.at);
    switch (e.kind) {
      case "proposal":
      case "counter_proposal":
        if (state.status === "scheduled") break;
        state = { status: "proposed", by: e.side, ranges: [...(e.ranges ?? [])], clubId: e.clubId ?? null, at: e.at };
        break;
      case "accepted":
        if (state.status === "proposed" && state.by !== e.side && e.slot && state.ranges.some((r) => fitsRange(e.slot!, r)))
          state = { status: "scheduled", slot: e.slot, clubId: state.clubId };
        break;
      case "agreed_time":
        if (state.status === "scheduled" || !e.slot) break;
        state = { status: "agreed_time", by: e.side, slot: e.slot, clubId: e.clubId ?? null, at: e.at, fixesAt: agreedFixAt(e.slot, e.at) };
        break;
      case "agreed_confirmed":
        if (state.status === "agreed_time" && state.by !== e.side) state = { status: "scheduled", slot: state.slot, clubId: state.clubId };
        break;
      case "agreed_declined":
        if (state.status === "agreed_time" && state.by !== e.side) state = { status: "to_schedule" };
        break;
      case "venue":
        if (state.status === "scheduled" && e.clubId) state = { status: "scheduled", slot: state.slot, clubId: e.clubId, court: e.court || null };
        break;
      case "cancelled":
        if (state.status === "scheduled" && e.at.getTime() < state.slot.getTime()) {
          state = isLateCancel(state.slot, e.at) ? { status: "to_schedule", nextBy: e.side } : { status: "to_schedule" };
          autoFix = null;
        }
        break;
      case "agreed_auto_fixed":
        // Only the log line: the time itself fixed it (settle).
        autoFix = null;
        break;
      // "contacted" changes nothing (D148).
    }
  }
  settle(now);
  if (state.status === "proposed") {
    const open = openRanges(state.ranges, now);
    return { state: open.length > 0 ? { ...state, ranges: open } : { status: "to_schedule" }, autoFix };
  }
  return { state, autoFix };
}

/**
 * The match's scheduling state at `now`, from its log in order. A proposal
 * with no start left after `now` in any of its ranges lapses: the match is
 * back to scheduling. An agreed time the other pair neither confirms nor
 * declines becomes fixed by itself at agreedFixAt (D148): from that moment
 * the match is scheduled, and a later decline changes nothing. A step that
 * doesn't fit the state (accepting your own proposal, confirming without an
 * agreed time) changes nothing.
 */
export function schedulingState(events: readonly SchedulingEvent[], now: Date): SchedulingState {
  return fold(events, now).state;
}

/**
 * The agreed time that became fixed by itself by `now` while the log has no
 * "agreed_auto_fixed" line for it yet (D148), or null: what the cron (or the
 * next step on the match) writes into the log. Null once the match was
 * cancelled after it.
 */
export function unloggedAutoFix(events: readonly SchedulingEvent[], now: Date): AutoFix | null {
  return fold(events, now).autoFix;
}

export type SchedulingActions = {
  propose: boolean; // a proposal, or a counter-proposal (proposalKind)
  recordAgreed: boolean;
  accept: SlotRange[]; // the other pair's open ranges: one start inside one of them
  confirm: boolean; // the other pair's agreed time
  decline: boolean;
  venue: boolean; // record or change where the court is booked (#27)
  cancel: boolean; // give up the scheduled slot (#27)
};

const NOTHING: SchedulingActions = { propose: false, recordAgreed: false, accept: [], confirm: false, decline: false, venue: false, cancel: false };

/**
 * What `side` can do at `now` (spec 6): until the deadline, either pair may
 * propose or record an agreed time, whoever went first; the other pair's open
 * proposal can be accepted, its agreed time confirmed or declined. Plain
 * rejection doesn't exist: the answer to a proposal is a counter-proposal. A
 * scheduled match takes two steps (#27): either pair records the venue, and
 * either pair cancels it until the slot starts. After a late cancellation the
 * cancelling pair must propose next, but the other pair isn't blocked (D74).
 */
export function schedulingActions(state: SchedulingState, side: Side, now: Date, deadline: Date): SchedulingActions {
  if (now.getTime() >= deadline.getTime()) return NOTHING;
  if (state.status === "scheduled") return { ...NOTHING, venue: true, cancel: now.getTime() < state.slot.getTime() };
  const theirs = state.status !== "to_schedule" && state.by !== side;
  return {
    propose: true,
    recordAgreed: true,
    accept: theirs && state.status === "proposed" ? state.ranges : [],
    confirm: theirs && state.status === "agreed_time",
    decline: theirs && state.status === "agreed_time",
    venue: false,
    cancel: false,
  };
}

// How a new proposal by `side` is logged: a counter-proposal when it answers
// the other pair's open proposal or agreed time.
export function proposalKind(state: SchedulingState, side: Side): "proposal" | "counter_proposal" {
  return state.status !== "to_schedule" && state.status !== "scheduled" && state.by !== side ? "counter_proposal" : "proposal";
}

// Whose move it is: the pair that has to answer, both while nothing is open
// (after a late cancellation only the cancelling pair), none once scheduled.
export function waitingFor(state: SchedulingState): Side[] {
  if (state.status === "scheduled") return [];
  if (state.status === "to_schedule") return state.nextBy ? [state.nextBy] : ["a", "b"];
  return [other(state.by)];
}

// Valid activity (spec 8): a proposal or counter-proposal, recording an
// agreed time, confirming one, or tapping "SMS mindenkinek" / "E-mail
// mindenkinek" (D148). Accepting and declining are not, nor is a time that
// became fixed by itself.
export function isValidActivity(kind: SchedulingEventKind): boolean {
  return kind === "proposal" || kind === "counter_proposal" || kind === "agreed_time" || kind === "agreed_confirmed" || kind === "contacted";
}

// A tap on "SMS mindenkinek" / "E-mail mindenkinek" goes into the log once
// per pair per Budapest day (D148): whether `side` still has none today.
export function contactDue(events: readonly { kind: SchedulingEventKind; side: Side; at: Date }[], side: Side, now: Date): boolean {
  const today = budapestDay(now);
  return !events.some((e) => e.kind === "contacted" && e.side === side && budapestDay(e.at) === today);
}

// The pairs with valid activity before the deadline, for the walkover
// decision (spec 8, #11).
export function activeSides(events: readonly SchedulingEvent[], deadline: Date): Side[] {
  const sides = new Set(events.filter((e) => isValidActivity(e.kind) && e.at.getTime() < deadline.getTime()).map((e) => e.side));
  return (["a", "b"] as const).filter((s) => sides.has(s));
}

// The pairs that cancelled late (under 24 hours before the slot) before the
// deadline. If the match isn't played by the deadline, such a pair counts as
// the inactive side whatever its earlier activity (spec 6.6 and 8, for #11).
export function lateCancellers(events: readonly SchedulingEvent[], deadline: Date): Side[] {
  const sides = new Set<Side>();
  events.forEach((e, i) => {
    if (e.kind !== "cancelled" || e.at.getTime() >= deadline.getTime()) return;
    const before = schedulingState(events.slice(0, i), e.at);
    if (before.status === "scheduled" && e.at.getTime() < before.slot.getTime() && isLateCancel(before.slot, e.at)) sides.add(e.side);
  });
  return (["a", "b"] as const).filter((s) => sides.has(s));
}
