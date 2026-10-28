import { describe, expect, it } from "vitest";

import { canDissolve, checkNewPair, NEW_PAIR_REFUSALS, SOURCE_LABELS } from "./pairs";

describe("checkNewPair (#97)", () => {
  const ok = { a: "a", b: "b", registered: true, paired: false };

  it("allows two registered players without a pair in the league", () => {
    expect(checkNewPair(ok)).toBeNull();
  });

  it("refuses the same player twice, or a missing one", () => {
    expect(checkNewPair({ ...ok, b: "a" })).toBe("same");
    expect(checkNewPair({ ...ok, b: "" })).toBe("same");
  });

  it("refuses a player who hasn't registered", () => {
    expect(checkNewPair({ ...ok, registered: false })).toBe("unknown");
  });

  it("refuses when either is already in an active pair in the league", () => {
    expect(checkNewPair({ ...ok, paired: true })).toBe("paired");
  });

  it("has a Hungarian message for every refusal", () => {
    for (const text of Object.values(NEW_PAIR_REFUSALS)) expect(text).toMatch(/[áéíóöőúüű]/);
  });
});

describe("canDissolve (#97)", () => {
  it("allows an active pair in no running group", () => {
    expect(canDissolve({ status: "active" }, false)).toBe(true);
  });

  it("refuses while the pair is in a published group before the round's deadline", () => {
    expect(canDissolve({ status: "active" }, true)).toBe(false);
  });

  it("refuses a pair already dissolved", () => {
    expect(canDissolve({ status: "dissolved" }, false)).toBe(false);
  });
});

describe("SOURCE_LABELS", () => {
  it("names both sources", () => {
    expect(SOURCE_LABELS).toEqual({ signup: "jelentkezésből", manual: "kézzel" });
  });
});
