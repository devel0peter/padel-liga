import { describe, expect, it } from "vitest";

import { joinableLeagues, leagueOfReturnTo, parseLeagueParam, withLeague } from "./league-members";

describe("the register button's league in the address (D127, #331)", () => {
  it("takes only a slug-shaped value", () => {
    expect(parseLeagueParam("gyor")).toBe("gyor");
    expect(parseLeagueParam("padelparbaj-gyor-2")).toBe("padelparbaj-gyor-2");
    for (const bad of [null, undefined, "", "Gyor", "-gyor", "gy or", "gyor/../x", "a".repeat(65)]) expect(parseLeagueParam(bad)).toBeNull();
  });

  it("rides in returnTo and comes back out of it", () => {
    expect(withLeague("/home", "gyor")).toBe("/home?league=gyor");
    expect(withLeague("/pair?joined=1", "gyor")).toBe("/pair?joined=1&league=gyor");
    expect(withLeague("/home?league=old", "gyor")).toBe("/home?league=gyor");
    expect(leagueOfReturnTo("/home?league=gyor")).toBe("gyor");
    expect(leagueOfReturnTo("/welcome?returnTo=x")).toBeNull();
    expect(leagueOfReturnTo("/home?league=Bad%20One")).toBeNull();
    expect(leagueOfReturnTo("/home")).toBeNull();
  });
});

describe("Melyik ligában játszol? (#331)", () => {
  const day = (iso: string) => new Date(iso);
  const phases = (first: string, last: string) => [
    { number: 1, startsAt: day(first), deadline: day(first) },
    { number: 4, startsAt: day(last), deadline: day(last) },
  ];
  const leagues = [
    { id: 1, city: "gyor", cityName: "Győr", name: "Padelpárbaj Győr" },
    { id: 2, city: "mmo", cityName: "Mosonmagyaróvár", name: "Padelpárbaj Óvár" },
    { id: 3, city: "deb", cityName: "Debrecen", name: "Padelpárbaj Debrecen" },
    { id: 4, city: "pecs", cityName: "Pécs", name: "Padelpárbaj Pécs" },
  ];
  const seasons = [
    // Running.
    { leagueId: 1, registrationOpensAt: day("2026-11-01T00:00:00Z"), phases: phases("2026-11-09T00:00:00Z", "2027-01-25T00:00:00Z") },
    // Open for entries, not started.
    { leagueId: 2, registrationOpensAt: day("2026-11-05T00:00:00Z"), phases: phases("2026-12-07T00:00:00Z", "2027-02-22T00:00:00Z") },
    // Registration not open yet.
    { leagueId: 3, registrationOpensAt: day("2026-12-01T00:00:00Z"), phases: phases("2027-01-04T00:00:00Z", "2027-03-22T00:00:00Z") },
    // Over.
    { leagueId: 4, registrationOpensAt: day("2026-01-01T00:00:00Z"), phases: phases("2026-02-01T00:00:00Z", "2026-04-01T00:00:00Z") },
  ];

  it("offers the leagues with a season open for entries or running, by city", () => {
    expect(joinableLeagues(leagues, seasons, day("2026-11-07T12:00:00Z")).map((l) => l.id)).toEqual([1, 2]);
  });

  it("with one such league, that one; with none, nothing", () => {
    expect(joinableLeagues(leagues, seasons.slice(0, 1), day("2026-11-07T12:00:00Z")).map((l) => l.id)).toEqual([1]);
    expect(joinableLeagues(leagues, [], day("2026-11-07T12:00:00Z"))).toEqual([]);
  });
});
