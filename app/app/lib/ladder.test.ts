import { describe, expect, it } from "vitest";

import type { MatchOutcome } from "@padel-liga/rules";

import { formatSlot } from "./format";
import { buildLadder, countedOutcome, groupTable, isValidOutcome, phaseWeek, type LadderGroupInput, type LadderMatch, type LadderPair } from "./ladder";

const pair = (id: number, elo = 1500 - id): LadderPair => ({ id, names: [`Játékos ${id}A`, `Játékos ${id}B`], elo });

/** A group of 3 pairs with ids base+1..base+3 and no matches. */
function group(number: number, matches: LadderMatch[] = []): LadderGroupInput {
  const base = number * 10;
  return { id: number, number, pairs: [pair(base + 1), pair(base + 2), pair(base + 3)], matches };
}

const played = (id: number, a: number, b: number, week: number, sets: [number, number][]): LadderMatch => ({
  id,
  a,
  b,
  week,
  scheduledAt: null,
  outcome: { kind: "played", score: { sets } },
});

const open = (id: number, a: number, b: number, week: number, scheduledAt: Date | null = null): LadderMatch => ({
  id,
  a,
  b,
  week,
  scheduledAt,
  outcome: null,
});

describe("buildLadder: division bands (spec 4 and 14)", () => {
  it("with 5 groups the bands are Bronz 1, Réz 2, Rookie 2 groups", () => {
    const bands = buildLadder([1, 2, 3, 4, 5].map((n) => group(n)), 1);
    expect(bands.map((b) => [b.label, b.groups.map((g) => g.number)])).toEqual([
      ["Bronz divízió", [1]],
      ["Réz divízió", [2, 3]],
      ["Rookie divízió", [4, 5]],
    ]);
  });

  it("orders the groups by number, whatever order they come in", () => {
    const bands = buildLadder([group(3), group(1), group(2)], 1);
    expect(bands.map((b) => b.groups.map((g) => g.number))).toEqual([[1], [2], [3]]);
  });

  it("leaves a band out when it has no group: 2 groups are Bronz and Réz only", () => {
    expect(buildLadder([group(1), group(2)], 1).map((b) => b.division)).toEqual(["bronz", "rez"]);
    expect(buildLadder([group(1)], 1).map((b) => b.division)).toEqual(["bronz"]);
  });

  it("is empty without groups", () => {
    expect(buildLadder([], 1)).toEqual([]);
  });
});

describe("buildLadder: group tables come from the rules engine (spec 9)", () => {
  // 12 beats 11 (4-1 4-2), 11 beats 13 (4-0 4-2), 13-12 not played yet.
  const g = group(1, [
    played(1, 12, 11, 1, [[4, 1], [4, 2]]),
    played(2, 11, 13, 2, [[4, 0], [4, 2]]),
    open(3, 13, 12, 3),
  ]);

  it("ranks by points and shows played, points and the set and game difference", () => {
    const [band] = buildLadder([g], 1);
    expect(band!.groups[0]!.rows).toEqual([
      { rank: 1, pairId: 11, names: ["Játékos 11A", "Játékos 11B"], matches: 2, points: 4, setDiff: 0, gameDiff: 1 },
      { rank: 2, pairId: 12, names: ["Játékos 12A", "Játékos 12B"], matches: 1, points: 3, setDiff: 2, gameDiff: 5 },
      { rank: 3, pairId: 13, names: ["Játékos 13A", "Játékos 13B"], matches: 1, points: 1, setDiff: -2, gameDiff: -6 },
    ]);
  });

  it("shows table order (Elo, then seed) and zeros before any match is played", () => {
    const [band] = buildLadder([group(1, [open(1, 11, 12, 1)])], 1);
    expect(band!.groups[0]!.rows.map((r) => [r.rank, r.names[0], r.points, r.matches])).toEqual([
      [1, "Játékos 11A", 0, 0],
      [2, "Játékos 12A", 0, 0],
      [3, "Játékos 13A", 0, 0],
    ]);
  });
});

