import { describe, expect, it } from "vitest";

import { finderEntries, finderPath, isSeeking, lookingText, searchState, type FinderRow } from "./partner-search";

describe("Párt keresek (D59, #333)", () => {
  it("is what the player set, and off until they switch it on", () => {
    expect(isSeeking(undefined)).toBe(false);
    expect(isSeeking(true)).toBe(true);
    expect(isSeeking(false)).toBe(false);
  });

  it("is listed only when switched on under the Párkereső wording (#398, D177)", () => {
    expect(searchState(undefined)).toEqual({ seeking: false, listed: false });
    expect(searchState({ seeking: true, listed: false })).toEqual({ seeking: true, listed: false });
    expect(searchState({ seeking: true, listed: true })).toEqual({ seeking: true, listed: true });
    // Off is never listed, whatever the row says.
    expect(searchState({ seeking: false, listed: true })).toEqual({ seeking: false, listed: false });
  });
});

describe("Párkereső (#398)", () => {
  const NOW = new Date("2026-11-24T12:00:00Z");
  const row = (id: string, since: string, more: Partial<FinderRow> = {}): FinderRow => ({
    id,
    name: id.toUpperCase(),
    level: "kezdo",
    elo: null,
    since: new Date(since),
    phone: "+36 30 123 4567",
    email: `${id}@x.hu`,
    ...more,
  });
  const ROWS = [row("a", "2026-11-20T10:00:00Z"), row("b", "2026-11-24T08:00:00Z", { elo: 1199.5, level: "halado" }), row("me", "2026-11-22T10:00:00Z")];

  it("lists the others, newest first, never the viewer", () => {
    expect(finderEntries(ROWS, { id: "me", listed: true }, NOW).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("shows phone and email only to a listed viewer: contact is mutual", () => {
    expect(finderEntries(ROWS, { id: "me", listed: true }, NOW)[0].contact).toEqual({ phone: "+36 30 123 4567", email: "b@x.hu" });
    const locked = finderEntries(ROWS, { id: "me", listed: false }, NOW);
    expect(locked.map((e) => e.contact)).toEqual([null, null]);
    expect(JSON.stringify(locked)).not.toMatch(/@|\+36/);
  });

  it("names the level, rounds the Élő-pont and leaves it out before a rated match", () => {
    const [b, a] = finderEntries(ROWS, { id: "me", listed: false }, NOW);
    expect([b.level, b.elo]).toEqual(["Haladó", 1200]);
    expect([a.level, a.elo]).toEqual(["Kezdő", null]);
    expect(finderEntries([row("x", "2026-11-24T08:00:00Z", { level: null, name: "" })], { id: "me", listed: false }, NOW)[0]).toMatchObject({
      name: "Névtelen",
      level: "",
    });
  });

  it("says how long they have been looking, in Budapest days", () => {
    expect(lookingText(new Date("2026-11-24T08:00:00Z"), NOW)).toBe("ma óta keres");
    // 23:30 UTC on the 23rd is already the 24th in Budapest.
    expect(lookingText(new Date("2026-11-23T23:30:00Z"), NOW)).toBe("ma óta keres");
    expect(lookingText(new Date("2026-11-23T22:30:00Z"), NOW)).toBe("tegnap óta keres");
    expect(lookingText(new Date("2026-11-20T10:00:00Z"), NOW)).toBe("4 napja keres");
    // A clock a bit ahead never gives a negative count.
    expect(lookingText(new Date("2026-11-25T10:00:00Z"), NOW)).toBe("ma óta keres");
  });

  it("links the league's Párkereső on its Ligáim card", () => {
    expect(finderPath("gyor")).toBe("/leagues/gyor#parkereso");
    expect(finderPath(undefined)).toBeUndefined();
  });
});
