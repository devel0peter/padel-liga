import { describe, expect, it } from "vitest";

import {
  filterPairsRows,
  isFiltered,
  PAIRS_FILTERS,
  pairsFilterCounts,
  pairsQueryString,
  pairsSummary,
  parsePairsQuery,
  rowAccounts,
  rowFilters,
  type PairsRow,
} from "./league-pairs-view";
import { ENTRY_STATUS_LABELS } from "./season-entries";

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

describe("the withdrawn entry's word (#174)", () => {
  it("is the same in the filter option and in the entry badge", () => {
    expect(PAIRS_FILTERS.withdrawn).toBe(ENTRY_STATUS_LABELS.withdrawn);
  });
});

describe("pairsSummary, the counts table (#237)", () => {
  const byFilter = (rows: readonly PairsRow[]) => Object.fromEntries(pairsSummary(rows).rows.map((r) => [r.filter, [r.pairs, r.players]]));

  it("has a row per state, pairs and their players; Nincs párja players only, Felbontott pairs only", () => {
    expect(pairsSummary(ROWS).rows.map((r) => PAIRS_FILTERS[r.filter])).toEqual([
      "Nevezett",
      "Nem nevezett",
      "Elutasítva",
      ENTRY_STATUS_LABELS.withdrawn,
      "Nincs párja",
      "Felbontott párok",
    ]);
    expect(byFilter(ROWS)).toEqual({
      entered: [1, 2],
      not_entered: [1, 2],
      rejected: [1, 2],
      withdrawn: [1, 2],
      no_pair: [null, 2],
      dissolved: [1, null],
    });
  });

  it("each number is what that filter lists with an empty search", () => {
    const counts = pairsFilterCounts(ROWS, "");
    for (const r of pairsSummary(ROWS).rows) {
      const listed = filterPairsRows(ROWS, q(r.filter));
      if (r.pairs !== null) expect(r.pairs).toBe(counts[r.filter]);
      if (r.players !== null) expect(r.players).toBe(rowAccounts(listed).length);
    }
  });

  it("Összesen: active pairs, and each player in an active pair or without one once, not those only in a dissolved pair", () => {
    // Anna is in an active pair and in a dissolved one; Imre was in the dissolved one and has no pair now.
    const rows: PairsRow[] = [
      { kind: "pair", pair: { status: "active", entry: null, players: [{ id: "anna", name: "Anna" }, { id: "bela", name: "Béla" }] } },
      { kind: "pair", pair: { status: "dissolved", entry: null, players: [{ id: "anna", name: "Anna" }, { id: "imre", name: "Imre" }] } },
      // An entry left pending from the approval step: active, in no state row, but in the league.
      { kind: "pair", pair: { status: "active", entry: { status: "pending" }, players: [{ id: "cecil", name: "Cecil" }, { id: "dora", name: "Dóra" }] } },
      { kind: "solo", player: { id: "imre", name: "Imre" } },
      // Only in a dissolved pair, no longer a registered player of the league (e.g. deleted).
      { kind: "pair", pair: { status: "dissolved", entry: null, players: [{ id: "bela", name: "Béla" }, { id: "gone", name: "Törölt játékos" }] } },
    ];
    expect(pairsSummary(rows).total).toEqual({ pairs: 2, players: 5 });
    expect(byFilter(rows)).toMatchObject({ not_entered: [1, 2], no_pair: [null, 1], dissolved: [2, null] });
  });

  it("an empty league is all zeros", () => {
    expect(pairsSummary([]).total).toEqual({ pairs: 0, players: 0 });
    expect(pairsSummary([]).rows.every((r) => (r.pairs ?? 0) === 0 && (r.players ?? 0) === 0)).toBe(true);
  });
});
