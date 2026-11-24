// Ligáim's pure parts (#394): the round line, the summary and the place from
// the Tabella's bands, the place lines, and the card order.
import { describe, expect, it } from "vitest";

import type { FixtureMatch, FixtureWeek } from "./fixtures";
import type { LadderBand, LadderGroup, LadderRow } from "./ladder";
import { leagueSummary, newestFirst, nextRoundText, ownPlace, placeText, roundInfo, seasonOrder, startsText } from "./my-leagues";
import { WAITING_START } from "./season-entries";

const at = (iso: string) => new Date(iso);
// Phases from Monday 9 Nov 2026 (Budapest, UTC+1), each ending Sunday 23:59.
const PHASES = [
  { number: 1, startsAt: at("2026-11-08T23:00:00Z"), deadline: at("2026-12-06T22:59:00Z") },
  { number: 2, startsAt: at("2026-12-06T23:00:00Z"), deadline: at("2026-12-27T22:59:00Z") },
];
const season = { phases: PHASES, waiting: null };

describe("roundInfo", () => {
  it("names the running round, its dates and its deadline in Budapest time", () => {
    expect(roundInfo(season, at("2026-11-24T20:00:00Z"))).toEqual({
      kind: "running",
      round: 1,
      from: "nov. 9.",
      to: "dec. 6.",
      deadline: "dec. 6., vasárnap 23:59",
    });
  });

  it("is still the round on its deadline's last minute, and the next one a minute later", () => {
    expect(roundInfo(season, at("2026-12-06T22:59:00Z"))).toMatchObject({ kind: "running", round: 1 });
    expect(roundInfo(season, at("2026-12-06T23:00:00Z"))).toMatchObject({ kind: "running", round: 2 });
  });

  it("between rounds and before the season: when the next one starts", () => {
    const gap = { phases: [PHASES[0]!, { number: 2, startsAt: at("2026-12-13T23:00:00Z"), deadline: at("2027-01-03T22:59:00Z") }], waiting: null };
    const between = roundInfo(gap, at("2026-12-09T12:00:00Z"));
    expect(between).toEqual({ kind: "next", round: 2, startsOn: "december 14-én" });
    expect(nextRoundText(between as Extract<typeof between, { kind: "next" }>)).toBe("A 2. kör december 14-én indul.");
    const before = roundInfo(season, at("2026-11-01T12:00:00Z"));
    expect(nextRoundText(before as Extract<typeof before, { kind: "next" }>)).toBe("Az 1. kör november 9-én indul.");
  });

  it("a waiting first season (D124), a finished one, and none", () => {
    expect(roundInfo({ phases: [], waiting: "9 pár nevezett, még 3 kell, utána indul." }, at("2026-11-01T12:00:00Z"))).toEqual({
      kind: "waiting",
      text: "9 pár nevezett, még 3 kell, utána indul.",
    });
    expect(roundInfo(season, at("2027-01-10T12:00:00Z"))).toEqual({ kind: "over" });
    expect(roundInfo(null, at("2027-01-10T12:00:00Z"))).toEqual({ kind: "none" });
  });
});

const match = (state: FixtureMatch["state"]) => ({ state }) as FixtureMatch;
const week = (states: FixtureMatch["state"][]) => ({ matches: states.map(match) }) as FixtureWeek;
const row = (pairId: number, rank: number, mine = false) => ({ pairId, rank, mine }) as LadderRow;
const group = (number: number, rows: LadderRow[], weeks: FixtureWeek[], ranked = true): LadderGroup => ({
  number,
  mine: rows.some((r) => r.mine),
  ranked,
  rows,
  weeks,
  withdrawn: [],
});
const band = (groups: LadderGroup[]) => ({ division: "bronz", label: "Bronz divízió", groups }) as LadderBand;

describe("leagueSummary", () => {
  it("counts the Tabella's pairs, groups, and final matches out of all", () => {
    const bands = [
      band([group(1, [row(1, 1), row(2, 2), row(3, 3)], [week(["final"]), week(["scheduled"]), week(["open"])])]),
      band([
        group(2, [row(4, 1), row(5, 2), row(6, 3), row(7, 4)], [week(["final", "final"]), week(["pending", "disputed"]), week(["open", "open"])]),
      ]),
    ];
    expect(leagueSummary(1, bands)).toEqual({ round: 1, pairs: 7, groups: 2, played: 3, total: 9 });
  });

  it("a waiting or disputed result is not played yet: only final counts (D80)", () => {
    const bands = [band([group(1, [row(1, 1), row(2, 2), row(3, 3)], [week(["pending"]), week(["disputed"]), week(["scheduled"])])])];
    expect(leagueSummary(2, bands)).toEqual({ round: 2, pairs: 3, groups: 1, played: 0, total: 3 });
  });

  it("no groups: zeros", () => {
    expect(leagueSummary(1, [])).toEqual({ round: 1, pairs: 0, groups: 0, played: 0, total: 0 });
  });
});

describe("ownPlace and placeText", () => {
  it("the viewer's group and place", () => {
    const bands = [band([group(1, [row(1, 1), row(2, 2)], []), group(3, [row(8, 1), row(9, 2, true)], [])])];
    const place = ownPlace(bands)!;
    expect(place).toEqual({ group: 3, rank: 2 });
    expect(placeText(place)).toBe("A 3. csoportban vagytok, most 2. helyen");
  });

  it("before any final result only the group: the order is the seeding (D85)", () => {
    const place = ownPlace([band([group(1, [row(1, 1, true), row(2, 2)], [], false)])])!;
    expect(place).toEqual({ group: 1, rank: null });
    expect(placeText(place)).toBe("Az 1. csoportban vagytok");
  });

  it("not in any group: null", () => {
    expect(ownPlace([band([group(1, [row(1, 1), row(2, 2)], [])])])).toBeNull();
    expect(ownPlace([])).toBeNull();
  });
});

describe("startsText", () => {
  it("the round the pair starts in, with its day", () => {
    expect(startsText(2, at("2026-12-06T23:00:00Z"))).toBe("A 2. körben kezdtek (dec. 7.)");
    expect(startsText(1, at("2026-11-08T23:00:00Z"))).toBe("Az 1. körben kezdtek (nov. 9.)");
  });

  it("a first season with no start yet (D124): no day", () => {
    expect(startsText(1, null)).toBe(`Az 1. körben kezdtek. ${WAITING_START}`);
  });
});

describe("newestFirst", () => {
  it("the newest season first, a waiting one before any, a league without a season last, ties by name", () => {
    const card = (name: string, s: Parameters<typeof seasonOrder>[0]) => ({ league: { name }, order: seasonOrder(s) });
    const later = { phases: [{ number: 1, startsAt: at("2027-02-01T23:00:00Z"), deadline: at("2027-02-21T22:59:00Z") }], waiting: null };
    const cards = [
      card("Nincs", null),
      card("Régi", season),
      card("Új", later),
      card("Várakozó", { phases: [], waiting: "még 3 kell" }),
      card("Ábel", season),
    ];
    expect(newestFirst(cards).map((c) => c.league.name)).toEqual(["Várakozó", "Új", "Ábel", "Régi", "Nincs"]);
  });
});
