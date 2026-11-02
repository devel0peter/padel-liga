import { describe, expect, it } from "vitest";
import { DIVISIONS, divisionOfGroup, divisionSizes } from "./divisions";

const sizes = (n: number) => {
  const s = divisionSizes(n);
  return [s.bronz, s.rez, s.rookie];
};

describe("divisionSizes (spec 4: floor(n / 3) each, the remainder to Réz, then Rookie)", () => {
  it("splits evenly when the group count divides by 3", () => {
    expect(sizes(3)).toEqual([1, 1, 1]);
    expect(sizes(6)).toEqual([2, 2, 2]);
    expect(sizes(15)).toEqual([5, 5, 5]);
  });

  it("gives a remainder of 1 to Réz", () => {
    expect(sizes(4)).toEqual([1, 2, 1]);
    expect(sizes(16)).toEqual([5, 6, 5]);
  });

  it("gives a remainder of 2 to Réz and Rookie", () => {
    expect(sizes(5)).toEqual([1, 2, 2]);
    expect(sizes(17)).toEqual([5, 6, 6]);
  });

  it("fills top-down with fewer than 3 groups: 1 = Bronz, 2 = Bronz and Réz", () => {
    expect(sizes(0)).toEqual([0, 0, 0]);
    expect(sizes(1)).toEqual([1, 0, 0]);
    expect(sizes(2)).toEqual([1, 1, 0]);
  });

  it("always adds up to the number of groups", () => {
    for (let n = 0; n <= 40; n++) expect(sizes(n).reduce((a, b) => a + b, 0)).toBe(n);
  });

  it("rejects a count that isn't a whole number of 0 or more", () => {
    expect(() => divisionSizes(-1)).toThrow();
    expect(() => divisionSizes(2.5)).toThrow();
    expect(() => divisionSizes(Number.NaN)).toThrow();
  });
});

describe("divisionOfGroup", () => {
  const ladder = (n: number) => Array.from({ length: n }, (_, i) => divisionOfGroup(i, n));

  it("with 5 groups the bands are Bronz 1, Réz 2, Rookie 2 (#30)", () => {
    expect(ladder(5)).toEqual(["bronz", "rez", "rez", "rookie", "rookie"]);
  });

  it("with 15 groups the borders fall after the 5th and the 10th", () => {
    const l = ladder(15);
    expect(l.slice(0, 5).every((d) => d === "bronz")).toBe(true);
    expect(l.slice(5, 10).every((d) => d === "rez")).toBe(true);
    expect(l.slice(10).every((d) => d === "rookie")).toBe(true);
  });

  it("puts a single group in Bronz and two groups in Bronz and Réz", () => {
    expect(ladder(1)).toEqual(["bronz"]);
    expect(ladder(2)).toEqual(["bronz", "rez"]);
  });

  it("never goes up again as the index grows (one ladder)", () => {
    for (let n = 1; n <= 25; n++) {
      const order = ladder(n).map((d) => DIVISIONS.indexOf(d));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it("rejects a group that isn't in the ladder", () => {
    expect(() => divisionOfGroup(-1, 5)).toThrow();
    expect(() => divisionOfGroup(5, 5)).toThrow();
  });
});
