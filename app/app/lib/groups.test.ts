import { phaseMatches } from "@padel-liga/rules";
import { describe, expect, it } from "vitest";

import {
  BAD_SIZES,
  cannotSplit,
  draftIsStale,
  formatElo,
  groupAverage,
  pairName,
  pairWeeks,
  publishBlocker,
  sizeWarning,
  STALE_DRAFT,
  weekDays,
  weekRange,
  withArticle,
} from "./groups";

describe("withArticle", () => {
  it("uses az before numbers read with a vowel", () => {
    expect([1, 2, 3, 4, 5, 6, 10, 11, 15, 50, 51, 100].map(withArticle)).toEqual([
      "az 1.",
      "a 2.",
      "a 3.",
      "a 4.",
      "az 5.",
      "a 6.",
      "a 10.",
      "a 11.",
      "a 15.",
      "az 50.",
      "az 51.",
      "a 100.",
    ]);
  });
});

describe("formatElo and groupAverage", () => {
  it("averages the pairs' Elo and shows it with a decimal comma", () => {
    expect(groupAverage([{ averageElo: 1400 }, { averageElo: 1300 }, { averageElo: 1200 }, { averageElo: 1250 }])).toBe(1287.5);
    expect(formatElo(1287.5)).toBe("1287,5");
    expect(formatElo(1300)).toBe("1300");
  });

  it("has no average for an empty group", () => {
    expect(groupAverage([])).toBeNull();
  });
});

describe("pairName", () => {
  it("joins the two names and fills in a missing one", () => {
    expect(pairName([{ name: "Anna" }, { name: "" }])).toBe("Anna – Névtelen");
  });
});

describe("cannotSplit (#24: no draft below 6 pairs, except 3 or 4)", () => {
  it("explains 0, 1, 2 and 5 pairs", () => {
    expect(cannotSplit(0)).toBe("Még nincs nevezett pár. Csoportot 3, 4 vagy legalább 6 párból lehet összeállítani.");
    expect(cannotSplit(2)).toMatch(/^2 nevezett pár van\./);
    expect(cannotSplit(5)).toMatch(/^5 nevezett pár van\./);
  });

  it("allows 3, 4 and every count from 6", () => {
    for (const n of [3, 4, 6, 7, 10, 11, 40]) expect(cannotSplit(n)).toBeNull();
  });
});

describe("sizeWarning", () => {
  it("warns on a group of 2 or 5, not on 3 or 4", () => {
    expect(sizeWarning(2)).toBe("2 pár: egy csoportban 3 vagy 4 pár lehet.");
    expect(sizeWarning(5)).toBe("5 pár: egy csoportban 3 vagy 4 pár lehet.");
    expect(sizeWarning(3)).toBeNull();
    expect(sizeWarning(4)).toBeNull();
  });
});

describe("draftIsStale", () => {
  it("is fresh when the draft holds exactly the eligible pairs, in any order", () => {
    expect(draftIsStale([3, 1, 2], [1, 2, 3])).toBe(false);
  });

  it("is stale when a pair was added, removed or replaced", () => {
    expect(draftIsStale([1, 2], [1, 2, 3])).toBe(true);
    expect(draftIsStale([1, 2, 3], [1, 2])).toBe(true);
    expect(draftIsStale([1, 2, 4], [1, 2, 3])).toBe(true);
  });

  it("is stale when a pair is in two groups", () => {
    expect(draftIsStale([1, 1, 2], [1, 2, 3])).toBe(true);
  });
});

describe("publishBlocker (#24: a group of 2 or 5 can't be published)", () => {
  it("lets a 4+3+3 draft through", () => {
    expect(publishBlocker({ sizes: [4, 3, 3], stale: false })).toBeNull();
  });

  it("blocks a group of 2 or 5", () => {
    expect(publishBlocker({ sizes: [5, 2, 3], stale: false })).toBe(BAD_SIZES);
    expect(publishBlocker({ sizes: [4, 4, 2], stale: false })).toBe(BAD_SIZES);
  });

  it("blocks a stale draft first", () => {
    expect(publishBlocker({ sizes: [4, 3, 3], stale: true })).toBe(STALE_DRAFT);
  });

  it("blocks a draft without groups", () => {
    expect(publishBlocker({ sizes: [], stale: false })).toBe(BAD_SIZES);
  });
});

describe("weekDays and weekRange", () => {
  // Phase 1 of the first season: Monday 9 Nov 2026 00:00 Budapest (UTC+1).
  const start = new Date("2026-11-08T23:00:00Z");

  it("gives Monday to Sunday of each week in Budapest", () => {
    expect(weekDays(start, 1)).toEqual({ start: "2026-11-09", end: "2026-11-15" });
    expect(weekDays(start, 3)).toEqual({ start: "2026-11-23", end: "2026-11-29" });
    expect(weekRange(start, 1)).toBe("nov. 9. – nov. 15.");
    expect(weekRange(start, 3)).toBe("nov. 23. – nov. 29.");
  });

  it("stays on Mondays across the clock change", () => {
    // Monday 22 Mar 2027 00:00 Budapest (UTC+1); clocks go forward on 28 Mar.
    const spring = new Date("2027-03-21T23:00:00Z");
    expect(weekDays(spring, 2)).toEqual({ start: "2027-03-29", end: "2027-04-04" });
    expect(weekRange(spring, 2)).toBe("márc. 29. – ápr. 4.");
  });
});

describe("pairWeeks", () => {
  it("lists a group of 4 pair's opponent every week", () => {
    const matches = phaseMatches([["A", "B", "C", "D"]]);
    expect(pairWeeks(matches, "A")).toEqual([
      { week: 1, opponent: "D" },
      { week: 2, opponent: "C" },
      { week: 3, opponent: "B" },
    ]);
    expect(pairWeeks(matches, "D").map((w) => w.opponent)).toEqual(["A", "B", "C"]);
  });

  it("marks the rest week in a group of 3", () => {
    const matches = phaseMatches([["A", "B", "C"]]);
    expect(pairWeeks(matches, "A")).toEqual([
      { week: 1, opponent: null },
      { week: 2, opponent: "C" },
      { week: 3, opponent: "B" },
    ]);
    expect(pairWeeks(matches, "B").map((w) => w.opponent)).toEqual(["C", null, "A"]);
  });
});
