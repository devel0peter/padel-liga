import { describe, expect, it } from "vitest";

import { budapestTime, phaseCalendar } from "./calendar";
import { DEFAULT_MIN_ENTRIES, entriesMissing, firstSeasonStart } from "./season-start";

// 2026-11-16 is a Monday, 2026-11-17 a Tuesday.
const MONDAY_NOON = budapestTime("2026-11-16", 12, 0);
const TUESDAY_NOON = budapestTime("2026-11-17", 12, 0);

describe("firstSeasonStart (D124, #335)", () => {
  it("has no start while the entries are one below the minimum", () => {
    expect(firstSeasonStart({ entries: 11, minimum: 12, at: MONDAY_NOON, breaks: [] })).toBeNull();
    expect(firstSeasonStart({ entries: 0, minimum: 12, at: MONDAY_NOON, breaks: [] })).toBeNull();
  });

  it("the entry that reaches the minimum on a Monday starts the season the Monday a week later", () => {
    expect(firstSeasonStart({ entries: 12, minimum: 12, at: MONDAY_NOON, breaks: [] })).toBe("2026-11-23");
  });

  it("reached on a Tuesday: the Monday 13 days later", () => {
    expect(firstSeasonStart({ entries: 12, minimum: 12, at: TUESDAY_NOON, breaks: [] })).toBe("2026-11-30");
  });

  it("reached on a Sunday: the Monday 8 days later (at least 7 days)", () => {
    expect(firstSeasonStart({ entries: 12, minimum: 12, at: budapestTime("2026-11-22", 20, 0), breaks: [] })).toBe("2026-11-30");
  });

  it("counts the Budapest day: 23:30 UTC on a Sunday is already Monday in Budapest", () => {
    // 2026-11-22T23:30Z = Monday 23 Nov, 00:30 Budapest.
    expect(firstSeasonStart({ entries: 12, minimum: 12, at: new Date("2026-11-22T23:30:00Z"), breaks: [] })).toBe("2026-11-30");
    // One hour earlier it is still Sunday in Budapest.
    expect(firstSeasonStart({ entries: 12, minimum: 12, at: new Date("2026-11-22T22:30:00Z"), breaks: [] })).toBe("2026-11-30");
  });

  it("a break covering that Monday moves the start by the calendar's break rule", () => {
    const breaks = [{ start: "2026-11-23", end: "2026-11-29" }];
    const start = firstSeasonStart({ entries: 12, minimum: 12, at: MONDAY_NOON, breaks });
    expect(start).toBe("2026-11-30");
    expect(start).toBe(phaseCalendar("2026-11-23", breaks)[0]!.start);
  });

  it("a break inside phase 1's three weeks moves it after the break too (a phase is never split)", () => {
    const breaks = [{ start: "2026-12-21", end: "2027-01-03" }];
    expect(firstSeasonStart({ entries: 12, minimum: 12, at: budapestTime("2026-12-07", 9, 0), breaks })).toBe("2027-01-04");
  });

  it("more entries than the minimum start it the same way", () => {
    expect(firstSeasonStart({ entries: 15, minimum: 12, at: MONDAY_NOON, breaks: [] })).toBe("2026-11-23");
  });

  it("once fixed, the date stays when the entries drop below the minimum", () => {
    expect(firstSeasonStart({ entries: 9, minimum: 12, at: TUESDAY_NOON, breaks: [], fixed: "2026-11-23" })).toBe("2026-11-23");
    // ...and doesn't move when entries grow either.
    expect(firstSeasonStart({ entries: 20, minimum: 12, at: TUESDAY_NOON, breaks: [], fixed: "2026-11-23" })).toBe("2026-11-23");
  });

  it("the minimum is 12 by default", () => {
    expect(DEFAULT_MIN_ENTRIES).toBe(12);
  });
});

describe("entriesMissing", () => {
  it("is how many more entries the minimum needs, never below 0", () => {
    expect(entriesMissing(9, 12)).toBe(3);
    expect(entriesMissing(12, 12)).toBe(0);
    expect(entriesMissing(14, 12)).toBe(0);
  });
});
