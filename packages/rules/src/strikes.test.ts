import { describe, expect, it } from "vitest";

import { applyStrikes, pairsLeaving, STRIKE_LIMIT, STRIKE_WARNING, strikeCount, strikeCounts, strikeNotice, type StrikeRecord } from "./strikes";

describe("applyStrikes (spec 8, 13)", () => {
  it("adds one per player in order, updating the counts, with the pair's highest count after each grant", () => {
    const counts = new Map([["x", 2]]);
    expect(
      applyStrikes(counts, [
        { pairId: 1, players: ["x", "y"] },
        { pairId: 2, players: ["z", "w"] },
        { pairId: 1, players: ["x", "y"] },
      ]),
    ).toEqual([
      { pairId: 1, player: "x", count: 3, pairCount: 3 },
      { pairId: 1, player: "y", count: 1, pairCount: 3 },
      { pairId: 2, player: "z", count: 1, pairCount: 1 },
      { pairId: 2, player: "w", count: 1, pairCount: 1 },
      { pairId: 1, player: "x", count: 4, pairCount: 4 },
      { pairId: 1, player: "y", count: 2, pairCount: 4 },
    ]);
    expect(counts).toEqual(
      new Map([
        ["x", 4],
        ["y", 2],
        ["z", 1],
        ["w", 1],
      ]),
    );
  });

  it("a grant without players gives nothing", () => {
    expect(applyStrikes(new Map(), [{ pairId: 1, players: [] }])).toEqual([]);
  });
});

const s = (userId: string, seasonId = 1, cancelled = false): StrikeRecord => ({ userId, seasonId, cancelled });

describe("strikeCounts (spec 8, #294)", () => {
  it("counts per player in the season", () => {
    expect(strikeCounts([s("x"), s("x"), s("y")], 1)).toEqual(
      new Map([
        ["x", 2],
        ["y", 1],
      ]),
    );
  });

  it("resets at the season start: another season's strikes don't count", () => {
    const list = [s("x", 1), s("x", 1), s("x", 2)];
    expect(strikeCount(list, "x", 1)).toBe(2);
    expect(strikeCount(list, "x", 2)).toBe(1);
    expect(strikeCount(list, "x", 3)).toBe(0);
  });

  it("follows the player across partner changes: strikes from two pairs add up", () => {
    // The pair isn't part of the count: only the player and the season.
    const withOld = { ...s("x"), pairId: 1 };
    const withNew = { ...s("x"), pairId: 2 };
    expect(strikeCount([withOld, withNew], "x", 1)).toBe(2);
  });

  it("a cancelled strike doesn't count (the count is recomputed)", () => {
    expect(strikeCount([s("x"), s("x", 1, true), s("x")], "x", 1)).toBe(2);
    expect(strikeCount([s("x", 1, true)], "x", 1)).toBe(0);
  });
});

describe("strikeNotice (spec 13)", () => {
  it("1st: a notice with the count; 2nd: the warning; 3rd and on: the pair leaves", () => {
    expect(strikeNotice(0)).toBeNull();
    expect(strikeNotice(1)).toBe("strike");
    expect(strikeNotice(STRIKE_WARNING)).toBe("warning");
    expect(strikeNotice(STRIKE_LIMIT)).toBe("leaving");
    expect(strikeNotice(4)).toBe("leaving");
  });

  it("the pair leaves when the partner has 3 (a partner change): both are told so, no warning", () => {
    expect(strikeNotice(1, STRIKE_LIMIT)).toBe("leaving");
    expect(strikeNotice(STRIKE_WARNING, 4)).toBe("leaving");
    expect(strikeNotice(1, STRIKE_WARNING)).toBe("strike");
    expect(strikeNotice(STRIKE_WARNING, 1)).toBe("warning");
    expect(strikeNotice(0, STRIKE_LIMIT)).toBeNull();
  });
});

describe("pairsLeaving (spec 8, 10)", () => {
  const pairs = [
    { id: 1, players: ["a1", "a2"] },
    { id: 2, players: ["b1", "b2"] },
    { id: 3, players: ["c1", "c2"] },
  ];

  it("a pair with a player at the 3rd strike is flagged to leave; 2 strikes are not enough", () => {
    const counts = new Map([
      ["a2", 3],
      ["b1", 2],
      ["b2", 2],
    ]);
    expect(pairsLeaving(pairs, counts).map((p) => p.id)).toEqual([1]);
  });

  it("a cancelled 3rd strike takes the pair off the list", () => {
    const list = [s("a1"), s("a1"), s("a1", 1, true)];
    expect(pairsLeaving(pairs, strikeCounts(list, 1))).toEqual([]);
  });
});
