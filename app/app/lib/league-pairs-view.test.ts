import { describe, expect, it } from "vitest";

import {
  filterPairsRows,
  isFiltered,
  PAIRS_FILTERS,
  pairsFilterCounts,
  pairsQueryString,
  parsePairsQuery,
  rowAccounts,
  rowFilters,
  type PairsRow,
} from "./league-pairs-view";
import { ENTRY_STATUS_LABELS } from "./season-entries";

const pair = (id: string, names: [string, string], status: "active" | "dissolved", entry: string | null): PairsRow => ({
  status,
  entry: entry ? { status: entry as any } : null,
  players: names.map((name, i) => ({ id: `${id}${i}`, name })),
});

const ROWS: PairsRow[] = [
  pair("e", ["Kovács Anna", "Nagy Béla"], "active", "approved"),
  pair("n", ["Szabó Cecil", "Tóth Dóra"], "active", null),
  pair("r", ["Kiss Edit", "Varga Ferenc"], "active", "rejected"),
  pair("w", ["Molnár Gábor", "Farkas Hanna"], "active", "withdrawn"),
  pair("d", ["Kovács Anna", "Lakatos Imre"], "dissolved", "withdrawn"),
];

const q = (entry: string | null, search = "") => parsePairsQuery(new URLSearchParams({ ...(entry ? { entry } : {}), q: search }));
const names = (rows: PairsRow[]) => rows.map((r) => r.players[0]!.name);

describe("rowFilters (#148)", () => {
  it("puts each pair in its entry state, and every pair not in the season in Nincs a ligában", () => {
    expect(ROWS.map(rowFilters)).toEqual([
      ["entered"],
      ["not_entered", "not_in_league"],
      ["rejected", "not_in_league"],
      ["withdrawn", "not_in_league"],
      ["dissolved"],
    ]);
  });

  it("a pending entry left from the approval step (#153) is not in the season", () => {
    expect(rowFilters(pair("p", ["A", "B"], "active", "pending"))).toEqual(["not_in_league"]);
  });
});

describe("filterPairsRows", () => {
  it("Nincs a ligában lists exactly the active pairs not entered (the players without a pair are on Játékosok, #301)", () => {
    expect(names(filterPairsRows(ROWS, q("not_in_league")))).toEqual(["Szabó Cecil", "Kiss Edit", "Molnár Gábor"]);
  });

  it("Nevezett lists exactly the entered pairs; Felbontott párok the dissolved ones", () => {
    expect(names(filterPairsRows(ROWS, q("entered")))).toEqual(["Kovács Anna"]);
    expect(filterPairsRows(ROWS, q("dissolved"))).toEqual([ROWS[4]]);
  });

  it("searches names ignoring case and accents; a pair matches when either player does", () => {
    expect(names(filterPairsRows(ROWS, q(null, "kovacs")))).toEqual(["Kovács Anna", "Kovács Anna"]);
    expect(names(filterPairsRows(ROWS, q(null, "DORA")))).toEqual(["Szabó Cecil"]);
    expect(names(filterPairsRows(ROWS, q(null, "imre")))).toEqual(["Kovács Anna"]);
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
      dissolved: 1,
      not_in_league: 3,
    });
  });
});

describe("the query in the address", () => {
  it("reads a known filter and the search, ignores an unknown filter", () => {
    expect(parsePairsQuery(new URLSearchParams("entry=rejected&q=%20kiss%20"))).toEqual({ entry: "rejected", q: "kiss" });
    // Nincs párja moved to Játékosok (#301): Párok's loader redirects it.
    expect(parsePairsQuery(new URLSearchParams("entry=no_pair"))).toEqual({ entry: null, q: "" });
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
    expect(rowAccounts([ROWS[0]!, ROWS[0]!, ROWS[1]!])).toEqual(["e0", "e1", "n0", "n1"]);
  });
});

describe("the withdrawn entry's word (#174)", () => {
  it("is the same in the filter option and in the entry badge", () => {
    expect(PAIRS_FILTERS.withdrawn).toBe(ENTRY_STATUS_LABELS.withdrawn);
  });
});
