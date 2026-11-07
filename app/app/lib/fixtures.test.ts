// The fixture list, the up/down marks and the ladder line (D128,
// docs/player-ui.md sections 2-4).
import { describe, expect, it } from "vitest";

import { fixtureWeeks, ladderStanding, moveZones, type FixtureInput } from "./fixtures";

const START = new Date("2026-11-01T23:00:00Z"); // Mon 2 Nov 00:00 Budapest
const pairs = [1, 2, 3, 4].map((id) => ({ id, names: [`P${id}A`, `P${id}B`] as [string, string] }));
const m = (id: number, a: number, b: number, week: number, extra: Partial<FixtureInput> = {}): FixtureInput => ({
  id,
  a,
  b,
  week,
  status: "open",
  scheduledAt: null,
  outcome: null,
  ...extra,
});

describe("fixtureWeeks", () => {
  const matches = [m(1, 1, 4, 1), m(2, 2, 3, 1), m(3, 1, 3, 2), m(4, 2, 4, 2), m(5, 1, 2, 3), m(6, 3, 4, 3)];

  it("links only the viewer's own matches to their page, and marks their side", () => {
    const weeks = fixtureWeeks(pairs, matches, { phaseStartsAt: START, currentWeek: 2, mine: 2 });
    const links = weeks.flatMap((w) => w.matches.filter((x) => x.href).map((x) => x.href));
    expect(links).toEqual(["/matches/2", "/matches/4", "/matches/5"]);
    expect(weeks[0]!.matches[1]!.a.mine).toBe(true);
    expect(weeks[0]!.matches[0]!.a.mine).toBe(false);
  });

  it("names no resting pair in a full group of 4", () => {
    expect(fixtureWeeks(pairs, matches, { phaseStartsAt: START, currentWeek: 1 }).map((w) => w.resting)).toEqual([null, null, null]);
  });

  it("leaves out the matches of a pair not given (withdrawn mid-phase)", () => {
    const weeks = fixtureWeeks(pairs.slice(0, 3), matches, { phaseStartsAt: START, currentWeek: 1 });
    expect(weeks.map((w) => w.matches.length)).toEqual([1, 1, 1]);
    // With pair 4 gone, its opponent of the week rests.
    expect(weeks.map((w) => w.resting?.[0])).toEqual(["P1A", "P2A", "P3A"]);
  });

  it("keeps the venue of a scheduled match and the state of a stored status", () => {
    const at = new Date("2026-11-10T17:30:00Z");
    const [w1] = fixtureWeeks(pairs, [m(1, 1, 4, 1, { status: "scheduled", scheduledAt: at, venue: "Aréna" })], { phaseStartsAt: START, currentWeek: null });
    expect(w1!.matches[0]).toMatchObject({ state: "scheduled", when: "nov. 10., kedd 18:30", venue: "Aréna" });
  });
});

describe("moveZones (spec 10)", () => {
  it("a group of 3 in the middle: 1st up, 3rd down", () => {
    expect(moveZones(3, 2, 3, true)).toEqual(["up", null, "down"]);
  });

  it("a single group moves nobody", () => {
    expect(moveZones(4, 1, 1, true)).toEqual([null, null, null, null]);
  });

  it("nothing before any final result", () => {
    expect(moveZones(4, 2, 3, false)).toEqual([null, null, null, null]);
  });
});

describe("ladderStanding (spec 14)", () => {
  it("counts the promotions to the division's top group and the rounds left", () => {
    // 9 groups: Bronz 1-3, Réz 4-6, Rookie 7-9.
    expect(ladderStanding(6, 9, 1)).toBe("még 2 feljutás a divízió éléig, 3 kör van hátra");
    expect(ladderStanding(4, 9, 2)).toBe("a Réz divízió élén vagytok, 2 kör van hátra");
    expect(ladderStanding(1, 9, 4)).toBe("a létra csúcsán vagytok, ez az utolsó kör");
  });
});
