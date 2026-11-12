import { describe, expect, it } from "vitest";

import { projectionIntro, projectionKind, projectionLine, projectionTotals, projectionView } from "./deadline-projection";
import { filterMatches, parseFilter } from "./match-overview";

const resolve = (outcome: any) => ({ kind: "resolve" as const, resolution: { outcome, inactive: [] as ("a" | "b")[] } });
const leave = (reason: "final" | "withdrawn" | "result_pending" | "disputed" | "no_show") => ({ kind: "leave" as const, reason });
const NAMES = { a: "Kiss–Nagy", b: "Tóth–Szabó" };

describe("the deadline projection's wording (#362)", () => {
  it("each decision has one kind", () => {
    expect(projectionKind(resolve({ kind: "walkover", winner: "a" }))).toBe("walkover");
    expect(projectionKind(resolve({ kind: "both-inactive" }))).toBe("both_lose");
    expect(projectionKind(resolve({ kind: "unplayed" }))).toBe("unplayed");
    expect(projectionKind(leave("final"))).toBe("final");
    for (const r of ["result_pending", "disputed", "no_show"] as const) expect(projectionKind(leave(r))).toBe("left");
  });

  it("one short line per match: the outcome naming the pairs, or why the deadline leaves it alone", () => {
    expect(projectionLine(resolve({ kind: "walkover", winner: "b" }), NAMES)).toBe("Ha most lenne a határidő: Játék nélküli győzelem: Tóth–Szabó (4:0, 4:0)");
    expect(projectionLine(resolve({ kind: "both-inactive" }), NAMES)).toBe("Ha most lenne a határidő: Mindkét pár vereséget kap (0:4, 0:4)");
    expect(projectionLine(resolve({ kind: "unplayed" }), NAMES)).toBe("Ha most lenne a határidő: Elmaradt: nem számít bele a tabellába");
    expect(projectionLine(leave("result_pending"), NAMES)).toBe("Nem dönt róla a határidő: az eredmény megerősítésre vár, 48 óra után magától elfogadjuk");
    expect(projectionLine(leave("disputed"), NAMES)).toBe("Nem dönt róla a határidő: vitatott eredmény, te döntesz róla");
    expect(projectionLine(leave("final"), NAMES)).toBeNull();
  });

  it("the totals add up to the counting matches, in a fixed order", () => {
    expect(projectionTotals(["walkover", "final", "final", "left"])).toEqual([
      { kind: "walkover", label: "Játék nélküli győzelem", count: 1 },
      { kind: "both_lose", label: "Mindkét pár veszít", count: 0 },
      { kind: "unplayed", label: "Elmarad", count: 0 },
      { kind: "left", label: "Nem dönt róla a határidő", count: 1 },
      { kind: "final", label: "Már lejátszva vagy eldöntve", count: 2 },
    ]);
  });

  it("names the round's deadline", () => {
    expect(projectionIntro("nov. 29., vasárnap 23:59")).toBe(
      "Ezt döntené a rendszer a még le nem játszott meccsekről, ha a határidő (nov. 29., vasárnap 23:59) most lenne.",
    );
  });

  it("the strike lists: names and counts only, a leaving pair not also in the 2nd strike list", () => {
    const pairs = new Map([
      [1, { players: [{ id: "x", name: "X", email: "x@x.hu" }, { id: "y", name: "Y", email: "y@x.hu" }] }],
      [2, { players: [{ id: "z", name: "Z", email: "z@x.hu" }, { id: "w", name: "W", email: "w@x.hu" }] }],
    ]);
    const view = projectionView({
      matches: [],
      pairs,
      strikes: new Map([
        ["x", { now: 1, after: 2 }],
        ["y", { now: 0, after: 1 }],
        ["z", { now: 1, after: 3 }],
        ["w", { now: 1, after: 2 }],
      ]),
      warned: [
        { pairId: 1, userId: "x" },
        { pairId: 2, userId: "w" },
      ],
      leaving: [2],
    });
    expect(view.newStrikes).toBe(5);
    expect(view.warned).toEqual([{ player: { id: "x", name: "X", now: 1, after: 2 }, pair: [{ id: "x", name: "X" }, { id: "y", name: "Y" }] }]);
    expect(view.leaving.map((l) => l.pairId)).toEqual([2]);
    expect(JSON.stringify(view)).not.toContain("@");
  });
});

describe("the list's ?deadline= filter (#362)", () => {
  it("reads the kind from the address and shows only those matches", () => {
    expect(parseFilter(new URLSearchParams("deadline=walkover")).deadline).toBe("walkover");
    expect(parseFilter(new URLSearchParams("deadline=nope")).deadline).toBeNull();
    const m = (id: number, deadline: "walkover" | "final" | null) => ({ id, groupNumber: 1, week: 1, status: "to_schedule" as const, stuck: null, deadline });
    const all = [m(1, "walkover"), m(2, "final"), m(3, "walkover")];
    expect(filterMatches(all, parseFilter(new URLSearchParams("deadline=walkover"))).shown.map((x) => x.id)).toEqual([1, 3]);
    expect(filterMatches(all, parseFilter(new URLSearchParams(""))).shown).toHaveLength(3);
  });
});
