// A player's matches (#25) and scheduling them (#26): status lines, the
// Teendők items, the log lines and the form parsing. Pure (no I/O); the D1
// side is matches.server.ts, the rules are in packages/rules (slots.ts,
// scheduling.ts).

import {
  DIVISION_NAMES,
  budapestDay,
  divisionOf,
  isLateCancel,
  type SchedulingEventKind,
  type SchedulingState,
  type Side,
  type SlotRange,
} from "@padel-liga/rules";

import { formatDeadline } from "./format";
import { formatRange } from "./slot-ranges";

// "nov. 12., csütörtök 18:00": a slot or an agreed time.
export const formatSlot = formatDeadline;

// The steps the other pair gets an email about (spec 13, D68).
const EMAILED_STEPS: readonly SchedulingEventKind[] = ["proposal", "counter_proposal", "agreed_time"];

/**
 * Whether a proposal, counter-proposal or agreed time from `side` now also
 * goes to the other pair by email (#191 requirement 3, #171): only the first
 * of the Budapest calendar day on the match. The other pair's players get
 * every step from `side`, so this is one per match per recipient a day;
 * later ones that day reach them in the app and by push only. `earlier` is
 * the match's log before this step.
 */
export function schedulingEmailDue(earlier: readonly { kind: SchedulingEventKind; side: Side; at: Date }[], side: Side, now: Date): boolean {
  const today = budapestDay(now);
  return !earlier.some((e) => e.side === side && EMAILED_STEPS.includes(e.kind) && budapestDay(e.at) === today);
}

// "Réz divízió, 3. csoport" (spec 14).
export function groupLine(number: number, groupCount: number): string {
  return `${DIVISION_NAMES[divisionOf(number, groupCount)]} divízió, ${number}. csoport`;
}

// How scheduling works, on the match page (#26 requirement 7).
export const SCHEDULING_GUIDE = [
  "Adjátok meg, mikor értek rá, legalább 2 különböző napra: például szombat 14–18. Egész órák, 7:00 és 23:00 között; egy meccs 60 perc.",
  "A másik pár ebből választ egy kezdést, vagy ő ajánl mást.",
  "Ha már megbeszéltétek az időpontot (Messengeren, személyesen), rögzítsétek itt, és a másik pár megerősíti.",
];

export type Tone = "todo" | "waiting" | "done";

export type StatusView = { label: string; tone: Tone };

// The longest court name a player can type (#27).
export const COURT_MAX = 40;

// "Padel Arena, 2-es pálya": the venue and the court, if any (#27).
export function venueLine(venue: string | null | undefined, court?: string | null): string | null {
  return venue ? [venue, court].filter(Boolean).join(", ") : null;
}

/**
 * The match's status as the player of `me` sees it (#25 requirement 2). The
 * venue name, if any, is added to a scheduled match, with the court (#27).
 * After a late cancellation the cancelling pair is told it proposes next.
 */
export function statusView(state: SchedulingState, me: Side, venue?: string | null): StatusView {
  switch (state.status) {
    case "to_schedule":
      if (state.nextBy === me) return { label: "Későn mondtátok le, nektek kell új időpontokat ajánlani", tone: "todo" };
      if (state.nextBy) return { label: "Későn mondták le, nekik kell új időpontokat ajánlaniuk", tone: "waiting" };
      return { label: "Egyeztetésre vár", tone: "todo" };
    case "proposed":
      return state.by === me
        ? { label: "Ajánlottatok időpontokat, a másik pár válaszára vár", tone: "waiting" }
        : { label: "Időpontokat ajánlottak, válaszolj", tone: "todo" };
    case "agreed_time":
      return state.by === me
        ? { label: `Megbeszélt időpont (${formatSlot(state.slot)}), a másik pár megerősítésére vár`, tone: "waiting" }
        : { label: `Megbeszélt időpont (${formatSlot(state.slot)}), erősítsd meg`, tone: "todo" };
    case "scheduled":
      const where = venueLine(venue, state.court);
      return { label: `Lefixálva: ${formatSlot(state.slot)}${where ? `, ${where}` : ""}`, tone: "done" };
  }
}

// The Teendő for this match, or null when nothing waits on this player (#25
// requirement 3, spec 13). `opponents`: the other pair's names.
export function todoFor(state: SchedulingState, me: Side, opponents: string): string | null {
  switch (state.status) {
    case "to_schedule":
      // After a late cancellation only the cancelling pair (D74).
      return state.nextBy && state.nextBy !== me ? null : `Ajánlj időpontot (${opponents} ellen)`;
    case "proposed":
      return state.by === me ? null : `Válaszolj az időpont-ajánlatra (${opponents})`;
    case "agreed_time":
      return state.by === me ? null : `Erősítsd meg a megbeszélt időpontot (${opponents})`;
    case "scheduled":
      return null;
  }
}

// A log line (#26 requirement 4): what happened, without who and when. A
// cancellation says whether it was late (#27); `at` is when it happened.
export function eventText(e: {
  kind: SchedulingEventKind;
  at?: Date;
  ranges?: readonly SlotRange[] | null;
  slot?: Date | null;
  venue?: string | null;
  court?: string | null;
}): string {
  const venue = e.venue ? `, helyszín: ${e.venue}` : "";
  const slot = e.slot ? formatSlot(e.slot) : "";
  switch (e.kind) {
    case "proposal":
      return `Időpontokat ajánlott: ${(e.ranges ?? []).map((r) => formatRange(r)).join("; ")}${venue}`;
    case "counter_proposal":
      return `Új időpontokat ajánlott: ${(e.ranges ?? []).map((r) => formatRange(r)).join("; ")}${venue}`;
    case "accepted":
      return `Elfogadta: ${slot}`;
    case "agreed_time":
      return `Rögzítette a megbeszélt időpontot: ${slot}${venue}`;
    case "agreed_confirmed":
      return "Megerősítette a megbeszélt időpontot";
    case "agreed_declined":
      return "Nem erősítette meg a megbeszélt időpontot, újra egyeztettek";
    case "venue":
      return `Rögzítette a helyszínt: ${venueLine(e.venue, e.court) ?? "–"}`;
    case "cancelled":
      return e.slot && e.at && isLateCancel(e.slot, e.at)
        ? `Lemondta a meccset (${slot}). Késői lemondás: 24 órán belül volt.`
        : `Lemondta a meccset (${slot})`;
  }
}

// "+36 30 123 4567" -> "tel:+36301234567"
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
