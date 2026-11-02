// The status chips of the admin tables (player-status.ts).
import { describe, expect, it } from "vitest";

import { accountChip, entryChip, missingChips, pairChips, statusChips, type PlayerStatus } from "./player-status";

const pair = (leagueId: number, partner: string, extra: Partial<PlayerStatus["pairs"][number]> = {}) => ({
  leagueId,
  league: `Liga ${leagueId}`,
  city: "gyor",
  partner,
  entry: null,
  season: null,
  ...extra,
});
const player = (extra: Partial<PlayerStatus> = {}): PlayerStatus => ({
  registered: true,
  level: "halado",
  phone: true,
  pairs: [],
  ...extra,
});
const texts = (chips: { text: string }[]) => chips.map((c) => c.text);

describe("accountChip", () => {
  it("tells no account, an unfinished first login and a registered player apart", () => {
    expect(accountChip(undefined)).toEqual({ text: "Nincs fiókja", tone: "muted" });
    expect(accountChip(player({ registered: false }))).toEqual({ text: "Félbehagyta a regisztrációt", tone: "todo" });
    expect(accountChip(player())).toEqual({ text: "Regisztrált", tone: "ok" });
  });
});

describe("missingChips", () => {
  it("flags a missing level or phone number, only for a registered player", () => {
    expect(missingChips(player())).toEqual([]);
    expect(texts(missingChips(player({ level: null, phone: false })))).toEqual(["Nincs szintje", "Nincs telefonszáma"]);
    expect(missingChips(player({ registered: false, level: null, phone: false }))).toEqual([]);
    expect(missingChips(undefined)).toEqual([]);
  });
});

describe("entryChip", () => {
  it("shows the entry's season and status", () => {
    expect(entryChip({ entry: { season: "Tél", status: "pending" }, season: "Tél" })).toEqual({
      text: "Nevezés (Tél): Függőben",
      tone: "todo",
    });
    expect(entryChip({ entry: { season: "Tél", status: "approved" }, season: "Tél" })?.tone).toBe("ok");
    expect(entryChip({ entry: { season: "Tél", status: "rejected" }, season: "Tél" })).toEqual({
      text: "Nevezés (Tél): Elutasítva",
      tone: "muted",
    });
    expect(entryChip({ entry: { season: "Tél", status: "withdrawn" }, season: "Tél" })?.text).toBe("Nevezés (Tél): Visszavonva");
  });

  it("says not entered only while the league has a current or next season", () => {
    expect(entryChip({ entry: null, season: "Tél" })).toEqual({ text: "Nem nevezett (Tél)", tone: "todo" });
    expect(entryChip({ entry: null, season: null })).toBeNull();
  });
});

describe("pairChips", () => {
  it("shows the partner and the entry, or no pair for a registered player", () => {
    expect(texts(pairChips(player({ pairs: [pair(1, "Béla", { season: "Tél" })] })))).toEqual(["Pár: Béla", "Nem nevezett (Tél)"]);
    expect(pairChips(player())).toEqual([{ text: "Nincs párja", tone: "todo" }]);
    expect(pairChips(player({ registered: false }))).toEqual([]);
    expect(pairChips(undefined)).toEqual([]);
  });

  it("keeps the given leagues only, with their name when asked", () => {
    const st = player({ pairs: [pair(1, "Béla"), pair(2, "Cecil")] });
    expect(texts(pairChips(st, [2]))).toEqual(["Pár: Cecil"]);
    expect(texts(pairChips(st, [3]))).toEqual(["Nincs párja"]);
    expect(texts(pairChips(st, undefined, true))).toEqual(["Liga 1: Pár: Béla", "Liga 2: Pár: Cecil"]);
  });

  it("says nothing about pairs in a city without a league", () => {
    expect(pairChips(player(), [])).toEqual([]);
  });
});

describe("statusChips", () => {
  it("puts account, missing data and pairs in that order", () => {
    expect(texts(statusChips(player({ phone: false, pairs: [pair(1, "Béla")] })))).toEqual([
      "Regisztrált",
      "Nincs telefonszáma",
      "Pár: Béla",
    ]);
    expect(texts(statusChips(undefined))).toEqual(["Nincs fiókja"]);
  });
});
