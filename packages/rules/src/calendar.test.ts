import { describe, expect, it } from "vitest";
import {
  PHASES_PER_SEASON,
  addDays,
  budapestDay,
  budapestTime,
  firstMondayAfter,
  isDay,
  isMonday,
  phaseCalendar,
  type Phase,
} from "./calendar";

const days = (phases: Phase[]) => phases.map((p) => [p.start, p.end]);

describe("phaseCalendar (spec 4, 18; issue #22)", () => {
  it("first season: start 9 Nov 2026, break 21 Dec – 3 Jan", () => {
    const phases = phaseCalendar("2026-11-09", [{ start: "2026-12-21", end: "2027-01-03" }]);
    expect(days(phases)).toEqual([
      ["2026-11-09", "2026-11-29"],
      ["2026-11-30", "2026-12-20"],
      ["2027-01-04", "2027-01-24"],
      ["2027-01-25", "2027-02-14"],
    ]);
    expect(phases.map((p) => p.number)).toEqual([1, 2, 3, 4]);
  });

  it("has exactly 4 phases, no 5th", () => {
    expect(PHASES_PER_SEASON).toBe(4);
    expect(phaseCalendar("2026-11-09", [{ start: "2026-12-21", end: "2027-01-03" }])).toHaveLength(4);
    expect(phaseCalendar("2026-11-09", [])).toHaveLength(4);
  });

  it("runs 3-week phases back to back without breaks (12 weeks)", () => {
    const phases = phaseCalendar("2026-11-09", []);
    expect(days(phases)).toEqual([
      ["2026-11-09", "2026-11-29"],
      ["2026-11-30", "2026-12-20"],
      ["2026-12-21", "2027-01-10"],
      ["2027-01-11", "2027-01-31"],
    ]);
    for (const p of phases) {
      expect(isMonday(p.start)).toBe(true);
      expect(addDays(p.start, 20)).toBe(p.end);
    }
  });

  it("refuses a start that isn't a Monday", () => {
    expect(() => phaseCalendar("2026-11-10", [])).toThrow(/Monday/);
    expect(() => phaseCalendar("2026-11-08", [])).toThrow(/Monday/);
  });

  it("refuses a malformed day", () => {
    expect(() => phaseCalendar("2026-02-30", [])).toThrow();
    expect(() => phaseCalendar("9 Nov 2026", [])).toThrow();
    expect(() => phaseCalendar("2026-11-09", [{ start: "x", end: "2026-12-01" }])).toThrow();
  });

  it("refuses a break that ends before it starts", () => {
    expect(() => phaseCalendar("2026-11-09", [{ start: "2026-12-10", end: "2026-12-01" }])).toThrow();
  });

  it("never splits a phase: one that would touch a break starts the first Monday after it", () => {
    // A 3-day break in the middle of phase 3 (21 Dec – 10 Jan).
    const phases = phaseCalendar("2026-11-09", [{ start: "2026-12-24", end: "2026-12-26" }]);
    expect(days(phases).slice(2)).toEqual([
      ["2026-12-28", "2027-01-17"],
      ["2027-01-18", "2027-02-07"],
    ]);
  });

  it("a break ending on a Monday pushes the phase to the next Monday", () => {
    const phases = phaseCalendar("2026-11-09", [{ start: "2026-12-21", end: "2027-01-04" }]);
    expect(phases[2]?.start).toBe("2027-01-11");
  });

  it("a one-day break on the phase's last Sunday still moves the whole phase", () => {
    const phases = phaseCalendar("2026-11-09", [{ start: "2026-12-20", end: "2026-12-20" }]);
    expect(days(phases).slice(1, 3)).toEqual([
      ["2026-12-21", "2027-01-10"],
      ["2027-01-11", "2027-01-31"],
    ]);
  });

  it("skips several breaks, given in any order, also when one pushes into the next", () => {
    const phases = phaseCalendar("2026-11-09", [
      { start: "2027-01-06", end: "2027-01-07" },
      { start: "2026-12-21", end: "2027-01-03" },
    ]);
    // Phase 3 moves to 4 Jan, touches the 6–7 Jan break, moves to 11 Jan.
    expect(days(phases).slice(2)).toEqual([
      ["2027-01-11", "2027-01-31"],
      ["2027-02-01", "2027-02-21"],
    ]);
  });

  it("moves phase 1 too when a break covers the first Monday", () => {
    const phases = phaseCalendar("2026-11-09", [{ start: "2026-11-01", end: "2026-11-10" }]);
    expect(phases[0]?.start).toBe("2026-11-16");
  });

  it("ignores breaks before the season and after it", () => {
    const plain = days(phaseCalendar("2026-11-09", []));
    expect(
      days(
        phaseCalendar("2026-11-09", [
          { start: "2026-10-01", end: "2026-11-08" },
          { start: "2027-02-01", end: "2027-02-10" },
        ]),
      ),
    ).toEqual(plain);
  });

  it("each phase starts Monday 00:00 and ends at the deadline, Sunday 23:59 Budapest, in UTC", () => {
    const [p1, p2] = phaseCalendar("2026-11-09", []);
    // Winter time (CET, UTC+1).
    expect(p1?.startsAt.toISOString()).toBe("2026-11-08T23:00:00.000Z");
    expect(p1?.deadline.toISOString()).toBe("2026-11-29T22:59:00.000Z");
    expect(p2?.startsAt.toISOString()).toBe("2026-11-29T23:00:00.000Z");
  });

  it("uses summer time for deadlines after the March clock change", () => {
    // Phase 1: 15 Mar – 4 Apr 2027; clocks go forward on 28 Mar 2027.
    const [p1] = phaseCalendar("2027-03-15", []);
    expect(p1?.startsAt.toISOString()).toBe("2027-03-14T23:00:00.000Z");
    expect(p1?.deadline.toISOString()).toBe("2027-04-04T21:59:00.000Z");
  });
});

