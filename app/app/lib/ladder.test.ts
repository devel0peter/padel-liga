import { describe, expect, it } from "vitest";

import type { MatchOutcome } from "@padel-liga/rules";

import { formatSlot } from "./format";

const START = new Date("2026-11-01T23:00:00Z"); // Mon 2 Nov 00:00 Budapest
import { buildLadder, countedOutcome, groupTable, isValidOutcome, phaseSpan, phaseWeek, type LadderGroupInput, type LadderMatch, type LadderPair } from "./ladder";

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
  status: "final",
  scheduledAt: null,
  outcome: { kind: "played", score: { sets } },
});

const open = (id: number, a: number, b: number, week: number, scheduledAt: Date | null = null): LadderMatch => ({
  id,
  a,
  b,
  week,
  status: scheduledAt ? "scheduled" : "open",
  scheduledAt,
  outcome: null,
});

describe("buildLadder: division bands (spec 4 and 14)", () => {
  it("with 5 groups the bands are Bronz 1, Réz 2, Rookie 2 groups", () => {
    const bands = buildLadder(
      [1, 2, 3, 4, 5].map((n) => group(n)),
      1,
      START,
    );
    expect(bands.map((b) => [b.label, b.groups.map((g) => g.number)])).toEqual([
      ["Bronz divízió", [1]],
      ["Réz divízió", [2, 3]],
      ["Rookie divízió", [4, 5]],
    ]);
  });

  it("orders the groups by number, whatever order they come in", () => {
    const bands = buildLadder([group(3), group(1), group(2)], 1, START);
    expect(bands.map((b) => b.groups.map((g) => g.number))).toEqual([[1], [2], [3]]);
  });

  it("leaves a band out when it has no group: 2 groups are Bronz and Réz only", () => {
    expect(buildLadder([group(1), group(2)], 1, START).map((b) => b.division)).toEqual(["bronz", "rez"]);
    expect(buildLadder([group(1)], 1, START).map((b) => b.division)).toEqual(["bronz"]);
  });

  it("is empty without groups", () => {
    expect(buildLadder([], 1, START)).toEqual([]);
  });
});

describe("buildLadder: group tables come from the rules engine (spec 9)", () => {
  // 12 beats 11 (4-1 4-2), 11 beats 13 (4-0 4-2), 13-12 not played yet.
  const g = group(1, [
    played(1, 12, 11, 1, [
      [4, 1],
      [4, 2],
    ]),
    played(2, 11, 13, 2, [
      [4, 0],
      [4, 2],
    ]),
    open(3, 13, 12, 3),
  ]);

  it("ranks by points and shows played, points and the set and game difference", () => {
    const [band] = buildLadder([g], 1, START);
    expect(band!.groups[0]!.rows).toEqual([
      // prettier-ignore
      { rank: 1, pairId: 11, names: ["Játékos 11A", "Játékos 11B"], matches: 2, wins: 1, losses: 1, setsWon: 2, setsLost: 2, gamesWon: 11, gamesLost: 10, points: 4, setDiff: 0, gameDiff: 1, zone: null, mine: false },
      {
        rank: 2,
        pairId: 12,
        names: ["Játékos 12A", "Játékos 12B"],
        matches: 1,
        wins: 1,
        losses: 0,
        setsWon: 2,
        setsLost: 0,
        gamesWon: 8,
        gamesLost: 3,
        points: 3,
        setDiff: 2,
        gameDiff: 5,
        zone: null,
        mine: false,
      },
      {
        rank: 3,
        pairId: 13,
        names: ["Játékos 13A", "Játékos 13B"],
        matches: 1,
        wins: 0,
        losses: 1,
        setsWon: 0,
        setsLost: 2,
        gamesWon: 2,
        gamesLost: 8,
        points: 1,
        setDiff: -2,
        gameDiff: -6,
        zone: null,
        mine: false,
      },
    ]);
  });

  it("shows table order (Elo, then seed) and zeros before any match is played", () => {
    const [band] = buildLadder([group(1, [open(1, 11, 12, 1)])], 1, START);
    expect(band!.groups[0]!.rows.map((r) => [r.rank, r.names[0], r.points, r.matches])).toEqual([
      [1, "Játékos 11A", 0, 0],
      [2, "Játékos 12A", 0, 0],
      [3, "Játékos 13A", 0, 0],
    ]);
  });
});