describe("buildLadder: this week's matches and results", () => {
  const slot = new Date("2026-11-10T17:30:00Z"); // Tue 18:30 Budapest
  const g = group(1, [
    played(1, 11, 12, 1, [[4, 2], [4, 1]]),
    open(2, 11, 13, 2, slot),
    open(3, 12, 13, 3),
  ]);

  it("lists only the matches of the week, with the time when scheduled", () => {
    const week2 = buildLadder([g], 2)[0]!.groups[0]!.weekMatches;
    expect(week2).toEqual([
      { a: ["Játékos 11A", "Játékos 11B"], b: ["Játékos 13A", "Játékos 13B"], when: formatSlot(slot), result: null },
    ]);
    expect(buildLadder([g], 3)[0]!.groups[0]!.weekMatches.map((m) => [m.a[0], m.when])).toEqual([["Játékos 12A", null]]);
  });

  it("lists the played results of the other weeks in week order", () => {
    for (const week of [2, 3]) {
      expect(buildLadder([g], week)[0]!.groups[0]!.results.map((m) => [m.a[0], m.result])).toEqual([["Játékos 11A", "4:2, 4:1"]]);
    }
  });

  it("lists a result once: the week shown has it under its matches, not again under the results (#202)", () => {
    const [group1] = buildLadder([g], 1)[0]!.groups;
    expect(group1!.weekMatches.map((m) => m.result)).toEqual(["4:2, 4:1"]);
    expect(group1!.results).toEqual([]);
  });

  it("writes a super tie-break after the sets and calls a walkover a kontumác", () => {
    const stb: LadderMatch = {
      id: 1,
      a: 11,
      b: 12,
      week: 1,
      scheduledAt: null,
      outcome: { kind: "played", score: { sets: [[4, 2], [1, 4]], superTieBreak: [10, 7] } },
    };
    const wo: LadderMatch = { id: 2, a: 11, b: 13, week: 2, scheduledAt: null, outcome: { kind: "walkover", winner: "b" } };
    const results = buildLadder([group(1, [stb, wo])], 3)[0]!.groups[0]!.results;
    expect(results.map((m) => m.result)).toEqual(["4:2, 1:4, szuper tie-break 10:7", "kontumác"]);
  });

  it("words the organizer's both-lose decision as the rules and the organizer screen do (#202)", () => {
    const both: LadderMatch = { id: 1, a: 11, b: 12, week: 1, scheduledAt: null, outcome: { kind: "both-inactive" } };
    expect(buildLadder([group(1, [both])], 2)[0]!.groups[0]!.results.map((m) => m.result)).toEqual(["Mindkét pár vereséget kap (0:4, 0:4)"]);
  });

  it("does not list an unplayed match as a result", () => {
    const unplayed: LadderMatch = { id: 1, a: 11, b: 12, week: 1, scheduledAt: null, outcome: { kind: "unplayed" } };
    expect(buildLadder([group(1, [unplayed])], 1)[0]!.groups[0]!.results).toEqual([]);
  });
});

describe("buildLadder: no contact details (#30)", () => {
  it("carries names and numbers only", () => {
    const g = group(1, [played(1, 11, 12, 1, [[4, 2], [4, 1]]), open(2, 11, 13, 2)]);
    const text = JSON.stringify(buildLadder([g, group(2), group(3)], 1));
    expect(text).not.toMatch(/@|\+36|email|phone|telefon/i);
  });
});

describe("phaseWeek", () => {
  it("counts the phase's weeks from its first Monday", () => {
    expect(phaseWeek("2026-11-09", "2026-11-09")).toEqual({ week: 1, started: true });
    expect(phaseWeek("2026-11-09", "2026-11-15")).toEqual({ week: 1, started: true });
    expect(phaseWeek("2026-11-09", "2026-11-16")).toEqual({ week: 2, started: true });
    expect(phaseWeek("2026-11-09", "2026-11-29")).toEqual({ week: 3, started: true });
  });

  it("is week 1, not started, before the phase", () => {
    expect(phaseWeek("2026-11-09", "2026-11-08")).toEqual({ week: 1, started: false });
  });

  it("stays at week 3 after the phase's last week", () => {
    expect(phaseWeek("2026-11-09", "2026-12-20")).toEqual({ week: 3, started: true });
  });
});

describe("formatSlot", () => {
  it("shows Budapest time, 24 hours, with the weekday", () => {
    expect(formatSlot(new Date("2026-11-10T17:30:00Z"))).toBe("nov. 10., kedd 18:30");
    expect(formatSlot(new Date("2026-07-14T05:05:00Z"))).toBe("júl. 14., kedd 07:05");
  });
});

