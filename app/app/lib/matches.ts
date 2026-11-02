// A player's matches (#25) and scheduling them (#26): status lines, the
// Teendők items, the log lines and the form parsing. Pure (no I/O); the D1
// side is matches.server.ts, the rules are in packages/rules (slots.ts,
// scheduling.ts).

import { DIVISION_NAMES, budapestTime, divisionOf, isDay, type SchedulingEventKind, type SchedulingState, type Side } from "@padel-liga/rules";

import { formatDeadline } from "./format";

// "nov. 12., csütörtök 18:00": a slot or an agreed time.
export const formatSlot = formatDeadline;

// "Réz divízió, 3. csoport" (spec 14).
export function groupLine(number: number, groupCount: number): string {
  return `${DIVISION_NAMES[divisionOf(number, groupCount)]} divízió, ${number}. csoport`;
}

// How scheduling works, on the match page (#26 requirement 7).
export const SCHEDULING_GUIDE = [
  "Ajánljatok legalább 3 időpontot, legalább 2 különböző napra, 7:00 és 22:00 közé, legalább 48 órával előre.",
  "Ha már megbeszéltétek az időpontot (Messengeren, személyesen), rögzítsétek itt, és a másik pár megerősíti.",
  "A másik pár itt választ egyet az időpontjaitok közül, vagy újakat ajánl.",
];

export type Tone = "todo" | "waiting" | "done";

export type StatusView = { label: string; tone: Tone };

/**
 * The match's status as the player of `me` sees it (#25 requirement 2). The
 * venue name, if any, is added to a scheduled match.
 */
export function statusView(state: SchedulingState, me: Side, venue?: string | null): StatusView {
  switch (state.status) {
    case "to_schedule":
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
      return { label: `Lefixálva: ${formatSlot(state.slot)}${venue ? `, ${venue}` : ""}`, tone: "done" };
  }
}

// The Teendő for this match, or null when nothing waits on this player (#25
// requirement 3, spec 13). `opponents`: the other pair's names.
export function todoFor(state: SchedulingState, me: Side, opponents: string): string | null {
  switch (state.status) {
    case "to_schedule":
      return `Ajánlj időpontot (${opponents} ellen)`;
    case "proposed":
      return state.by === me ? null : `Válaszolj az időpont-ajánlatra (${opponents})`;
    case "agreed_time":
      return state.by === me ? null : `Erősítsd meg a megbeszélt időpontot (${opponents})`;
    case "scheduled":
      return null;
  }
}

// A log line (#26 requirement 4): what happened, without who and when.
export function eventText(e: { kind: SchedulingEventKind; slots?: readonly Date[] | null; slot?: Date | null; venue?: string | null }): string {
  const venue = e.venue ? `, helyszín: ${e.venue}` : "";
  const slot = e.slot ? formatSlot(e.slot) : "";
  switch (e.kind) {
    case "proposal":
      return `Időpontokat ajánlott: ${(e.slots ?? []).map(formatSlot).join("; ")}${venue}`;
    case "counter_proposal":
      return `Új időpontokat ajánlott: ${(e.slots ?? []).map(formatSlot).join("; ")}${venue}`;
    case "accepted":
      return `Elfogadta: ${slot}`;
    case "agreed_time":
      return `Rögzítette a megbeszélt időpontot: ${slot}${venue}`;
    case "agreed_confirmed":
      return "Megerősítette a megbeszélt időpontot";
    case "agreed_declined":
      return "Nem erősítette meg a megbeszélt időpontot, újra egyeztettek";
  }
}

const SLOT_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/**
 * A datetime-local field ("2026-11-12T18:00") read as Budapest time, whatever
 * the browser's own time zone. Null for anything else; "" for an empty field.
 */
export function parseSlot(value: string): Date | null | "" {
  const v = value.trim();
  if (v === "") return "";
  const m = SLOT_RE.exec(v);
  if (!m || !isDay(m[1]!)) return null;
  const [h, min] = [Number(m[2]), Number(m[3])];
  if (h > 23 || min > 59) return null;
  return budapestTime(m[1]!, h, min);
}

// The proposal form's slots: empty rows are skipped, unreadable ones stay as
// an invalid date so the slot rules report them.
export function parseSlots(values: readonly string[]): Date[] {
  return values.flatMap((v) => {
    const d = parseSlot(v);
    return d === "" ? [] : [d ?? new Date(Number.NaN)];
  });
}

// "+36 30 123 4567" -> "tel:+36301234567"
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
