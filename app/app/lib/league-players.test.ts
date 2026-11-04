import { describe, expect, it } from "vitest";

import { inLeagueCity, signupCities } from "./league-players";

describe("a player's leagues (D73, D93)", () => {
  const cities = signupCities([
    { email1: "Gabi@x.hu", email2: null, city: "gyor" },
    { email1: "deb@x.hu", email2: "Partner@x.hu", city: "deb" },
    { email1: "both@x.hu", email2: null, city: "gyor" },
    { email1: "both@x.hu", email2: null, city: "deb" },
    { email1: "far@x.hu", email2: null, city: "other" },
  ]);

  it("without a signup: every league", () => {
    expect(inLeagueCity(cities, "new@x.hu", "gyor")).toBe(true);
    expect(inLeagueCity(cities, "new@x.hu", "deb")).toBe(true);
  });

  it("with a signup: only its city's leagues, whatever the address's case", () => {
    expect(inLeagueCity(cities, "gabi@x.hu", "gyor")).toBe(true);
    expect(inLeagueCity(cities, "GABI@x.hu", "gyor")).toBe(true);
    expect(inLeagueCity(cities, "gabi@x.hu", "deb")).toBe(false);
  });

  it("a pair signup's partner (email2) belongs to its city too", () => {
    expect(inLeagueCity(cities, "partner@x.hu", "deb")).toBe(true);
    expect(inLeagueCity(cities, "partner@x.hu", "gyor")).toBe(false);
  });

  it("signups in two cities: both cities' leagues", () => {
    expect(inLeagueCity(cities, "both@x.hu", "gyor")).toBe(true);
    expect(inLeagueCity(cities, "both@x.hu", "deb")).toBe(true);
  });

  it("signups only in a city without a league: none", () => {
    expect(inLeagueCity(cities, "far@x.hu", "gyor")).toBe(false);
    expect(inLeagueCity(cities, "far@x.hu", "deb")).toBe(false);
  });
});
