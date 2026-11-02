// The organizer's overview of the running phase's matches (#158, D76): the
// status as a neutral party sees it, who has been active, when a match is
// stuck, and the filters. Pure (no I/O); the D1 side is
// match-overview.server.ts. Everything is read from the match's log
// (match_events, D68): there is no second log.

import { addDays, budapestTime, isValidActivity, type SchedulingEventKind, type SchedulingState, type Side } from "@padel-liga/rules";

import { weekDays } from "./groups";
import { formatSlot, type Tone } from "./matches";

export type OverviewStatus = SchedulingState["status"];

// The status filter's options, in the order a match goes through them.
// Result statuses (waiting, disputed, played) join with #28.
export const OVERVIEW_STATUSES: { value: OverviewStatus; label: string }[] = [
  { value: "to_schedule", label: "Egyeztetésre vár" },
  { value: "proposed", label: "Ajánlat, válaszra vár" },
  { value: "agreed_time", label: "Megbeszélt időpont, megerősítésre vár" },
  { value: "scheduled", label: "Lefixálva" },
];

export const isOverviewStatus = (v: string): v is OverviewStatus => OVERVIEW_STATUSES.some((s) => s.value === v);

/**
 * The status line for the organizer: whose answer a proposal or agreed time
 * waits for, by pair name; the time and venue of a scheduled match.
 */
export function overviewStatus(state: SchedulingState, names: Record<Side, string>, venue?: string | null): { label: string; tone: Tone } {
  switch (state.status) {
    case "to_schedule":
      return { label: "Egyeztetésre vár", tone: "todo" };
    case "proposed":
      return { label: `Időpontokat ajánlottak, ${names[state.by === "a" ? "b" : "a"]} válaszára vár`, tone: "waiting" };
    case "agreed_time":
      return {
        label: `Megbeszélt időpont (${formatSlot(state.slot)}), ${names[state.by === "a" ? "b" : "a"]} megerősítésére vár`,
        tone: "waiting",
      };
    case "scheduled":
      return { label: `Lefixálva: ${formatSlot(state.slot)}${venue ? `, ${venue}` : ""}`, tone: "done" };
  }
}

// How long a proposal or agreed time may wait for an answer before the match
// counts as stuck, and how many days of its scheduled week may pass without
// any valid activity (#158 definitions).
export const ANSWER_HOURS = 48;
export const QUIET_DAYS = 2;

// The start of the 3rd day of the match's scheduled week (Wednesday 00:00
// Budapest): from then on a match nobody has acted on is stuck.
export function quietUntil(phaseStartsAt: Date, week: number): Date {
  return budapestTime(addDays(weekDays(phaseStartsAt, week).start, QUIET_DAYS), 0, 0);
}

export type StuckReason = "no_activity" | "unanswered";

export const STUCK_TEXT: Record<StuckReason, string> = {
  no_activity: "Elakadt: még egyik pár sem lépett",
  unanswered: `Elakadt: ${ANSWER_HOURS} órája nincs válasz`,
};

/**
 * Why the match is stuck at `now`, or null (#158): no valid activity (spec 8)
 * by either pair after the first 2 days of its scheduled week, or a proposal
 * or agreed time unanswered for 48 hours. A match whose proposal lapsed
 * unanswered is back to scheduling and isn't stuck by this rule: its pairs
 * were active. An unconfirmed or disputed result joins with #28.
 */
export function stuckReason(input: {
  state: SchedulingState;
  kinds: readonly SchedulingEventKind[];
  phaseStartsAt: Date;
  week: number;
  now: Date;
}): StuckReason | null {
  const { state, now } = input;
  if (state.status === "proposed" || state.status === "agreed_time")
    return now.getTime() - state.at.getTime() >= ANSWER_HOURS * 3600 * 1000 ? "unanswered" : null;
  if (state.status === "scheduled") return null;
  if (input.kinds.some(isValidActivity)) return null;
  return now.getTime() >= quietUntil(input.phaseStartsAt, input.week).getTime() ? "no_activity" : null;
}

// --- Filters ------------------------------------------------------------------

export type OverviewFilter = { stuck: boolean; group: number | null; status: OverviewStatus | null };

// The filters from the URL (?stuck=1&group=2&status=proposed); anything
// unreadable is ignored.
export function parseFilter(params: URLSearchParams): OverviewFilter {
  const group = Number(params.get("group"));
  const status = params.get("status") ?? "";
  return {
    stuck: params.get("stuck") === "1",
    group: Number.isInteger(group) && group > 0 ? group : null,
    status: isOverviewStatus(status) ? status : null,
  };
}

type Filterable = { groupNumber: number; status: OverviewStatus; stuck: StuckReason | null };

/**
 * The matches the filters show, and the stuck count under the group and
 * status filters (so the count is what the stuck switch would show).
 */
export function filterMatches<T extends Filterable>(matches: readonly T[], filter: OverviewFilter): { shown: T[]; stuckCount: number } {
  const base = matches.filter((m) => (filter.group === null || m.groupNumber === filter.group) && (filter.status === null || m.status === filter.status));
  const stuck = base.filter((m) => m.stuck !== null);
  return { shown: filter.stuck ? stuck : base, stuckCount: stuck.length };
}

// "Mindkét pár", "Csak Kiss–Nagy", "Még egyik sem": who has valid activity.
export function activityLine(active: Record<Side, boolean>, names: Record<Side, string>): string {
  if (active.a && active.b) return "Mindkét pár lépett";
  if (active.a) return `Csak ${names.a} lépett`;
  if (active.b) return `Csak ${names.b} lépett`;
  return "Még egyik pár sem lépett";
}
