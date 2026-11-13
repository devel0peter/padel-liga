import { describe, expect, it } from "vitest";

import { budapestTime, phaseCalendar, type Phase } from "./calendar";
import { daysBetween, extendRound, isSunday, weeksLater, type PhaseSpan } from "./extension";

const spans = (phases: Phase[]): PhaseSpan[] => phases.map(({ number, start, end }) => ({ number, start, end }));
const days = (phases: Phase[]) => phases.map((p) => [p.start, p.end]);

// Győr's first season: 9 Nov 2026, break 21 Dec – 3 Jan.
const WINTER = [{ start: "2026-12-21", end: "2027-01-03" }];
const GYOR = spans(phaseCalendar("2026-11-09", WINTER));
// The same season with no break.
const PLAIN = spans(phaseCalendar("2026-11-09", []));

describe("isSunday, daysBetween", () => {
  it("knows a Sunday", () => {
    expect(isSunday("2026-11-29")).toBe(true);
    expect(isSunday("2026-11-30")).toBe(false);
    expect(isSunday("2026-11-31")).toBe(false);
    expect(isSunday("nope")).toBe(false);
  });

  it("counts days, across a clock change", () => {
    expect(daysBetween("2026-11-29", "2026-12-06")).toBe(7);
    expect(daysBetween("2026-12-06", "2026-11-29")).toBe(-7);
    expect(daysBetween("2027-03-21", "2027-04-04")).toBe(14);
  });
});

describe("extendRound (#356, D151)", () => {
  it("one round, no break: round 1 a week longer, rounds 2–4 a week later, each still 3 weeks", () => {
    const phases = extendRound(PLAIN, 1, "2026-12-06", []);
    expect(days(phases)).toEqual([
      ["2026-11-09", "2026-12-06"],
      ["2026-12-07", "2026-12-27"],
      ["2026-12-28", "2027-01-17"],
      ["2027-01-18", "2027-02-07"],
    ]);
    expect(phases.map((p, i) => weeksLater(PLAIN[i]!, p))).toEqual([0, 1, 1, 1]);
  });

  it("the dates are Budapest's: Monday 00:00 and Sunday 23:59", () => {
    const [one, two] = extendRound(PLAIN, 1, "2026-12-06", []);
    expect(one!.startsAt).toEqual(budapestTime("2026-11-09", 0, 0));
    expect(one!.deadline).toEqual(budapestTime("2026-12-06", 23, 59));
    expect(two!.startsAt).toEqual(budapestTime("2026-12-07", 0, 0));
    expect(two!.deadline).toEqual(budapestTime("2026-12-27", 23, 59));
  });

  it("several weeks: later rounds move by the same number of weeks", () => {
    const phases = extendRound(PLAIN, 1, "2026-12-20", []);
    expect(phases.map((p, i) => weeksLater(PLAIN[i]!, p))).toEqual([0, 3, 3, 3]);
    expect(days(phases).at(-1)).toEqual(["2027-02-01", "2027-02-21"]);
  });

  it("across a break: a round that would touch it starts after it, and the next one after that round", () => {
    // Round 2 would run 7–27 Dec, into the break: it starts 4 Jan. Round 3
    // (moved a week, 11 Jan) can't start before round 2 ends: 25 Jan.
    const phases = extendRound(GYOR, 1, "2026-12-06", WINTER);
    expect(days(phases)).toEqual([
      ["2026-11-09", "2026-12-06"],
      ["2027-01-04", "2027-01-24"],
      ["2027-01-25", "2027-02-14"],
      ["2027-02-15", "2027-03-07"],
    ]);
    expect(phases.map((p, i) => weeksLater(GYOR[i]!, p))).toEqual([0, 5, 3, 3]);
  });

  it("a round already after the break moves by the weeks alone", () => {
    // Round 2 of Győr runs to 20 Dec; extended to 27 Dec (into the break,
    // the organizer's call). Round 3 (4 Jan) moves a week: 11 Jan.
    const phases = extendRound(GYOR, 2, "2026-12-27", WINTER);
    expect(days(phases)).toEqual([
      ["2026-11-09", "2026-11-29"],
      ["2026-11-30", "2026-12-27"],
      ["2027-01-11", "2027-01-31"],
      ["2027-02-01", "2027-02-21"],
    ]);
  });

  it("the last round: only its own deadline moves", () => {
    const phases = extendRound(PLAIN, 4, "2027-02-07", []);
    expect(days(phases)).toEqual([
      ["2026-11-09", "2026-11-29"],
      ["2026-11-30", "2026-12-20"],
      ["2026-12-21", "2027-01-10"],
      ["2027-01-11", "2027-02-07"],
    ]);
  });

  it("earlier rounds never move", () => {
    const phases = extendRound(PLAIN, 3, "2027-01-24", []);
    expect(days(phases).slice(0, 2)).toEqual(days(phaseCalendar("2026-11-09", [])).slice(0, 2));
    expect(days(phases).slice(2)).toEqual([
      ["2026-12-21", "2027-01-24"],
      ["2027-01-25", "2027-02-14"],
    ]);
  });

  it("an extended round can be extended again", () => {
    const once = spans(extendRound(PLAIN, 1, "2026-12-06", []));
    const twice = extendRound(once, 1, "2026-12-13", []);
    expect(days(twice)).toEqual(days(extendRound(PLAIN, 1, "2026-12-13", [])));
  });

  it("takes the rounds in any order", () => {
    expect(days(extendRound([...PLAIN].reverse(), 1, "2026-12-06", []))).toEqual(days(extendRound(PLAIN, 1, "2026-12-06", [])));
  });

  it("refuses an earlier or the same deadline, a day that isn't a Sunday, and a round the season doesn't have", () => {
    expect(() => extendRound(PLAIN, 1, "2026-11-29", [])).toThrow(/after/);
    expect(() => extendRound(PLAIN, 1, "2026-11-22", [])).toThrow(/after/);
    expect(() => extendRound(PLAIN, 1, "2026-12-05", [])).toThrow(/Sunday/);
    expect(() => extendRound(PLAIN, 1, "2026-13-06", [])).toThrow(/Sunday/);
    expect(() => extendRound(PLAIN, 5, "2026-12-06", [])).toThrow(/No round 5/);
  });

  it("refuses a round whose stored deadline isn't a Sunday", () => {
    const odd = PLAIN.map((p) => (p.number === 1 ? { ...p, end: "2026-11-28" } : p));
    expect(() => extendRound(odd, 1, "2026-12-06", [])).toThrow(/doesn't end on a Sunday/);
  });
});
