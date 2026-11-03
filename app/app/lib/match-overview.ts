// The organizer's overview of the running phase's matches (#158, D76): the
// status as a neutral party sees it, who has been active, when a match is
// stuck, and the filters. Pure (no I/O); the D1 side is
// match-overview.server.ts. Everything is read from the match's log
// (match_events, D68): there is no second log.

import { addDays, budapestTime, isValidActivity, other, type ResultState, type SchedulingEventKind, type SchedulingState, type Side } from "@padel-liga/rules";

import { weekDays } from "./groups";
import { formatSlot, venueLine, type Tone } from "./matches";
import { neutralOutcomeText, neutralScoreText } from "./results";

// Scheduling, then the result (#28): once a result is recorded, its status
// is the match's.
export type OverviewStatus = SchedulingState["status"] | "result_pending" | "disputed" | "final";

// The status filter's options, in the order a match goes through them.
export const OVERVIEW_STATUSES: { value: OverviewStatus; label: string }[] = [
  { value: "to_schedule", label: "Egyeztetésre vár" },
  { value: "proposed", label: "Ajánlat, válaszra vár" },
  { value: "agreed_time", label: "Megbeszélt időpont, megerősítésre vár" },
  { value: "scheduled", label: "Lefixálva" },
  { value: "result_pending", label: "Eredmény, megerősítésre vár" },
  { value: "disputed", label: "Vitatott eredmény" },
  { value: "final", label: "Lejátszva" },
];

/** The match's status: the result's once there is one, else scheduling's. */
export function statusOf(scheduling: SchedulingState, result: ResultState): OverviewStatus {
  switch (result.status) {
    case "recorded":
      return "result_pending";
    case "disputed":
      return "disputed";
    case "final":
      return "final";
    case "none":
      return scheduling.status;
  }
}

/**
 * The status line of a match with a result (#28, #29), or null without one:
 * the score and whose confirmation it waits for, a dispute, or the outcome
 * that counts (score and winner, from the 1st pair's side).
 */
export function resultStatus(result: ResultState, names: Record<Side, string>): { label: string; tone: Tone } | null {
  switch (result.status) {
    case "none":
      return null;
    case "recorded":
      return { label: `Eredmény: ${neutralScoreText(result.score)}, ${names[other(result.by)]} megerősítésére vár`, tone: "waiting" };
    case "disputed":
      return { label: "Vitatott eredmény, a szervező dönt", tone: "todo" };
    case "final":
      return { label: `${result.how === "organizer" ? "Döntés" : "Lejátszva"}: ${neutralOutcomeText(result.outcome, names)}`, tone: "done" };
  }
}

export const isOverviewStatus = (v: string): v is OverviewStatus => OVERVIEW_STATUSES.some((s) => s.value === v);

/**
 * The status line for the organizer: whose answer a proposal or agreed time
 * waits for, by pair name; the time and venue of a scheduled match.
 */
export function overviewStatus(state: SchedulingState, names: Record<Side, string>, venue?: string | null): { label: string; tone: Tone } {
  switch (state.status) {
    case "to_schedule":
      // After a late cancellation (#27) the cancelling pair must propose next.
      return state.nextBy
        ? { label: `Későn lemondták, ${names[state.nextBy]} ajánl új időpontot`, tone: "todo" }
        : { label: "Egyeztetésre vár", tone: "todo" };
    case "proposed":
      return { label: `Időpontokat ajánlottak, ${names[state.by === "a" ? "b" : "a"]} válaszára vár`, tone: "waiting" };
    case "agreed_time":
      return {
        label: `Megbeszélt időpont (${formatSlot(state.slot)}), ${names[state.by === "a" ? "b" : "a"]} megerősítésére vár`,
        tone: "waiting",
      };
    case "scheduled":
      const where = venueLine(venue, state.court);
      return { label: `Lefixálva: ${formatSlot(state.slot)}${where ? `, ${where}` : ""}`, tone: "done" };
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

export type StuckReason = "no_activity" | "unanswered" | "unconfirmed" | "disputed";

// The steps that wait for the other pair's answer.
const OFFER_KINDS: readonly SchedulingEventKind[] = ["proposal", "counter_proposal", "agreed_time"];

export const STUCK_TEXT: Record<StuckReason, string> = {
  no_activity: "Elakadt: még egyik pár sem lépett",
  unanswered: `Elakadt: ${ANSWER_HOURS} órája nincs válasz`,
  unconfirmed: "Elakadt: az eredmény megerősítésre vár",
  disputed: "Elakadt: vitatott eredmény, dönts róla",
};

/**
 * Why the match is stuck at `now`, or null (#158): no valid activity (spec 8)
 * by either pair after the first 2 days of its scheduled week, or a proposal
 * or agreed time unanswered for 48 hours. That includes one that lapsed
 * unanswered (all its slots started, or the agreed time passed): the match
 * is back to scheduling, but the other pair still never answered, so it
 * stays stuck until someone steps again. A result (#28) decides alone: one
 * that counts is never stuck, an unconfirmed or disputed one always is.
 */
export function stuckReason(input: {
  state: SchedulingState;
  // The match's log in order: what happened and when.
  events: readonly { kind: SchedulingEventKind; at: Date }[];
  // The result (#28); none when omitted.
  result?: ResultState;
  phaseStartsAt: Date;
  week: number;
  now: Date;
}): StuckReason | null {
  const { state, now } = input;
  if (input.result?.status === "final") return null;
  if (input.result?.status === "recorded") return "unconfirmed";
  if (input.result?.status === "disputed") return "disputed";
  const waited = (since: Date) => now.getTime() - since.getTime() >= ANSWER_HOURS * 3600 * 1000;
  if (state.status === "proposed" || state.status === "agreed_time") return waited(state.at) ? "unanswered" : null;
  if (state.status === "scheduled") return null;
  // Back to scheduling with an offer as the newest step: it lapsed, nobody
  // accepted, confirmed, declined or answered it with their own.
  const last = input.events.at(-1);
  if (last && OFFER_KINDS.includes(last.kind)) return waited(last.at) ? "unanswered" : null;
  if (input.events.some((e) => isValidActivity(e.kind))) return null;
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
