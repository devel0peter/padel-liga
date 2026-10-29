import { describe, expect, it } from "vitest";

import { formatDate, formatDeadline, formatOnDate, formatShortDate } from "./format";

describe("Hungarian dates in Budapest time", () => {
  // Sunday 14 Feb 2027, 23:59 Budapest (CET).
  const deadline = new Date("2027-02-14T22:59:00Z");

  it("formats a full date", () => {
    expect(formatDate(deadline)).toBe("2027. 02. 14.");
  });

  it("formats a deadline with the weekday and 24-hour time", () => {
    expect(formatDeadline(deadline)).toBe("febr. 14., vasárnap 23:59");
  });

  it("shows the Budapest day, not the UTC one", () => {
    // Monday 9 Nov 2026 00:00 Budapest is still Sunday in UTC.
    expect(formatShortDate(new Date("2026-11-08T23:00:00Z"))).toBe("nov. 9.");
  });
});

describe("formatOnDate (#131)", () => {
  it("says on which day, in Budapest time: november 9-én", () => {
    // Monday 9 Nov 2026 00:00 Budapest is still Sunday in UTC.
    expect(formatOnDate(new Date("2026-11-08T23:00:00Z"))).toBe("november 9-én");
  });

  it("puts the right ending on every day of the month", () => {
    const endings: Record<number, string> = {
      1: "jén", 2: "án", 3: "án", 4: "én", 5: "én", 6: "án", 7: "én", 8: "án", 9: "én", 10: "én",
      11: "én", 12: "én", 13: "án", 14: "én", 15: "én", 16: "án", 17: "én", 18: "án", 19: "én", 20: "án",
      21: "én", 22: "én", 23: "án", 24: "én", 25: "én", 26: "án", 27: "én", 28: "án", 29: "én", 30: "án", 31: "én",
    };
    for (let day = 1; day <= 31; day++)
      expect(formatOnDate(new Date(Date.UTC(2027, 0, day, 12)))).toBe(`január ${day}-${endings[day]}`);
  });
});
