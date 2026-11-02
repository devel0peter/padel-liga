// Scheduling a match (spec section 6, issue #26): the state of a match from
// its log, and what each pair can do next. Pure: no I/O. The slot rules
// themselves are in slots.ts.
//
// The log is the source of truth (spec 6.5): every step is an event with its
// pair and time, kept for the walkover decision at the deadline (spec 8).
// Later steps (cancel, venue, results: #27, #28) add their own kinds.

export type Side = "a" | "b";

export const SCHEDULING_EVENT_KINDS = [
  "proposal", // at least 3 slots by the slot rules
  "counter_proposal", // the same, while the other pair's proposal or agreed time was open
  "accepted", // one slot of the other pair's proposal
  "agreed_time", // one slot agreed elsewhere (spec 6.3)
  "agreed_confirmed", // the other pair confirmed it
  "agreed_declined", // the other pair declined it: back to scheduling
] as const;

export type SchedulingEventKind = (typeof SCHEDULING_EVENT_KINDS)[number];

export type SchedulingEvent = {
  kind: SchedulingEventKind;
  side: Side;
  at: Date;
  slots?: readonly Date[] | null; // proposal, counter_proposal
  slot?: Date | null; // accepted, agreed_time
  clubId?: number | null; // the venue offered with a proposal or agreed time
};

export type SchedulingState =
  | { status: "to_schedule" }
  // `slots`: the ones that haven't started yet.
  | { status: "proposed"; by: Side; slots: Date[]; clubId: number | null; at: Date }
  | { status: "agreed_time"; by: Side; slot: Date; clubId: number | null; at: Date }
  | { status: "scheduled"; slot: Date; clubId: number | null };

export const other = (side: Side): Side => (side === "a" ? "b" : "a");

/**
 * The match's scheduling state at `now`, from its log in order. A proposal
 * whose slots have all started lapses, and so does an unconfirmed agreed time
 * once its start passes (spec 6.3): the match is back to scheduling. A step
 * that doesn't fit the state (accepting your own proposal, confirming without
 * an agreed time) changes nothing.
 */
export function schedulingState(events: readonly SchedulingEvent[], now: Date): SchedulingState {
  let state: SchedulingState = { status: "to_schedule" };
  for (const e of events) {
    switch (e.kind) {
      case "proposal":
      case "counter_proposal":
        if (state.status === "scheduled") break;
        state = { status: "proposed", by: e.side, slots: [...(e.slots ?? [])], clubId: e.clubId ?? null, at: e.at };
        break;
      case "accepted":
        if (state.status === "proposed" && state.by !== e.side && e.slot && state.slots.some((s) => s.getTime() === e.slot!.getTime()))
          state = { status: "scheduled", slot: e.slot, clubId: state.clubId };
        break;
      case "agreed_time":
        if (state.status === "scheduled" || !e.slot) break;
        state = { status: "agreed_time", by: e.side, slot: e.slot, clubId: e.clubId ?? null, at: e.at };
        break;
      case "agreed_confirmed":
        if (state.status === "agreed_time" && state.by !== e.side) state = { status: "scheduled", slot: state.slot, clubId: state.clubId };
        break;
      case "agreed_declined":
        if (state.status === "agreed_time" && state.by !== e.side) state = { status: "to_schedule" };
        break;
    }
  }
  if (state.status === "proposed") {
    const open = state.slots.filter((s) => s.getTime() > now.getTime());
    return open.length > 0 ? { ...state, slots: open } : { status: "to_schedule" };
  }
  if (state.status === "agreed_time" && state.slot.getTime() <= now.getTime()) return { status: "to_schedule" };
  return state;
}

export type SchedulingActions = {
  propose: boolean; // a proposal, or a counter-proposal (proposalKind)
  recordAgreed: boolean;
  accept: Date[]; // the other pair's open slots
  confirm: boolean; // the other pair's agreed time
  decline: boolean;
};

const NOTHING: SchedulingActions = { propose: false, recordAgreed: false, accept: [], confirm: false, decline: false };

/**
 * What `side` can do at `now` (spec 6): until the deadline, either pair may
 * propose or record an agreed time, whoever went first; the other pair's open
 * proposal can be accepted, its agreed time confirmed or declined. Plain
 * rejection doesn't exist: the answer to a proposal is a counter-proposal. A
 * scheduled match takes no more steps here (cancelling is #27).
 */
export function schedulingActions(state: SchedulingState, side: Side, now: Date, deadline: Date): SchedulingActions {
  if (now.getTime() >= deadline.getTime() || state.status === "scheduled") return NOTHING;
  const theirs = state.status !== "to_schedule" && state.by !== side;
  return {
    propose: true,
    recordAgreed: true,
    accept: theirs && state.status === "proposed" ? state.slots : [],
    confirm: theirs && state.status === "agreed_time",
    decline: theirs && state.status === "agreed_time",
  };
}

// How a new proposal by `side` is logged: a counter-proposal when it answers
// the other pair's open proposal or agreed time.
export function proposalKind(state: SchedulingState, side: Side): "proposal" | "counter_proposal" {
  return state.status !== "to_schedule" && state.status !== "scheduled" && state.by !== side ? "counter_proposal" : "proposal";
}

// Whose move it is: the pair that has to answer, both while nothing is open,
// none once scheduled.
export function waitingFor(state: SchedulingState): Side[] {
  if (state.status === "scheduled") return [];
  if (state.status === "to_schedule") return ["a", "b"];
  return [other(state.by)];
}

// Valid activity (spec 8): a proposal or counter-proposal, recording an
// agreed time, or confirming one. Accepting and declining are not.
export function isValidActivity(kind: SchedulingEventKind): boolean {
  return kind === "proposal" || kind === "counter_proposal" || kind === "agreed_time" || kind === "agreed_confirmed";
}

// The pairs with valid activity before the deadline, for the walkover
// decision (spec 8, #11).
export function activeSides(events: readonly SchedulingEvent[], deadline: Date): Side[] {
  const sides = new Set(events.filter((e) => isValidActivity(e.kind) && e.at.getTime() < deadline.getTime()).map((e) => e.side));
  return (["a", "b"] as const).filter((s) => sides.has(s));
}
