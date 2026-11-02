import { describe, expect, it } from "vitest";

import {
  filterPairsRows,
  isFiltered,
  pairsFilterCounts,
  pairsQueryString,
  parsePairsQuery,
  rowAccounts,
  rowFilters,
  type PairsRow,
} from "./league-pairs-view";

const pair = (id: string, names: [string, string], status: "active" | "dissolved", entry: string | null): PairsRow => ({
  kind: "pair",
  pair: {
    status,
    entry: entry ? { status: entry as any } : null,
    players: names.map((name, i) => ({ id: `${id}${i}`, name })),
  },
});
const solo = (id: string, name: string): PairsRow => ({ kind: "solo", player: { id, name } });

const ROWS: PairsRow[] = [
  pair("e", ["Kovács Anna", "Nagy Béla"], "active", "approved"),
  pair("n", ["Szabó Cecil", "Tóth Dóra"], "active", null),
  pair("r", ["Kiss Edit", "Varga Ferenc"], "active", "rejected"),
  pair("w", ["Molnár Gábor", "Farkas Hanna"], "active", "withdrawn"),
  pair("d", ["Kovács Anna", "Lakatos Imre"], "dissolved", "withdrawn"),
  solo("s1", "Ákos Sándor"),
  solo("s2", "Pál Boglárka"),
];

const q = (entry: string | null, search = "") => parsePairsQuery(new URLSearchParams({ ...(entry ? { entry } : {}), q: search }));
const names = (rows: PairsRow[]) => rows.map((r) => (r.kind === "solo" ? r.player.name : r.pair.players[0]!.name));

describe("rowFilters (#148)", () => {
  it("puts each row in its entry state, and everyone not in the season in Nincs a ligában", () => {
    expect(ROWS.map(rowFilters)).toEqual([
      ["entered"],
      ["not_entered", "not_in_league"],
      ["rejected", "not_in_league"],
      ["withdrawn", "not_in_league"],
      ["dissolved"],
      ["no_pair", "not_in_league"],
      ["no_pair", "not_in_league"],
    ]);
  });

  it("a pending entry left from the approval step (#153) is not in the season", () => {
    expect(rowFilters(pair("p", ["A", "B"], "active", "pending"))).toEqual(["not_in_league"]);
  });
});

describe("filterPairsRows", () => {
  it("Nincs a ligában lists exactly the players without a pair and the pairs not entered", () => {
    expect(names(filterPairsRows(ROWS, q("not_in_league")))).toEqual(["Szabó Cecil", "Kiss Edit", "Molnár Gábor", "Ákos Sándor", "Pál Boglárka"]);
  });

  it("Nevezett lists exactly the entered pairs; Felbontott párok the dissolved ones", () => {
    expect(names(filterPairsRows(ROWS, q("entered")))).toEqual(["Kovács Anna"]);
    expect(filterPairsRows(ROWS, q("dissolved"))).toEqual([ROWS[4]]);
  });

  it("searches names ignoring case and accents; a pair matches when either player does", () => {
    expect(names(filterPairsRows(ROWS, q(null, "kovacs")))).toEqual(["Kovács Anna", "Kovács Anna"]);
    expect(names(filterPairsRows(ROWS, q(null, "DORA")))).toEqual(["Szabó Cecil"]);
    expect(names(filterPairsRows(ROWS, q(null, "akos")))).toEqual(["Ákos Sándor"]);
    expect(names(filterPairsRows(ROWS, q("entered", "kovacs")))).toEqual(["Kovács Anna"]);
  });

  it("without a search or filter shows every row", () => {
    expect(filterPairsRows(ROWS, q(null))).toEqual(ROWS);
  });
});

describe("pairsFilterCounts", () => {
  it("counts each option, and the counts match the rows picking it shows, with the search on too", () => {
    for (const search of ["", "kovacs", "a"]) {
      const counts = pairsFilterCounts(ROWS, search);
      for (const [entry, n] of Object.entries(counts)) expect(filterPairsRows(ROWS, q(entry, search)), `${entry} ${search}`).toHaveLength(n);
    }
    expect(pairsFilterCounts(ROWS, "")).toEqual({
      entered: 1,
      not_entered: 1,
      rejected: 1,
      withdrawn: 1,
      no_pair: 2,
      dissolved: 1,
      not_in_league: 5,
    });
  });
});

describe("the query in the address", () => {
  it("reads a known filter and the search, ignores an unknown filter", () => {
    expect(parsePairsQuery(new URLSearchParams("entry=no_pair&q=%20kiss%20"))).toEqual({ entry: "no_pair", q: "kiss" });
    expect(parsePairsQuery(new URLSearchParams("entry=toString"))).toEqual({ entry: null, q: "" });
    expect(parsePairsQuery(new URLSearchParams("entry=pending"))).toEqual({ entry: null, q: "" });
  });

  it("writes only what is set; cleared is the bare page", () => {
    expect(pairsQueryString({ entry: "entered", q: "Kiss" })).toBe("entry=entered&q=Kiss");
    expect(pairsQueryString({ entry: null, q: "" })).toBe("");
    expect(isFiltered({ entry: null, q: "" })).toBe(false);
    expect(isFiltered({ entry: null, q: "x" })).toBe(true);
  });
});

describe("rowAccounts", () => {
  it("each player of the rows, once", () => {
    expect(rowAccounts([ROWS[0]!, ROWS[0]!, ROWS[5]!])).toEqual(["e0", "e1", "s1"]);
  });
});