describe("calendar helpers", () => {
  it("isDay accepts real calendar days only", () => {
    expect(isDay("2026-11-09")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2027-02-29")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2026-1-01")).toBe(false);
    expect(isDay("")).toBe(false);
  });

  it("isMonday", () => {
    expect(isMonday("2026-11-02")).toBe(true);
    expect(isMonday("2026-11-05")).toBe(false);
  });

  it("addDays crosses months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("firstMondayAfter is strictly after the day", () => {
    expect(firstMondayAfter("2027-01-03")).toBe("2027-01-04"); // Sunday
    expect(firstMondayAfter("2027-01-04")).toBe("2027-01-11"); // Monday
    expect(firstMondayAfter("2026-12-26")).toBe("2026-12-28"); // Saturday
  });

  it("budapestTime and budapestDay convert between Budapest days and UTC", () => {
    expect(budapestTime("2026-11-05", 23, 59).toISOString()).toBe("2026-11-05T22:59:00.000Z");
    expect(budapestTime("2026-07-01", 0, 0).toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(budapestDay(new Date("2026-11-05T22:59:00.000Z"))).toBe("2026-11-05");
    expect(budapestDay(new Date("2026-06-30T22:00:00.000Z"))).toBe("2026-07-01");
  });

  it("budapestTime handles the clock-change days", () => {
    // 28 Mar 2027: 02:00 CET -> 03:00 CEST. 31 Oct 2027: 03:00 CEST -> 02:00 CET.
    expect(budapestTime("2027-03-28", 0, 0).toISOString()).toBe("2027-03-27T23:00:00.000Z");
    expect(budapestTime("2027-03-28", 23, 59).toISOString()).toBe("2027-03-28T21:59:00.000Z");
    expect(budapestTime("2027-10-31", 0, 0).toISOString()).toBe("2027-10-30T22:00:00.000Z");
    expect(budapestTime("2027-10-31", 23, 59).toISOString()).toBe("2027-10-31T22:59:00.000Z");
  });
});
