import { describe, expect, it } from "vitest";

import { rankRows, type RankInput } from "./rankings";

const row = (key: string, name: string, rating: number, extra: Partial<RankInput> = {}): RankInput => ({
  key,
  name,
  rating,
  href: null,
  mine: false,
  matches: null,
  division: null,
  ...extra,
});

describe("rankRows (D137)", () => {
  it("orders by Élő-pont, highest first, and numbers the places", () => {
    const rows = rankRows([row("a", "Anna", 1210), row("b", "Bea", 1450.4), row("c", "Cili", 1302)]);
    expect(rows.map((r) => [r.place, r.name, r.elo])).toEqual([
      [1, "Bea", 1450],
      [2, "Cili", 1302],
      [3, "Anna", 1210],
    ]);
  });

  it("rounds before comparing: equal shown values share a place, the next place skips", () => {
    const rows = rankRows([row("a", "Anna", 1400.4), row("b", "Bea", 1399.6), row("c", "Cili", 1500), row("d", "Dóra", 1300)]);
    expect(rows.map((r) => [r.place, r.name])).toEqual([
      [1, "Cili"],
      [2, "Anna"],
      [2, "Bea"],
      [4, "Dóra"],
    ]);
  });

  it("lists a three-way tie by name, in Hungarian order, until the tiebreak rules exist (#345)", () => {
    const rows = rankRows([row("1", "Zsófi", 1200), row("2", "Ádám", 1200), row("3", "Csaba", 1200)]);
    expect(rows.map((r) => [r.place, r.name])).toEqual([
      [1, "Ádám"],
      [1, "Csaba"],
      [1, "Zsófi"],
    ]);
  });

  it("keeps the link, the viewer's mark and the match count", () => {
    const [r] = rankRows([row("u1", "Anna", 1000, { href: "/players/u1", mine: true, matches: 3 })]);
    expect(r).toEqual({ key: "u1", name: "Anna", elo: 1000, place: 1, href: "/players/u1", mine: true, matches: 3, division: null });
  });

  it("keeps the division (D138)", () => {
    expect(rankRows([row("p1", "Anna – Bea", 1400, { division: "rez" })])[0].division).toBe("rez");
  });

  it("is empty for nobody", () => {
    expect(rankRows([])).toEqual([]);
  });
});
