import { describe, expect, it } from "vitest";

import { formatDate, formatDeadline, formatShortDate } from "./format";

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
