// The Felhasználók filters (users-filter.ts, #151).
import { describe, expect, it } from "vitest";

import type { RoleLabel } from "./auth/permissions";
import type { PlayerStatus } from "./player-status";
import { filterCounts, filterUsers, hasUserFilters, parseUserFilters, userFacts } from "./users-filter";

const pair = (extra: Partial<PlayerStatus["pairs"][number]> = {}) => ({
  leagueId: 1,
  league: "Győr",
  city: "gyor",
  partner: "Béla",
  entry: null,
  season: null,
  ...extra,
});
const status = (extra: Partial<PlayerStatus> = {}): PlayerStatus => ({
  registered: true,
  level: "halado",
  phone: true,
  pairs: [pair()],
  ...extra,
});
const row = (name: string, s: PlayerStatus | undefined, role: RoleLabel = "Játékos") => ({
  name,
  facts: userFacts({ role, name, email: `${name.toLowerCase()}@example.test` }, s),
});
const filters = (query: string) => parseUserFilters(new URLSearchParams(query));
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

const rows = [
  row("Anna", status({ pairs: [pair({ season: "Tél", entry: { season: "Tél", status: "approved" } })] })),
  row("Bence", status({ pairs: [pair({ season: "Tél" })] })),
  row("Csilla", status({ pairs: [] })),
  row("Dani", status({ registered: false, level: null, phone: false, pairs: [] })),
  row("Emese", status({ level: null })),
  row("Feri", status({ phone: false })),
  row("Gabi", status({ pairs: [pair({ season: "Tél", entry: { season: "Tél", status: "pending" } })] })),
  row("Hanna", status({ pairs: [pair({ season: "Tél", entry: { season: "Tél", status: "rejected" } })] })),
  row("Ivett", status(), "Szervező"),
  row("Jenő", status(), "Admin"),
];

describe("parseUserFilters", () => {
  it("reads the search and the four groups, and drops unknown values", () => {
    expect(filters("q=%20ana%20&role=admin&registration=done&missing=phone&pair=none")).toEqual({
      q: "ana",
      role: "admin",
      registration: "done",
      missing: "phone",
      pair: "none",
    });
    expect(filters("role=nope&pair=constructor&missing=")).toEqual({ q: "", role: "", registration: "", missing: "", pair: "" });
  });

  it("tells whether anything is set", () => {
    expect(hasUserFilters(filters(""))).toBe(false);
    expect(hasUserFilters(filters("q=a"))).toBe(true);
    expect(hasUserFilters(filters("role=player"))).toBe(true);
    expect(hasUserFilters(filters("role=nope"))).toBe(false);
  });
});

describe("filterUsers, one group at a time", () => {
  it("role: Játékos, Szervező, Admin", () => {
    expect(names(filterUsers(rows, filters("role=admin")))).toEqual(["Jenő"]);
    expect(names(filterUsers(rows, filters("role=organizer")))).toEqual(["Ivett"]);
    expect(filterUsers(rows, filters("role=player"))).toHaveLength(8);
  });

  it("registration: unfinished or done", () => {
    expect(names(filterUsers(rows, filters("registration=unfinished")))).toEqual(["Dani"]);
    expect(filterUsers(rows, filters("registration=done"))).toHaveLength(9);
  });

  it("missing data: level or phone, only for registered accounts", () => {
    expect(names(filterUsers(rows, filters("missing=level")))).toEqual(["Emese"]);
    expect(names(filterUsers(rows, filters("missing=phone")))).toEqual(["Feri"]);
  });

  it("pair and entry: no pair, not entered, entered", () => {
    // Dani never finished registering: no "Nincs párja" chip for him either.
    expect(names(filterUsers(rows, filters("pair=none")))).toEqual(["Csilla"]);
    // A pending entry counts as entered (#153 drops the approval step).
    expect(names(filterUsers(rows, filters("pair=entered")))).toEqual(["Anna", "Gabi"]);
    // Pairs in a league without a season have nothing to enter: not listed.
    expect(names(filterUsers(rows, filters("pair=notEntered")))).toEqual(["Bence"]);
  });

  it("a player with several pairs is in every group one of them fits", () => {
    const two = row("Kata", status({ pairs: [pair({ season: "Tél" }), pair({ leagueId: 2, season: "Nyár", entry: { season: "Nyár", status: "approved" } })] }));
    expect(names(filterUsers([two], filters("pair=entered")))).toEqual(["Kata"]);
    expect(names(filterUsers([two], filters("pair=notEntered")))).toEqual(["Kata"]);
    expect(filterUsers([two], filters("pair=none"))).toEqual([]);
  });

  it("an account without any status counts as not registered", () => {
    const ghost = row("Lili", undefined);
    expect(filterUsers([ghost], filters("registration=unfinished"))).toHaveLength(1);
    expect(filterUsers([ghost], filters("pair=none"))).toEqual([]);
  });
});

describe("filterUsers, combined", () => {
  it("search and a filter both apply, ignoring accents and case", () => {
    expect(names(filterUsers(rows, filters("pair=none&q=csil")))).toEqual(["Csilla"]);
    expect(filterUsers(rows, filters("pair=none&q=anna"))).toEqual([]);
    expect(names(filterUsers(rows, filters("q=jeno")))).toEqual(["Jenő"]);
  });

  it("groups combine", () => {
    expect(names(filterUsers(rows, filters("role=player&missing=phone")))).toEqual(["Feri"]);
    expect(filterUsers(rows, filters("role=admin&missing=phone"))).toEqual([]);
  });
});

describe("filterCounts", () => {
  it("counts every option over the whole list when nothing is set", () => {
    const c = filterCounts(rows, filters(""));
    expect(c.role).toEqual({ player: 8, organizer: 1, admin: 1 });
    expect(c.registration).toEqual({ unfinished: 1, done: 9 });
    expect(c.missing).toEqual({ level: 1, phone: 1 });
    expect(c.pair).toEqual({ none: 1, notEntered: 1, entered: 2 });
  });

  it("applies the other groups and the search, but not the group's own pick", () => {
    const c = filterCounts(rows, filters("role=player&registration=done"));
    // role is counted without the role pick, registration without its own.
    expect(c.role).toEqual({ player: 8 - 1, organizer: 1, admin: 1 });
    expect(c.registration).toEqual({ unfinished: 1, done: 7 });
    const q = filterCounts(rows, filters("q=ann&pair=entered"));
    expect(q.pair).toEqual({ none: 0, notEntered: 0, entered: 1 });
  });

  it("each count matches the rows the option would show", () => {
    const base = filters("role=player&q=ann");
    const counts = filterCounts(rows, base);
    for (const [value, n] of Object.entries(counts.pair)) {
      expect(filterUsers(rows, { ...base, pair: value })).toHaveLength(n);
    }
    for (const [value, n] of Object.entries(counts.missing)) {
      expect(filterUsers(rows, { ...base, missing: value })).toHaveLength(n);
    }
  });
});