describe("buildLadder: the fixture list (D133)", () => {
  const slot = new Date("2026-11-10T17:30:00Z"); // Tue 18:30 Budapest
  const g = group(1, [
    played(1, 11, 12, 1, [
      [4, 2],
      [4, 1],
    ]),
    open(2, 11, 13, 2, slot),
    open(3, 12, 13, 3),
  ]);
  const weeks = (week: number | null = 2, input = g) => buildLadder([input], week, START)[0]!.groups[0]!.weeks;

  it("lists every match by week with the week's dates, and marks the current week", () => {
    const w = weeks();
    expect(w.map((x) => [x.week, x.range, x.current, x.matches.length])).toEqual([
      [1, "nov. 2. – nov. 8.", false, 1],
      [2, "nov. 9. – nov. 15.", true, 1],
      [3, "nov. 16. – nov. 22.", false, 1],
    ]);
    expect(weeks(null).some((x) => x.current)).toBe(false);
  });

  it("shows the played score and its winner, the time of a scheduled match, and an open one as open", () => {
    const [w1, w2, w3] = weeks();
    expect(w1!.matches[0]).toMatchObject({
      state: "final",
      sets: [
        [4, 2],
        [4, 1],
      ],
      superTieBreak: null,
      winner: "a",
      note: null,
    });
    expect(w2!.matches[0]).toMatchObject({ state: "scheduled", when: formatSlot(slot), winner: null, sets: null });
    expect(w3!.matches[0]).toMatchObject({ state: "open", when: null });
  });

  it("names the pair that rests in a group of 3", () => {
    expect(weeks().map((w) => w.resting?.[0])).toEqual(["Játékos 13A", "Játékos 12A", "Játékos 11A"]);
  });

  it("keeps a result waiting for confirmation or disputed in the list, without a score", () => {
    const pending: LadderMatch = { ...open(4, 11, 13, 2), status: "result_pending" };
    const disputed: LadderMatch = { ...open(5, 12, 13, 3), status: "disputed" };
    const w = weeks(2, group(1, [pending, disputed]));
    expect(w[1]!.matches[0]).toMatchObject({ state: "pending", sets: null, winner: null });
    expect(w[2]!.matches[0]).toMatchObject({ state: "disputed", sets: null, winner: null });
  });

  it("writes a super tie-break apart, a walkover and the organizer's both-lose decision as notes", () => {
    const stb: LadderMatch = {
      ...played(1, 11, 12, 1, [
        [4, 2],
        [1, 4],
      ]),
      outcome: {
        kind: "played",
        score: {
          sets: [
            [4, 2],
            [1, 4],
          ],
          superTieBreak: [10, 7],
        },
      },
    };
    const wo: LadderMatch = { ...open(2, 11, 13, 2), status: "final", outcome: { kind: "walkover", winner: "b" } };
    const both: LadderMatch = { ...open(3, 12, 13, 3), status: "final", outcome: { kind: "both-inactive" } };
    const [w1, w2, w3] = weeks(1, group(1, [stb, wo, both]));
    expect(w1!.matches[0]).toMatchObject({ superTieBreak: [10, 7], winner: "a" });
    expect(w2!.matches[0]).toMatchObject({ state: "final", winner: "b", note: "Játék nélküli győzelem (4:0, 4:0)" });
    expect(w3!.matches[0]).toMatchObject({ state: "final", winner: null, note: "Mindkét pár vereséget kap (0:4, 0:4)" });
  });

  it("carries no link and no database id on the public page", () => {
    for (const w of weeks()) for (const m of w.matches) expect(m.href).toBeNull();
    expect(JSON.stringify(weeks())).not.toMatch(/"id"/);
  });
});

