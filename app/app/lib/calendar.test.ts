import type { SchedulingEvent } from "@padel-liga/rules";
import { describe, expect, it } from "vitest";

import {
  calendarLinks,
  calendarSlot,
  googleCalendarUrl,
  icsDate,
  icsEscape,
  icsFold,
  toIcs,
  type CalendarEvent,
} from "./calendar";

const d = (iso: string) => new Date(iso);
const S1 = d("2026-11-12T17:00:00Z"); // 18:00 Budapest
const S2 = d("2026-11-13T18:30:00Z");

const proposal = (at: string, slots: Date[], clubId: number | null = null): SchedulingEvent => ({ kind: "proposal", side: "a", at: d(at), slots, clubId });
const accepted = (at: string, slot: Date): SchedulingEvent => ({ kind: "accepted", side: "b", at: d(at), slot });
const cancelled = (at: string, slot: Date, side: "a" | "b" = "a"): SchedulingEvent => ({ kind: "cancelled", side, at: d(at), slot });
const venue = (at: string, clubId: number, court?: string): SchedulingEvent => ({ kind: "venue", side: "a", at: d(at), clubId, court });

const BOOKED = [proposal("2026-11-10T10:00:00Z", [S1, S2], 1), accepted("2026-11-10T11:00:00Z", S2)];

describe("calendarSlot (#192)", () => {
  it("is null while nothing was ever scheduled", () => {
    expect(calendarSlot([])).toBeNull();
    expect(calendarSlot([proposal("2026-11-10T10:00:00Z", [S1, S2])])).toBeNull();
    // An agreed time nobody confirmed is not fixed.
    expect(calendarSlot([{ kind: "agreed_time", side: "a", at: d("2026-11-10T10:00:00Z"), slot: S1 }])).toBeNull();
  });

  it("the accepted slot is the entry, sequence 0, stamped with the time it was fixed", () => {
    expect(calendarSlot(BOOKED)).toEqual({ slot: S2, clubId: 1, court: null, cancelled: false, sequence: 0, changedAt: d("2026-11-10T11:00:00Z") });
  });

  it("a confirmed agreed time is an entry too", () => {
    const events: SchedulingEvent[] = [
      { kind: "agreed_time", side: "a", at: d("2026-11-10T10:00:00Z"), slot: S1 },
      { kind: "agreed_confirmed", side: "b", at: d("2026-11-10T12:00:00Z") },
    ];
    expect(calendarSlot(events)).toMatchObject({ slot: S1, cancelled: false, sequence: 0 });
  });

  it("the sequence grows with the venue and court", () => {
    const a = calendarSlot([...BOOKED, venue("2026-11-10T12:00:00Z", 2)])!;
    const b = calendarSlot([...BOOKED, venue("2026-11-10T12:00:00Z", 2), venue("2026-11-10T13:00:00Z", 2, "3-as pálya")])!;
    expect([a.sequence, a.clubId, a.court]).toEqual([1, 2, null]);
    expect([b.sequence, b.court]).toEqual([2, "3-as pálya"]);
  });

  it("recording the same venue again changes nothing", () => {
    const events = [...BOOKED, venue("2026-11-10T12:00:00Z", 1)];
    expect(calendarSlot(events)).toMatchObject({ sequence: 0, changedAt: d("2026-11-10T11:00:00Z") });
  });

  it("a cancelled slot stays as a cancelled entry with a higher sequence", () => {
    const events = [...BOOKED, cancelled("2026-11-11T09:00:00Z", S2)];
    expect(calendarSlot(events)).toEqual({ slot: S2, clubId: 1, court: null, cancelled: true, sequence: 1, changedAt: d("2026-11-11T09:00:00Z") });
  });

  it("a new time after a cancellation replaces it: the sequence keeps growing", () => {
    const events = [
      ...BOOKED,
      cancelled("2026-11-11T09:00:00Z", S2),
      proposal("2026-11-11T10:00:00Z", [S1, S2]),
      accepted("2026-11-11T11:00:00Z", S1),
    ];
    expect(calendarSlot(events)).toMatchObject({ slot: S1, cancelled: false, sequence: 2 });
  });

  it("the same time booked again after a cancellation still gets a new sequence", () => {
    const events = [...BOOKED, cancelled("2026-11-11T09:00:00Z", S2), proposal("2026-11-11T10:00:00Z", [S2]), accepted("2026-11-11T11:00:00Z", S2)];
    expect(calendarSlot(events)).toMatchObject({ slot: S2, cancelled: false, sequence: 2 });
  });

  it("a cancellation after the slot started changes nothing (the rules ignore it)", () => {
    expect(calendarSlot([...BOOKED, cancelled("2026-11-13T19:00:00Z", S2)])).toMatchObject({ cancelled: false, sequence: 0 });
  });

  it("a voided match (a pair withdrew) cancels the entry", () => {
    expect(calendarSlot(BOOKED, true)).toMatchObject({ cancelled: true, sequence: 1 });
    expect(calendarSlot([], true)).toBeNull();
  });
});

