import { describe, expect, it } from "vitest";

import { ratingExplanation } from "./rating-info";

describe("ratingExplanation (#177)", () => {
  it("has at most three sentences, with the third only before the first rated match", () => {
    expect(ratingExplanation(false)).toHaveLength(3);
    expect(ratingExplanation(true)).toHaveLength(2);
  });

  it("keeps the starting values of every level", () => {
    const text = ratingExplanation(true).join(" ");
    for (const part of ["kezdő 1000", "középhaladó 1200", "haladó 1400", "versenyző 1600"]) expect(text).toContain(part);
  });

  it("talks to one player: no second-person plural", () => {
    for (const rated of [true, false]) {
      const text = ratingExplanation(rated).join(" ");
      expect(text).not.toMatch(/győztök|kaptok|tudtok|vagytok|látjátok/);
    }
  });

  it("is one sentence per entry, ending with a full stop", () => {
    for (const s of ratingExplanation(false)) {
      expect(s.endsWith(".")).toBe(true);
      // Only the final stop: the parenthesis in the first sentence has none.
      expect(s.slice(0, -1)).not.toMatch(/[.!?]/);
    }
  });
});