describe("buildLadder: up and down marks (spec 10, D133)", () => {
  const ranked = (n: number) =>
    group(n, [
      played(n * 100, n * 10 + 1, n * 10 + 2, 1, [
        [4, 0],
        [4, 0],
      ]),
    ]);

  it("marks the 1st up and the last down, but not up in group 1 nor down in the last group", () => {
    const bands = buildLadder([ranked(1), ranked(2), ranked(3)], 1, START);
    const zones = bands.flatMap((b) => b.groups.map((g) => g.rows.map((r) => r.zone)));
    expect(zones).toEqual([
      [null, null, "down"],
      ["up", null, "down"],
      ["up", null, null],
    ]);
  });

  it("marks nothing before any final result, when the order is only the seeding (D85)", () => {
    const g = buildLadder([group(1), group(2)], 1, START)[1]!.groups[0]!;
    expect(g.ranked).toBe(false);
    expect(g.rows.map((r) => r.zone)).toEqual([null, null, null]);
  });
});

describe("buildLadder: no contact details (#30)", () => {
  it("carries names and numbers only", () => {
    const g = group(1, [
      played(1, 11, 12, 1, [
        [4, 2],
        [4, 1],
      ]),
      open(2, 11, 13, 2),
    ]);
    const text = JSON.stringify(buildLadder([g, group(2), group(3)], 1, START));
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

describe("phaseSpan (#356)", () => {
  it("the current week while the round's three weeks run", () => {
    expect(phaseSpan("2026-11-09", "2026-11-29", "2026-11-18")).toEqual({ week: 2, started: true, extension: false, from: "2026-11-16", to: "2026-11-22" });
    // An extended round, still in its third week.
    expect(phaseSpan("2026-11-09", "2026-12-06", "2026-11-29")).toEqual({ week: 3, started: true, extension: false, from: "2026-11-23", to: "2026-11-29" });
  });

  it("an extended round past its three weeks: the extension up to the deadline, not week 3", () => {
    expect(phaseSpan("2026-11-09", "2026-12-06", "2026-11-30")).toEqual({ week: 3, started: true, extension: true, from: "2026-11-30", to: "2026-12-06" });
    expect(phaseSpan("2026-11-09", "2026-12-13", "2026-12-13")).toEqual({ week: 3, started: true, extension: true, from: "2026-11-30", to: "2026-12-13" });
  });

  it("an extended round after its new deadline (until the next round starts): still the extension", () => {
    expect(phaseSpan("2026-11-09", "2026-12-06", "2026-12-20")).toEqual({ week: 3, started: true, extension: true, from: "2026-11-30", to: "2026-12-06" });
  });

  it("not extended: after the deadline it stays week 3; before the start, week 1", () => {
    expect(phaseSpan("2026-11-09", "2026-11-29", "2026-12-01")).toMatchObject({ week: 3, extension: false, from: "2026-11-23", to: "2026-11-29" });
    expect(phaseSpan("2026-11-09", "2026-11-29", "2026-11-08")).toMatchObject({ week: 1, started: false, extension: false });
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
      played(1, 11, 12, 1, [
        [4, 0],
        [4, 0],
      ]),
      played(2, 14, 13, 1, [
        [4, 0],
        [4, 0],
      ]),
      played(3, 13, 11, 2, [
        [4, 1],
        [4, 1],
      ]),
      open(4, 11, 14, 2),
      played(5, 12, 13, 3, [
        [4, 2],
        [4, 2],
      ]),
      open(6, 12, 14, 3),
    ],
  });
  const without = (): LadderGroupInput => {
    const g = withdrawnGroup();
    return { ...g, pairs: g.pairs.slice(0, 3), matches: g.matches.filter((m) => m.a !== 14 && m.b !== 14) };
  };

  it("leaves the pair and all of its matches out of the table, as if it never played", () => {
    const [band] = buildLadder([withdrawnGroup()], 2, START);
    const [never] = buildLadder([without()], 2, START);
    expect(band!.groups[0]!.rows).toEqual(never!.groups[0]!.rows);
    expect(band!.groups[0]!.rows).toHaveLength(3);
  });

  it("drops its matches from the fixture list and names it apart", () => {
    for (const week of [1, 2, 3]) {
      const g = buildLadder([withdrawnGroup()], week, START)[0]!.groups[0]!;
      const n = buildLadder([without()], week, START)[0]!.groups[0]!;
      expect(g.weeks).toEqual(n.weeks);
    }
    expect(buildLadder([withdrawnGroup()], 1, START)[0]!.groups[0]!.withdrawn).toEqual([["Játékos 14A", "Játékos 14B"]]);
    expect(buildLadder([without()], 1, START)[0]!.groups[0]!.withdrawn).toEqual([]);
  });
});

describe("groupTable: a pair withdrawn mid-phase (#34), for the ladder and Kezdőlap", () => {
  it("leaves the pair and its matches out, as if it never played", () => {
    const pairs = [pair(1), pair(2), pair(3), { ...pair(4), withdrawn: true }];
    const matches = [
      played(1, 1, 2, 1, [
        [4, 0],
        [4, 0],
      ]),
      played(2, 4, 3, 1, [
        [4, 0],
        [4, 0],
      ]),
      played(3, 3, 1, 2, [
        [4, 1],
        [4, 1],
      ]),
      played(4, 1, 4, 2, [
        [4, 2],
        [4, 2],
      ]),
    ];
    const without = groupTable(
      pairs.slice(0, 3),
      matches.filter((m) => m.a !== 4 && m.b !== 4),
    );
    expect(groupTable(pairs, matches)).toEqual(without);
    expect(groupTable(pairs, matches).map((r) => r.pairId)).not.toContain(4);
  });
});

describe("countedOutcome: only a final match counts (#186, #220)", () => {
  const won: MatchOutcome = {
    kind: "played",
    score: {
      sets: [
        [4, 1],
        [4, 2],
      ],
    },
  };

  it("a final match counts with its outcome", () => {
    expect(countedOutcome({ status: "final", outcome: won })).toEqual(won);
  });

  it("a waiting or disputed result stays out whatever outcome is stored", () => {
    for (const status of ["open", "scheduled", "result_pending", "disputed"]) expect(countedOutcome({ status, outcome: won })).toBeNull();
  });
});

describe("isValidOutcome: what the public league page can count (#190, D115)", () => {
  it("accepts every outcome a write can store", () => {
    for (const outcome of [
      {
        kind: "played",
        score: {
          sets: [
            [4, 1],
            [4, 2],
          ],
        },
      },
      {
        kind: "played",
        score: {
          sets: [
            [4, 1],
            [2, 4],
          ],
          superTieBreak: [10, 8],
        },
      },
      // A null super tie-break is none, as the rules engine reads it.
      {
        kind: "played",
        score: {
          sets: [
            [4, 1],
            [4, 2],
          ],
          superTieBreak: null,
        },
      },
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
      {
        kind: "played",
        score: {
          sets: [
            [6, 1],
            [6, 2],
          ],
        },
      },
      {
        kind: "played",
        score: {
          sets: [
            [4, 1],
            [2, 4],
          ],
        },
      },
      {
        kind: "played",
        score: {
          sets: [
            [4, 1],
            [4, 2],
          ],
          superTieBreak: [10, 8],
        },
      },
      {
        kind: "played",
        score: {
          sets: [
            [4, 1],
            [2, 4],
          ],
          superTieBreak: 10,
        },
      },
      {
        kind: "played",
        score: {
          sets: [
            ["4", "1"],
            [4, 2],
          ],
        },
      },
    ])
      expect(isValidOutcome(outcome), JSON.stringify(outcome)).toBe(false);
  });

  it("a valid outcome never makes groupTable throw", () => {
    const outcome: MatchOutcome = {
      kind: "played",
      score: {
        sets: [
          [5, 4],
          [4, 0],
        ],
      },
    };
    expect(isValidOutcome(outcome)).toBe(true);
    expect(groupTable([pair(1), pair(2)], [{ a: 1, b: 2, outcome }])[0]).toMatchObject({ pairId: 1, points: 3 });
  });
});
