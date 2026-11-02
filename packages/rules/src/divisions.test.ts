import { describe, expect, it } from "vitest";

import { divisionOf, divisionSizes } from "./divisions";

describe("divisionSizes (spec 4)", () => {
  it("splits evenly when divisible by 3: 15 = 5+5+5", () => {
    expect(divisionSizes(15)).toEqual({ bronz: 5, rez: 5, rookie: 5 });
  });

  it("a remainder of 1 goes to Réz: 16 = 5+6+5", () => {
    expect(divisionSizes(16)).toEqual({ bronz: 5, rez: 6, rookie: 5 });
  });

  it("a remainder of 2 goes to Réz and Rookie: 17 = 5+6+6", () => {
    expect(divisionSizes(17)).toEqual({ bronz: 5, rez: 6, rookie: 6 });
  });

  it("fewer than 3 groups fill top-down", () => {
    expect(divisionSizes(0)).toEqual({ bronz: 0, rez: 0, rookie: 0 });
    expect(divisionSizes(1)).toEqual({ bronz: 1, rez: 0, rookie: 0 });
    expect(divisionSizes(2)).toEqual({ bronz: 1, rez: 1, rookie: 0 });
  });

  it("3, 4 and 5 groups", () => {
    expect(divisionSizes(3)).toEqual({ bronz: 1, rez: 1, rookie: 1 });
    expect(divisionSizes(4)).toEqual({ bronz: 1, rez: 2, rookie: 1 });
    expect(divisionSizes(5)).toEqual({ bronz: 1, rez: 2, rookie: 2 });
  });

  it("refuses a negative or fractional count", () => {
    expect(() => divisionSizes(-1)).toThrow();
    expect(() => divisionSizes(1.5)).toThrow();
  });
});

describe("divisionOf (spec 4)", () => {
  it("with 15 groups: 1–5 Bronz, 6–10 Réz, 11–15 Rookie", () => {
    const all = Array.from({ length: 15 }, (_, i) => divisionOf(i + 1, 15));
    expect(all).toEqual([...Array(5).fill("bronz"), ...Array(5).fill("rez"), ...Array(5).fill("rookie")]);
  });

  it("with 16 groups Réz is 6–11", () => {
    expect([5, 6, 11, 12].map((n) => divisionOf(n, 16))).toEqual(["bronz", "rez", "rez", "rookie"]);
  });

  it("with 2 groups: Bronz and Réz, no Rookie", () => {
    expect([divisionOf(1, 2), divisionOf(2, 2)]).toEqual(["bronz", "rez"]);
  });

  it("a single group is Bronz", () => {
    expect(divisionOf(1, 1)).toBe("bronz");
  });

  it("refuses a group outside the count", () => {
    expect(() => divisionOf(0, 3)).toThrow();
    expect(() => divisionOf(4, 3)).toThrow();
  });
});
