import { describe, expect, it } from "vitest";

import { fold, matchesSearch } from "./search";

describe("admin search", () => {
  it("ignores case and accents, including an accented capital", () => {
    expect(fold("Ákos Őry")).toBe("akos ory");
    expect(matchesSearch("ákos", ["Ákos"])).toBe(true);
    expect(matchesSearch("ÁKOS", ["ákos"])).toBe(true);
    expect(matchesSearch("új", ["Új Játékos"])).toBe(true);
    expect(matchesSearch("kovacs", ["Kovács Béla"])).toBe(true);
    expect(matchesSearch("Kovács", ["kovacs@x.hu"])).toBe(true);
  });

  it("matches any value, skips empty ones, and an empty term matches all", () => {
    expect(matchesSearch("x.hu", [null, "Anna", "anna@x.hu"])).toBe(true);
    expect(matchesSearch("béla", [null, undefined, "Anna"])).toBe(false);
    expect(matchesSearch("  ", [])).toBe(true);
  });
});
