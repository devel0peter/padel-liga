import { schedulingState, type SchedulingEvent } from "@padel-liga/rules";

// Adding a match to the player's calendar (#192, D106). Pure: the calendar
// entry of a match is worked out from its scheduling log; the .ics text and
// the Google Calendar link are built from it. The entry holds names, the
// time, the venue and the match page link, never an email address or phone
// number (the builders only get names).

export const CALENDAR_PRODID = "-//Padelpárbaj//Meccs//HU";
export const CALENDAR_UID_DOMAIN = "padelparbaj.hu";
// A match is booked for an hour.
export const MATCH_MINUTES = 60;
export const CALENDAR_TIME_ZONE = "Europe/Budapest";

export type CalendarSlot = {
  // The match is scheduled for this start (UTC); `cancelled`: it was, and
  // the slot is given up (or the match was voided), so the entry must go.
  slot: Date;
  clubId: number | null;
  court: string | null;
  cancelled: boolean;
  // Grows with every change of the scheduled slot, venue or court, and with
  // the cancellation, so a new download replaces the entry already in a
  // calendar (RFC 5545 SEQUENCE).
  sequence: number;
  // When the entry last changed; the stable DTSTAMP of this version.
  changedAt: Date;
};

type Tuple = { slot: Date; clubId: number | null; court: string | null };

const sameTuple = (a: Tuple, b: Tuple) => a.slot.getTime() === b.slot.getTime() && a.clubId === b.clubId && (a.court ?? null) === (b.court ?? null);

/**
 * The calendar entry of a match from its log: the scheduled slot, or, once
 * it is cancelled and nothing new is fixed, the cancelled one (null if the
 * match was never scheduled). `voided`: a pair withdrew (#34), the match is
 * off, so a slot still in a calendar is cancelled.
 */
export function calendarSlot(events: readonly SchedulingEvent[], voided = false): CalendarSlot | null {
  let last: Tuple | null = null;
  let cancelled = false;
  let sequence = -1;
  let changedAt: Date | null = null;
  events.forEach((e, i) => {
    const state = schedulingState(events.slice(0, i + 1), e.at);
    if (state.status === "scheduled") {
      const now: Tuple = { slot: state.slot, clubId: state.clubId, court: state.court ?? null };
      if (cancelled || !last || !sameTuple(last, now)) {
        sequence += 1;
        changedAt = e.at;
      }
      last = now;
      cancelled = false;
    } else if (last && !cancelled) {
      // Scheduled before, not any more: cancelled.
      cancelled = true;
      sequence += 1;
      changedAt = e.at;
    }
  });
  if (!last || !changedAt) return null;
  if (voided && !cancelled) {
    // The log has no withdrawal time, so DTSTAMP keeps the last logged change;
    // the SEQUENCE bump is what makes calendars take the cancellation.
    cancelled = true;
    sequence += 1;
  }
  return { ...(last as Tuple), cancelled, sequence, changedAt };
}

export type CalendarEvent = CalendarSlot & {
  matchId: number;
  // The four players' names, own pair first; the pairs as the title shows them.
  pairs: [string, string];
  players: string[];
  venue: string | null;
  // Absolute link to the match page.
  url: string;
};

export const eventTitle = (e: Pick<CalendarEvent, "pairs">) => `Padelpárbaj: ${e.pairs[0]} – ${e.pairs[1]}`;

function details(e: CalendarEvent): string {
  return [`Játékosok: ${e.players.join(", ")}`, `Meccs: ${e.url}`].join("\n");
}

export function eventLocation(e: Pick<CalendarEvent, "venue" | "court">): string | null {
  if (!e.venue) return null;
  return e.court ? `${e.venue}, ${e.court}` : e.venue;
}

const endOf = (slot: Date) => new Date(slot.getTime() + MATCH_MINUTES * 60_000);

// 2026-11-10T17:30:00Z -> "20261110T173000Z"
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Content lines are at most 75 octets; a longer one continues on the next
// line after a space. Never splits a UTF-8 character.
export function icsFold(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    if (bytes + size > limit) {
      out.push(current);
      current = " ";
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out;
}

export function icsUid(matchId: number): string {
  return `match-${matchId}@${CALENDAR_UID_DOMAIN}`;
}

/** The .ics file of the entry (CRLF lines, UTC times). */
export function toIcs(e: CalendarEvent): string {
  const location = eventLocation(e);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${CALENDAR_PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-TIMEZONE:${CALENDAR_TIME_ZONE}`,
    "BEGIN:VEVENT",
    `UID:${icsUid(e.matchId)}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${icsDate(e.changedAt)}`,
    `DTSTART:${icsDate(e.slot)}`,
    `DTEND:${icsDate(endOf(e.slot))}`,
    `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `SUMMARY:${icsEscape(eventTitle(e))}`,
    `DESCRIPTION:${icsEscape(details(e))}`,
    ...(location ? [`LOCATION:${icsEscape(location)}`] : []),
    `URL:${e.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.flatMap(icsFold).join("\r\n") + "\r\n";
}

/** Google Calendar's "add event" template link (the time in UTC, shown in Budapest time). */
export function googleCalendarUrl(e: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: eventTitle(e),
    dates: `${icsDate(e.slot)}/${icsDate(endOf(e.slot))}`,
    details: details(e),
    ctz: CALENDAR_TIME_ZONE,
  });
  const location = eventLocation(e);
  if (location) params.set("location", location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function icsFileName(matchId: number): string {
  return `meccs-${matchId}.ics`;
}

/** What the match page shows under the time (null: nothing to add or remove). */
export type CalendarLinks = { googleUrl: string | null; icsUrl: string; cancelled: boolean };

export function calendarLinks(e: CalendarEvent | null): CalendarLinks | null {
  if (!e) return null;
  return { googleUrl: e.cancelled ? null : googleCalendarUrl(e), icsUrl: `/matches/${e.matchId}/calendar.ics`, cancelled: e.cancelled };
}
