import { describe, expect, it } from "vitest";

import { isSeeking } from "./partner-search";

describe("Párt keresek (D59, #333)", () => {
  it("is what the player set, and off until they switch it on", () => {
    expect(isSeeking(undefined)).toBe(false);
    expect(isSeeking(true)).toBe(true);
    expect(isSeeking(false)).toBe(false);
  });
});
