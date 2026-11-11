import { describe, expect, it } from "vitest";

import {
  filterPlayers,
  isPlayersFiltered,
  parsePlayersQuery,
  playerFilters,
  PLAYERS_FILTERS,
  playersFilterCounts,
  playersPath,
  playersQueryString,
  type LeaguePlayerRow,
} from "./league-players";

const NO_LEVEL = { text: "Nincs szintje", tone: "todo" as const };

const row = (id: string, name: string, o: Partial<LeaguePlayerRow> = {}): LeaguePlayerRow => ({
  id,
  name,
  level: "kezdo",
  phone: "+36 30 123 4567",
  seeking: false,
  seekingSince: null,
  pair: null,
  entered: false,
  entryChip: null,
  missing: [],
  ...o,
});

const ROWS: LeaguePlayerRow[] = [
  row("a", "Kovács Anna", { pair: { id: 1, partnerId: "b", partner: "Nagy Béla" }, entered: true }),
  row("b", "Nagy Béla", { pair: { id: 1, partnerId: "a", partner: "Kovács Anna" }, entered: true }),
  row("c", "Szabó Cecil", { pair: { id: 2, partnerId: "d", partner: "Tóth Dóra" } }),
  row("g", "Ákos Sándor"),
  row("k", "Pál Boglárka", { seeking: true, seekingSince: new Date(5_000), missing: [NO_LEVEL], level: null }),
];

const q = (filter: string | null, search = "") => parsePlayersQuery(new URLSearchParams({ ...(filter ? { filter } : {}), q: search }));
const ids = (rows: LeaguePlayerRow[]) => rows.map((r) => r.id);

describe("playerFilters (#301)", () => {
  it("puts every player in exactly one of Nincs párja / Van párja and one of Nevezett / Nem nevezett", () => {
    expect(ROWS.map(playerFilters)).toEqual([
      ["paired", "entered"],
      ["paired", "entered"],
      ["paired", "not_entered"],
      ["no_pair", "not_entered"],
      ["no_pair", "seeking", "not_entered", "missing"],
    ]);
  });

  it("counts Párt keres only while the player has no pair (the switch stays on after pairing, D59)", () => {
    expect(playerFilters(row("x", "X", { seeking: true, pair: { id: 9, partnerId: "y", partner: "Y" } }))).not.toContain("seeking");
  });
});

describe("filterPlayers", () => {
  it("each filter lists exactly its players", () => {
    expect(ids(filterPlayers(ROWS, q("no_pair")))).toEqual(["g", "k"]);
    expect(ids(filterPlayers(ROWS, q("seeking")))).toEqual(["k"]);
    expect(ids(filterPlayers(ROWS, q("paired")))).toEqual(["a", "b", "c"]);
    expect(ids(filterPlayers(ROWS, q("entered")))).toEqual(["a", "b"]);
    expect(ids(filterPlayers(ROWS, q("not_entered")))).toEqual(["c", "g", "k"]);
    expect(ids(filterPlayers(ROWS, q("missing")))).toEqual(["k"]);
  });

  it("lists Párt keres by level, then the longest waiting first, as Párkeresők did", () => {
    const seekers = [
      row("x", "Xénia", { seeking: true, seekingSince: new Date(3_000), level: "halado" }),
      row("y", "Yvett", { seeking: true, seekingSince: new Date(2_000), level: "kezdo" }),
      row("z", "Zoé", { seeking: true, seekingSince: new Date(1_000), level: "kezdo" }),
      row("w", "Vilma", { seeking: true, seekingSince: new Date(1_000), level: null }),
    ];
    expect(ids(filterPlayers(seekers, q("seeking")))).toEqual(["z", "y", "x", "w"]);
    // Any other list stays by name (the rows' order).
    expect(ids(filterPlayers(seekers, q("no_pair")))).toEqual(["x", "y", "z", "w"]);
  });

  it("searches the player's and the partner's name, ignoring case and accents", () => {
    expect(ids(filterPlayers(ROWS, q(null, "akos")))).toEqual(["g"]);
    expect(ids(filterPlayers(ROWS, q(null, "DORA")))).toEqual(["c"]);
    expect(ids(filterPlayers(ROWS, q("paired", "kovacs")))).toEqual(["a", "b"]);
  });

  it("without a search or filter shows everyone", () => {
    expect(filterPlayers(ROWS, q(null))).toEqual(ROWS);
  });
});

describe("playersFilterCounts", () => {
  it("each count is the number of rows the option shows, with the search on too", () => {
    for (const search of ["", "kovacs", "a"]) {
      const counts = playersFilterCounts(ROWS, search);
      for (const [filter, n] of Object.entries(counts)) expect(filterPlayers(ROWS, q(filter, search)), `${filter} ${search}`).toHaveLength(n);
    }
    expect(playersFilterCounts(ROWS, "")).toEqual({ no_pair: 2, seeking: 1, paired: 3, entered: 2, not_entered: 3, missing: 1 });
  });
});

describe("the query in the address", () => {
  it("reads a known filter and the search, ignores an unknown one", () => {
    expect(parsePlayersQuery(new URLSearchParams("filter=seeking&q=%20kiss%20"))).toEqual({ filter: "seeking", q: "kiss" });
    expect(parsePlayersQuery(new URLSearchParams("filter=toString"))).toEqual({ filter: null, q: "" });
  });

  it("writes only what is set", () => {
    expect(playersQueryString({ filter: "no_pair", q: "Kiss" })).toBe("filter=no_pair&q=Kiss");
    expect(playersQueryString({ filter: null, q: "" })).toBe("");
    expect(isPlayersFiltered({ filter: null, q: "" })).toBe(false);
    expect(isPlayersFiltered({ filter: null, q: "x" })).toBe(true);
  });

  it("builds the page address the old Párkeresők and Nincs párja links go to (#301 requirement 5)", () => {
    expect(playersPath("gyor", { filter: "seeking" })).toBe("/admin/leagues/gyor/players?filter=seeking");
    expect(playersPath("gyor", { filter: "no_pair", q: "kiss" })).toBe("/admin/leagues/gyor/players?filter=no_pair&q=kiss");
    expect(playersPath("gyor")).toBe("/admin/leagues/gyor/players");
  });

  it("names every filter in Hungarian", () => {
    expect(Object.values(PLAYERS_FILTERS)).toEqual(["Nincs párja", "Párt keres", "Van párja", "Nevezett", "Nem nevezett", "Hiányzó adat"]);
  });
});
