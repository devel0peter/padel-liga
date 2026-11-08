import { budapestTime, proposalErrors } from "@padel-liga/rules";
import { describe, expect, it } from "vitest";

import {
  dayChip,
  endHours,
  formatRange,
  parseRangeField,
  parseStartField,
  pickerDays,
  presetRanges,
  rangeField,
  startField,
  storedRanges,
  toStoredRanges,
} from "./slot-ranges";

const at = (day: string, h: number, m = 0) => budapestTime(day, h, m);
const range = (day: string, from: number, to: number) => ({ start: at(day, from), end: at(day, to) });
const secs = (d: Date) => d.getTime() / 1000;
const invalid = (d: Date) => Number.isNaN(d.getTime());

describe("storedRanges (D144)", () => {
  it("reads [start, end] pairs in seconds", () => {
    const r = range("2026-11-14", 14, 18);
    expect(storedRanges([[secs(r.start), secs(r.end)]])).toEqual([r]);
  });

  it("reads a bare start, as stored before D144, as a range one match long", () => {
    const start = at("2026-11-13", 19, 30);
    expect(storedRanges([secs(start)])).toEqual([{ start, end: at("2026-11-13", 20, 30) }]);
  });

  it("reads both formats in one list, and skips anything unreadable", () => {
    const r = range("2026-11-14", 14, 18);
    expect(storedRanges([secs(at("2026-11-12", 18)), [secs(r.start), secs(r.end)], "x", [1], [1, "2"], null])).toEqual([range("2026-11-12", 18, 19), r]);
    expect(storedRanges(null)).toEqual([]);
    expect(storedRanges("[1,2]")).toEqual([]);
  });

  it("round-trips with toStoredRanges", () => {
    const ranges = [range("2026-11-14", 14, 18), range("2026-11-15", 7, 8)];
    expect(storedRanges(JSON.parse(JSON.stringify(toStoredRanges(ranges))))).toEqual(ranges);
  });
});

describe("formatRange", () => {
  it("a range with its end; one a match long as its start", () => {
    expect(formatRange(range("2026-11-14", 14, 18))).toBe("nov. 14., szombat 14:00–18:00");
    expect(formatRange(range("2026-11-14", 14, 15))).toBe("nov. 14., szombat 14:00");
    expect(formatRange(range("2026-11-14", 22, 23))).toBe("nov. 14., szombat 22:00");
    expect(formatRange(range("2026-11-14", 7, 23))).toBe("nov. 14., szombat 07:00–23:00");
  });
});

describe("form fields: Budapest days and hours, whatever the browser's time zone", () => {
  it("a range field is a Budapest day and two whole hours, in winter and in summer", () => {
    expect(rangeField("2026-11-14", 14, 18)).toBe("2026-11-14|14|18");
    expect(parseRangeField("2026-11-14|14|18")).toEqual({ start: new Date("2026-11-14T13:00:00Z"), end: new Date("2026-11-14T17:00:00Z") });
    expect(parseRangeField("2027-04-03|14|18")).toEqual({ start: new Date("2027-04-03T12:00:00Z"), end: new Date("2027-04-03T16:00:00Z") });
  });

  it("an unreadable range field is invalid, so the slot rules report it", () => {
    for (const bad of ["", "2026-11-14|14", "2026-11-31|14|18", "2026-11-14|24|25", "2026-11-14|1.5|3", "holnap|14|18"]) {
      const r = parseRangeField(bad);
      expect(invalid(r.start) && invalid(r.end), bad).toBe(true);
    }
    expect(proposalErrors([parseRangeField("rossz")], at("2026-11-10", 10), at("2026-11-29", 23, 59)).map((e) => e.code)).toEqual(["too_few_days", "invalid"]);
  });

  it("a start field is a Budapest day and a whole hour", () => {
    expect(startField("2026-11-14", 9)).toBe("2026-11-14|9");
    expect(parseStartField("2026-11-14|9")).toEqual(new Date("2026-11-14T08:00:00Z"));
    for (const bad of ["", "2026-11-14", "2026-11-14|24", "2026-11-14T18:00", "2026-02-30|10"]) expect(invalid(parseStartField(bad)), bad).toBe(true);
  });
});

describe("pickerDays", () => {
  const deadline = at("2026-11-29", 23, 59);

  it("from today to the deadline's day, each with its whole-hour starts 7:00–22:00 still ahead", () => {
    const days = pickerDays(at("2026-11-27", 15, 20), deadline);
    expect(days.map((d) => d.day)).toEqual(["2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(days[0]!.hours).toEqual([16, 17, 18, 19, 20, 21, 22]);
    expect(days[1]!.hours).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
  });

  it("today is left out once its last start has passed; on the hour, that hour is gone", () => {
    expect(pickerDays(at("2026-11-27", 22), deadline).map((d) => d.day)).toEqual(["2026-11-28", "2026-11-29"]);
    expect(pickerDays(at("2026-11-27", 21), deadline)[0]!.hours).toEqual([22]);
  });

  it("starts before the deadline only", () => {
    const days = pickerDays(at("2026-11-27", 10), at("2026-11-28", 12));
    expect(days.at(-1)).toEqual({ day: "2026-11-28", hours: [7, 8, 9, 10, 11] });
    expect(pickerDays(deadline, deadline)).toEqual([]);
  });
});

describe("endHours and presetRanges", () => {
  const full = { day: "2026-11-28", hours: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] };

  it("a range ends an hour after a start at the latest, 23:00 on a full day", () => {
    expect(endHours(full, 20)).toEqual([21, 22, 23]);
    expect(endHours(full, 22)).toEqual([23]);
  });

  it("the three quick ranges on a full day", () => {
    expect(presetRanges(full)).toEqual([
      { label: "Délelőtt", from: 8, to: 12 },
      { label: "Délután", from: 14, to: 18 },
      { label: "Este", from: 18, to: 22 },
    ]);
  });

  it("cut to the hours left today; one with no start left is not offered", () => {
    expect(presetRanges({ day: "2026-11-27", hours: [16, 17, 18, 19, 20, 21, 22] })).toEqual([
      { label: "Délután", from: 16, to: 18 },
      { label: "Este", from: 18, to: 22 },
    ]);
    expect(presetRanges({ day: "2026-11-27", hours: [21, 22] })).toEqual([{ label: "Este", from: 21, to: 22 }]);
    expect(presetRanges({ day: "2026-11-27", hours: [22] })).toEqual([]);
  });

  it("cut by the deadline", () => {
    expect(presetRanges({ day: "2026-11-28", hours: [7, 8, 9, 10, 11, 12, 13, 14, 15] })).toEqual([
      { label: "Délelőtt", from: 8, to: 12 },
      { label: "Délután", from: 14, to: 16 },
    ]);
  });
});

describe("dayChip", () => {
  it("the date and the short weekday", () => {
    expect(dayChip("2026-11-14")).toEqual({ date: "nov. 14.", weekday: "szo" });
    expect(dayChip("2026-11-16")).toEqual({ date: "nov. 16.", weekday: "h" });
    expect(dayChip("2026-11-18")).toEqual({ date: "nov. 18.", weekday: "sze" });
  });
});
