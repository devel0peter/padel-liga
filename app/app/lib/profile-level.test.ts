// The profile level lock and the Élő-pont shown (profile-level.ts, #135).
import { describe, expect, it } from "vitest";

import { LEVEL_LOCKED_ERROR, ratingFor, resolveLevel } from "./profile-level";

describe("ratingFor", () => {
  it("is the starting value of the level, for every level", () => {
    expect(ratingFor("kezdo")).toBe(1000);
    expect(ratingFor("kozephalado")).toBe(1200);
    expect(ratingFor("halado")).toBe(1400);
    expect(ratingFor("versenyzo")).toBe(1600);
  });

  it("is nothing without a known level", () => {
    expect(ratingFor(null)).toBeNull();
    expect(ratingFor(undefined)).toBeNull();
    expect(ratingFor("")).toBeNull();
    expect(ratingFor("constructor")).toBeNull();
  });

  it("is the rating from played matches once there is one, rounded (#13)", () => {
    expect(ratingFor("kezdo", 1023.6)).toBe(1024);
    expect(ratingFor("halado", 1389.4)).toBe(1389);
    expect(ratingFor(null, 1100)).toBe(1100);
    expect(ratingFor("halado", null)).toBe(1400);
  });
});

describe("resolveLevel", () => {
  it("lets a player who hasn't taken part change the level", () => {
    expect(resolveLevel({ locked: false, stored: "kezdo", submitted: "halado" })).toEqual({ ok: true, level: "halado" });
  });

  it("passes the raw value on when open, so the usual validation answers", () => {
    expect(resolveLevel({ locked: false, stored: "kezdo", submitted: null })).toEqual({ ok: true, level: null });
  });

  it("keeps the stored level when locked and the form sends none", () => {
    expect(resolveLevel({ locked: true, stored: "halado", submitted: null })).toEqual({ ok: true, level: "halado" });
    expect(resolveLevel({ locked: true, stored: "halado", submitted: "" })).toEqual({ ok: true, level: "halado" });
  });

  it("accepts the same level when locked (nothing changes)", () => {
    expect(resolveLevel({ locked: true, stored: "halado", submitted: "halado" })).toEqual({ ok: true, level: "halado" });
  });

  it("refuses another level when locked, in Hungarian", () => {
    const refused = resolveLevel({ locked: true, stored: "halado", submitted: "versenyzo" });
    expect(refused).toEqual({ ok: false, error: LEVEL_LOCKED_ERROR });
    expect(LEVEL_LOCKED_ERROR).toMatch(/nem módosíthatod/);
    expect(resolveLevel({ locked: true, stored: "halado", submitted: "nonsense" }).ok).toBe(false);
  });
});
