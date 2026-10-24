import { describe, expect, it } from "vitest";
import { isLevel, pairElo, STARTING_ELO, startingElo } from "./elo";

describe("startingElo (spec 11)", () => {
  it("starts from the self-assessed level", () => {
    expect(startingElo("kezdo")).toBe(1000);
    expect(startingElo("kozephalado")).toBe(1200);
    expect(startingElo("halado")).toBe(1400);
    expect(startingElo("versenyzo")).toBe(1600);
  });

  it("knows exactly the four signup levels", () => {
    expect(Object.keys(STARTING_ELO).sort()).toEqual(["halado", "kezdo", "kozephalado", "versenyzo"]);
    expect(isLevel("halado")).toBe(true);
    expect(isLevel("profi")).toBe(false);
    expect(isLevel("toString")).toBe(false);
  });
});

describe("pairElo (spec 11)", () => {
  it("is the average of the two players", () => {
    expect(pairElo(1000, 1200)).toBe(1100);
    expect(pairElo(1400, 1400)).toBe(1400);
    expect(pairElo(1000, 1601)).toBe(1300.5);
  });

  it("doesn't depend on the order of the players", () => {
    expect(pairElo(1600, 1000)).toBe(pairElo(1000, 1600));
  });
});