const EVENT: CalendarEvent = {
  matchId: 42,
  slot: S2,
  clubId: 1,
  court: "2-es pálya",
  cancelled: false,
  sequence: 3,
  changedAt: d("2026-11-10T11:00:00Z"),
  pairs: ["Kiss Anna & Nagy Bea", "Tóth Cili & Fehér Dóra"],
  players: ["Kiss Anna", "Nagy Bea", "Tóth Cili", "Fehér Dóra"],
  venue: "Ace Padel",
  url: "https://padelparbaj.hu/matches/42",
};

describe("toIcs (#192)", () => {
  const ics = toIcs(EVENT);
  const lines = ics.split("\r\n");

  it("is a CRLF calendar with one event, a stable UID and the sequence", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(lines.at(-1)).toBe("");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(lines).toContain("UID:match-42@padelparbaj.hu");
    expect(lines).toContain("SEQUENCE:3");
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(lines).toContain("DTSTAMP:20261110T110000Z");
  });

  it("starts at the UTC time and lasts 60 minutes", () => {
    expect(lines).toContain("DTSTART:20261113T183000Z");
    expect(lines).toContain("DTEND:20261113T193000Z");
  });

  it("holds the names, the venue with the court and the match link", () => {
    const text = ics.replace(/\r\n /g, "");
    expect(text).toContain("SUMMARY:Padelpárbaj: Kiss Anna & Nagy Bea – Tóth Cili & Fehér Dóra");
    expect(text).toContain("DESCRIPTION:Játékosok: Kiss Anna\\, Nagy Bea\\, Tóth Cili\\, Fehér Dóra\\nMeccs: https://padelparbaj.hu/matches/42");
    expect(text).toContain("LOCATION:Ace Padel\\, 2-es pálya");
    expect(text).toContain("URL:https://padelparbaj.hu/matches/42");
  });

  it("has no location line without a venue", () => {
    expect(toIcs({ ...EVENT, venue: null })).not.toContain("LOCATION");
  });

  it("a cancelled entry is STATUS:CANCELLED", () => {
    expect(toIcs({ ...EVENT, cancelled: true })).toContain("STATUS:CANCELLED");
  });

  it("no line is longer than 75 octets and folding loses nothing", () => {
    const long = toIcs({ ...EVENT, players: ["Ő".repeat(60), "Ű".repeat(60), "a", "b"] });
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(long.replace(/\r\n /g, "")).toContain("Ő".repeat(60));
  });
});

describe("ics helpers", () => {
  it("formats UTC times", () => expect(icsDate(d("2026-11-13T18:30:00.000Z"))).toBe("20261113T183000Z"));
  it("escapes backslash, semicolon, comma and newline", () => expect(icsEscape("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne"));
  it("folds only long lines, never inside a character", () => {
    expect(icsFold("short")).toEqual(["short"]);
    const folded = icsFold("é".repeat(80));
    expect(folded.length).toBeGreaterThan(1);
    expect(folded.slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(folded.join("").replace(/ /g, "")).toBe("é".repeat(80));
  });
});

describe("googleCalendarUrl (#192)", () => {
  const url = new URL(googleCalendarUrl(EVENT));

  it("is Google's add-event template with the time in UTC and the Budapest zone", () => {
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261113T183000Z/20261113T193000Z");
    expect(url.searchParams.get("ctz")).toBe("Europe/Budapest");
  });

  it("carries the title, the venue and court, and the details with names and link", () => {
    expect(url.searchParams.get("text")).toBe("Padelpárbaj: Kiss Anna & Nagy Bea – Tóth Cili & Fehér Dóra");
    expect(url.searchParams.get("location")).toBe("Ace Padel, 2-es pálya");
    expect(url.searchParams.get("details")).toBe("Játékosok: Kiss Anna, Nagy Bea, Tóth Cili, Fehér Dóra\nMeccs: https://padelparbaj.hu/matches/42");
  });

  it("leaves the location out without a venue", () => {
    expect(new URL(googleCalendarUrl({ ...EVENT, venue: null })).searchParams.has("location")).toBe(false);
  });
});

describe("calendarLinks", () => {
  it("is null without an entry", () => expect(calendarLinks(null)).toBeNull());
  it("gives both links for a fixed time", () => {
    expect(calendarLinks(EVENT)).toMatchObject({ icsUrl: "/matches/42/calendar.ics", cancelled: false });
    expect(calendarLinks(EVENT)!.googleUrl).toContain("calendar.google.com");
  });
  it("gives only the .ics once cancelled, so the old entry can be removed", () => {
    expect(calendarLinks({ ...EVENT, cancelled: true })).toEqual({ googleUrl: null, icsUrl: "/matches/42/calendar.ics", cancelled: true });
  });
});