describe("buildLadder: a pair withdrawn mid-phase (#34, rules 2)", () => {
  const withdrawnGroup = (): LadderGroupInput => ({
    id: 1,
    number: 1,
    pairs: [pair(11), pair(12), pair(13), { ...pair(14), withdrawn: true }],
    matches: [
      played(1, 11, 12, 1, [[4, 0], [4, 0]]),
      played(2, 14, 13, 1, [[4, 0], [4, 0]]),
      played(3, 13, 11, 2, [[4, 1], [4, 1]]),
      open(4, 11, 14, 2),
      played(5, 12, 13, 3, [[4, 2], [4, 2]]),
      open(6, 12, 14, 3),
    ],
  });
  const without = (): LadderGroupInput => {
    const g = withdrawnGroup();
    return { ...g, pairs: g.pairs.slice(0, 3), matches: g.matches.filter((m) => m.a !== 14 && m.b !== 14) };
  };

  it("leaves the pair and all of its matches out of the table, as if it never played", () => {
    const [band] = buildLadder([withdrawnGroup()], 2);
    const [never] = buildLadder([without()], 2);
    expect(band!.groups[0]!.rows).toEqual(never!.groups[0]!.rows);
    expect(band!.groups[0]!.rows).toHaveLength(3);
  });

  it("drops its matches from this week's list and the results, and names it apart", () => {
    for (const week of [1, 2, 3]) {
      const g = buildLadder([withdrawnGroup()], week)[0]!.groups[0]!;
      const n = buildLadder([without()], week)[0]!.groups[0]!;
      expect(g.weekMatches).toEqual(n.weekMatches);
      expect(g.results).toEqual(n.results);
    }
    expect(buildLadder([withdrawnGroup()], 1)[0]!.groups[0]!.withdrawn).toEqual([["Játékos 14A", "Játékos 14B"]]);
    expect(buildLadder([without()], 1)[0]!.groups[0]!.withdrawn).toEqual([]);
  });
});

describe("groupTable: a pair withdrawn mid-phase (#34), for the ladder and Kezdőlap", () => {
  it("leaves the pair and its matches out, as if it never played", () => {
    const pairs = [pair(1), pair(2), pair(3), { ...pair(4), withdrawn: true }];
    const matches = [
      played(1, 1, 2, 1, [[4, 0], [4, 0]]),
      played(2, 4, 3, 1, [[4, 0], [4, 0]]),
      played(3, 3, 1, 2, [[4, 1], [4, 1]]),
      played(4, 1, 4, 2, [[4, 2], [4, 2]]),
    ];
    const without = groupTable(pairs.slice(0, 3), matches.filter((m) => m.a !== 4 && m.b !== 4));
    expect(groupTable(pairs, matches)).toEqual(without);
    expect(groupTable(pairs, matches).map((r) => r.pairId)).not.toContain(4);
  });
});

describe("countedOutcome: only a final match counts (#186, #220)", () => {
  const won: MatchOutcome = { kind: "played", score: { sets: [[4, 1], [4, 2]] } };

  it("a final match counts with its outcome", () => {
    expect(countedOutcome({ status: "final", outcome: won })).toEqual(won);
  });

  it("a waiting or disputed result stays out whatever outcome is stored", () => {
    for (const status of ["open", "scheduled", "result_pending", "disputed"])
      expect(countedOutcome({ status, outcome: won })).toBeNull();
  });
});

describe("isValidOutcome: what the public league page can count (#190, D115)", () => {
  it("accepts every outcome a write can store", () => {
    for (const outcome of [
      { kind: "played", score: { sets: [[4, 1], [4, 2]] } },
      { kind: "played", score: { sets: [[4, 1], [2, 4]], superTieBreak: [10, 8] } },
      { kind: "walkover", winner: "a" },
      { kind: "walkover", winner: "b" },
      { kind: "both-inactive" },
      { kind: "unplayed" },
    ])
      expect(isValidOutcome(outcome), JSON.stringify(outcome)).toBe(true);
  });

  it("rejects a score, kind or shape the rules engine would throw on", () => {
    for (const outcome of [
      null,
      "played",
      {},
      { kind: "forfeit" },
      { kind: "walkover" },
      { kind: "walkover", winner: "c" },
      { kind: "played" },
      { kind: "played", score: null },
      { kind: "played", score: { sets: "4:1" } },
      { kind: "played", score: { sets: [[4, 1]] } },
      { kind: "played", score: { sets: [4, 1, 4, 2] } },
      { kind: "played", score: { sets: [[6, 1], [6, 2]] } },
      { kind: "played", score: { sets: [[4, 1], [2, 4]] } },
      { kind: "played", score: { sets: [[4, 1], [4, 2]], superTieBreak: [10, 8] } },
      { kind: "played", score: { sets: [[4, 1], [2, 4]], superTieBreak: 10 } },
      { kind: "played", score: { sets: [["4", "1"], [4, 2]] } },
    ])
      expect(isValidOutcome(outcome), JSON.stringify(outcome)).toBe(false);
  });

  it("a valid outcome never makes groupTable throw", () => {
    const outcome: MatchOutcome = { kind: "played", score: { sets: [[5, 4], [4, 0]] } };
    expect(isValidOutcome(outcome)).toBe(true);
    expect(groupTable([pair(1), pair(2)], [{ a: 1, b: 2, outcome }])[0]).toMatchObject({ pairId: 1, points: 3 });
  });
});
