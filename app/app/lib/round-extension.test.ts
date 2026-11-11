import { budapestTime, phaseCalendar } from "@padel-liga/rules";
import { describe, expect, it } from "vitest";

import {
  extendableRound,
  extensionDetail,
  extensionOptions,
  extensionSummary,
  MAX_EXTENSION_WEEKS,
  NOT_LATER,
  parseNewDeadline,
  planExtension,
} from "./round-extension";

// Győr's first season: rounds from 9 Nov 2026, break 21 Dec – 3 Jan.
const WINTER = [{ start: "2026-12-21", end: "2027-01-03" }];
const stored = (breaks: typeof WINTER) => phaseCalendar("2026-11-09", breaks).map(({ number, startsAt, deadline }) => ({ number, startsAt, deadline }));
const GYOR = { phases: stored(WINTER), breaks: WINTER };
const PLAIN = { phases: stored([]), breaks: [] };
const ROUND_1_DEADLINE = budapestTime("2026-11-29", 23, 59);

describe("extendableRound (#356)", () => {
  const during = new Date("2026-11-20T10:00:00Z");

  it("the published round whose deadline hasn't passed", () => {
    expect(extendableRound(GYOR.phases, [1], during)?.number).toBe(1);
    // Up to the deadline minute itself.
    expect(extendableRound(GYOR.phases, [1], ROUND_1_DEADLINE)?.number).toBe(1);
    // Round 2 published, before its deadline.
    expect(extendableRound(GYOR.phases, [1, 2], new Date("2026-12-10T10:00:00Z"))?.number).toBe(2);
  });

  it("none before the groups are out, after the deadline, or between rounds", () => {
    expect(extendableRound(GYOR.phases, [], during)).toBeNull();
    expect(extendableRound(GYOR.phases, [1], new Date(ROUND_1_DEADLINE.getTime() + 60_000))).toBeNull();
    // Monday after round 1, round 2 not published yet.
    expect(extendableRound(GYOR.phases, [1], new Date("2026-11-30T10:00:00Z"))).toBeNull();
  });
});

describe("extensionOptions and parseNewDeadline", () => {
  it("offers the next Sundays, 1 to 4 weeks later", () => {
    expect(extensionOptions(ROUND_1_DEADLINE)).toEqual([
      { day: "2026-12-06", weeks: 1 },
      { day: "2026-12-13", weeks: 2 },
      { day: "2026-12-20", weeks: 3 },
      { day: "2026-12-27", weeks: 4 },
    ]);
    expect(MAX_EXTENSION_WEEKS).toBe(4);
  });

  it("takes only an offered Sunday", () => {
    expect(parseNewDeadline("2026-12-06", ROUND_1_DEADLINE)).toEqual({ ok: true, day: "2026-12-06" });
    expect(parseNewDeadline(" 2026-12-27 ", ROUND_1_DEADLINE)).toEqual({ ok: true, day: "2026-12-27" });
    // The same or an earlier deadline, a weekday, too far, garbage.
    for (const bad of ["2026-11-29", "2026-11-22", "2026-12-05", "2027-01-03", "x", null])
      expect(parseNewDeadline(bad, ROUND_1_DEADLINE)).toEqual({ ok: false, error: NOT_LATER });
    expect(NOT_LATER).toBe("Az új határidő a mostaninál 1–4 héttel későbbi vasárnap lehet.");
  });
});

describe("planExtension and the confirmation's lines", () => {
  it("no break: every later round a week later, in one line", () => {
    const plan = planExtension(PLAIN, 1, "2026-12-06");
    expect(plan.later.map((p) => [p.number, p.weeks])).toEqual([
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
    expect(plan.phases[0]!.deadline).toEqual(budapestTime("2026-12-06", 23, 59));
    expect(extensionSummary(1, ROUND_1_DEADLINE, plan)).toEqual([
      "Az 1. kör határideje: nov. 29., vasárnap 23:59 → dec. 6., vasárnap 23:59.",
      "A 2–4. kör 1 héttel később kezdődik.",
    ]);
  });

  it("across a break: each later round's own move, with its new start", () => {
    const plan = planExtension(GYOR, 1, "2026-12-06");
    expect(extensionSummary(1, ROUND_1_DEADLINE, plan)).toEqual([
      "Az 1. kör határideje: nov. 29., vasárnap 23:59 → dec. 6., vasárnap 23:59.",
      "A szünet miatt a későbbi körök nem egyformán tolódnak:",
      "A 2. kör 5 héttel később kezdődik (jan. 4.).",
      "A 3. kör 3 héttel később kezdődik (jan. 25.).",
      "A 4. kör 3 héttel később kezdődik (febr. 15.).",
    ]);
  });

  it("round 3 of 4: one later round", () => {
    const plan = planExtension(PLAIN, 3, "2027-01-17");
    expect(extensionSummary(3, PLAIN.phases[2]!.deadline, plan)).toEqual([
      "A 3. kör határideje: jan. 10., vasárnap 23:59 → jan. 17., vasárnap 23:59.",
      "A 4. kör 1 héttel később kezdődik.",
    ]);
  });

  it("the last round: nothing else moves", () => {
    const plan = planExtension(PLAIN, 4, "2027-02-07");
    expect(plan.later).toEqual([]);
    expect(extensionSummary(4, PLAIN.phases[3]!.deadline, plan)).toEqual([
      "A 4. kör határideje: jan. 31., vasárnap 23:59 → febr. 7., vasárnap 23:59.",
      "Ez a szezon utolsó köre, más kör nem mozdul.",
    ]);
  });

  it("the audit detail: the round, old and new day, no names", () => {
    expect(extensionDetail(1, ROUND_1_DEADLINE, "2026-12-06")).toBe("phase 1: 2026-11-29 → 2026-12-06");
  });
});
