import { budapestTime, phaseCalendar } from "@padel-liga/rules";
import { describe, expect, it } from "vitest";

import { joiningSentence, landingBlock, landingByCity, leagueLanding, type LandingSeason } from "./landing-league";

// The first Győr season: registration 2-5 Nov, round 1 from 9 Nov, a winter
// break. Rounds: 9-29 Nov, 30 Nov - 20 Dec, 4-24 Jan, 25 Jan - 14 Feb.
function season(opens: string, closes: string, first: string, breaks: { start: string; end: string }[] = []): LandingSeason {
  return {
    registrationOpensAt: budapestTime(opens, 0, 0),
    registrationClosesAt: budapestTime(closes, 23, 59),
    phases: phaseCalendar(first, breaks).map(({ number, startsAt, deadline }) => ({ number, startsAt, deadline })),
  };
}
const FIRST = season("2026-11-02", "2026-11-05", "2026-11-09", [{ start: "2026-12-21", end: "2027-01-03" }]);
const SECOND = season("2027-02-08", "2027-02-11", "2027-02-15");

// A Budapest wall-clock time.
const at = (day: string, h = 12, m = 0) => budapestTime(day, h, m);

describe("leagueLanding", () => {
  it("before registration opens: the season's registration window", () => {
    const s = leagueLanding([FIRST], at("2026-11-01", 23, 59));
    expect(s).toEqual({
      kind: "between",
      next: { opens: "2026-11-02", closes: "2026-11-05" },
      joining: { kind: "season", opens: "2026-11-02", closes: "2026-11-05" },
    });
  });

  it("opens exactly at Budapest midnight", () => {
    expect(leagueLanding([FIRST], at("2026-11-01", 23, 59)).kind).toBe("between");
    expect(leagueLanding([FIRST], at("2026-11-02", 0, 0)).kind).toBe("registration");
  });

  it("registration open (3 Nov): the close and round 1, joining round 1", () => {
    const s = leagueLanding([FIRST], at("2026-11-03"));
    expect(s).toEqual({
      kind: "registration",
      closes: "2026-11-05",
      firstRound: "2026-11-09",
      joining: { kind: "round", number: 1, start: "2026-11-09" },
    });
    expect(landingBlock(s)).toEqual({
      title: "Nyitva a nevezés",
      facts: [
        ["Nevezés zárul", "nov. 5., csütörtök 23:59"],
        ["1. kör indul", "nov. 9., hétfő"],
      ],
      joining: "Nevezz most, és az 1. körtől játszotok (nov. 9.).",
    });
  });

  it("registration stays open through 23:59 of the last day and ends at midnight", () => {
    expect(leagueLanding([FIRST], at("2026-11-05", 23, 59)).kind).toBe("registration");
    expect(leagueLanding([FIRST], at("2026-11-06", 0, 0)).kind).toBe("starting");
  });

  it("registration over, round 1 not started (7 Nov): joining round 1", () => {
    expect(leagueLanding([FIRST], at("2026-11-07"))).toEqual({
      kind: "starting",
      firstRound: "2026-11-09",
      joining: { kind: "round", number: 1, start: "2026-11-09" },
    });
  });

  it("round 1's groups published, round 1 not started: joining round 2 (as the app does)", () => {
    const published = { ...FIRST, publishedPhases: [1] };
    // Registration over (7 Nov), and the days before it ends, before publishing.
    expect(leagueLanding([published], at("2026-11-07")).joining).toEqual({ kind: "round", number: 2, start: "2026-11-30" });
    expect(leagueLanding([published], at("2026-11-03")).joining).toEqual({ kind: "round", number: 2, start: "2026-11-30" });
    expect(landingBlock(leagueLanding([published], at("2026-11-07"))).joining).toBe(
      "Nevezz most, és a 2. körtől játszotok (nov. 30.).",
    );
    // Not published: still round 1.
    expect(leagueLanding([{ ...FIRST, publishedPhases: [] }], at("2026-11-07")).joining).toMatchObject({ number: 1 });
  });

  it("published rounds are skipped, and when none is left the joining point is the next season", () => {
    expect(leagueLanding([{ ...FIRST, publishedPhases: [1, 2] }], at("2026-11-12")).joining).toMatchObject({ number: 3 });
    const all = { ...FIRST, publishedPhases: [2, 3, 4] };
    expect(leagueLanding([all], at("2026-11-12")).joining).toEqual({ kind: "soon" });
    expect(leagueLanding([all, SECOND], at("2026-11-12")).joining).toMatchObject({ kind: "season", opens: "2027-02-08" });
  });

  it("round 1 on (12 Nov): the round and its deadline, joining round 2", () => {
    const s = leagueLanding([FIRST], at("2026-11-12"));
    expect(s.kind).toBe("running");
    expect(s).toMatchObject({ round: 1, joining: { kind: "round", number: 2, start: "2026-11-30" } });
    expect(landingBlock(s)).toEqual({
      title: "Zajlik a szezon",
      facts: [
        ["Most", "1. kör"],
        ["Határidő", "nov. 29., vasárnap 23:59"],
      ],
      joining: "Nevezz most, és a 2. körtől játszotok (nov. 30.).",
    });
  });

  it("switches rounds at Budapest midnight, not UTC midnight", () => {
    // 29 Nov 23:59 Budapest is 22:59 UTC: still round 1; a minute later round 2.
    expect(leagueLanding([FIRST], at("2026-11-29", 23, 59))).toMatchObject({ kind: "running", round: 1 });
    expect(leagueLanding([FIRST], at("2026-11-30", 0, 0))).toMatchObject({ kind: "running", round: 2 });
    // Summer time: 00:30 on the Monday is still the previous day in UTC.
    expect(leagueLanding([season("2027-03-29", "2027-03-31", "2027-04-05")], at("2027-04-05", 0, 30))).toMatchObject({
      kind: "running",
      round: 1,
    });
  });

  it("between rounds (the winter break): the next round, joining it", () => {
    const s = leagueLanding([FIRST], at("2026-12-28"));
    expect(s).toEqual({
      kind: "break",
      next: { number: 3, start: "2027-01-04" },
      joining: { kind: "round", number: 3, start: "2027-01-04" },
    });
    expect(landingBlock(s).facts).toEqual([["Következő kör", "3. kör, jan. 4., hétfő"]]);
  });

  it("last round on, no next season: joining is hamarosan", () => {
    const s = leagueLanding([FIRST], at("2027-02-01"));
    expect(s).toMatchObject({ kind: "running", round: 4, joining: { kind: "soon" } });
    expect(landingBlock(s).joining).toBe("A következő szezonra hamarosan nyílik a nevezés.");
  });

  it("last round on, next season set: joining is its registration window", () => {
    const s = leagueLanding([SECOND, FIRST], at("2027-02-01"));
    expect(s).toMatchObject({ kind: "running", round: 4, joining: { kind: "season", opens: "2027-02-08", closes: "2027-02-11" } });
    expect(landingBlock(s).joining).toBe("A következő szezonra febr. 8. – febr. 11. között lehet nevezni.");
  });

  it("a next season whose registration has closed is no joining point", () => {
    expect(leagueLanding([FIRST, SECOND], at("2027-02-12")).joining).toEqual({ kind: "soon" });
  });

  it("the season ends at midnight after its last deadline", () => {
    // The next season's registration is still ahead.
    const next = season("2027-03-01", "2027-03-04", "2027-03-08");
    expect(leagueLanding([FIRST, next], at("2027-02-14", 23, 59)).kind).toBe("running");
    const after = leagueLanding([FIRST, next], at("2027-02-15", 0, 0));
    expect(after.kind).toBe("between");
    expect(after).toMatchObject({ next: { opens: "2027-03-01", closes: "2027-03-04" } });
  });

  it("the next season takes over once its first round has started", () => {
    expect(leagueLanding([FIRST, SECOND], at("2027-02-15", 0, 0))).toMatchObject({ kind: "running", round: 1 });
  });

  it("season over, no next one: hamarosan", () => {
    const s = leagueLanding([FIRST], at("2027-03-01"));
    expect(s).toEqual({ kind: "between", next: null, joining: { kind: "soon" } });
    expect(landingBlock(s).facts).toEqual([["Nevezés", "hamarosan"]]);
  });

  it("no season at all: hamarosan", () => {
    expect(leagueLanding([], at("2026-11-03"))).toEqual({ kind: "between", next: null, joining: { kind: "soon" } });
  });

  it("moving the dates moves the page", () => {
    const moved = season("2026-11-02", "2026-11-05", "2026-11-16");
    expect(leagueLanding([moved], at("2026-11-12")).kind).toBe("starting");
    expect(leagueLanding([FIRST], at("2026-11-12")).kind).toBe("running");
  });

  it("never mentions a pair count", () => {
    const text = [FIRST, SECOND].flatMap((s) =>
      ["2026-11-01", "2026-11-03", "2026-11-07", "2026-11-12", "2026-12-28", "2027-02-01", "2027-03-01"].map((d) =>
        JSON.stringify(landingBlock(leagueLanding([s], at(d)))),
      ),
    );
    expect(text.join(" ")).not.toMatch(/12 pár|elég pár/);
  });
});

describe("joiningSentence", () => {
  it("uses the right article", () => {
    expect(joiningSentence({ kind: "round", number: 1, start: "2026-11-09" })).toContain("az 1. körtől");
    expect(joiningSentence({ kind: "round", number: 4, start: "2027-01-25" })).toContain("a 4. körtől");
  });
});

describe("landingByCity", () => {
  const now = at("2026-11-03");
  it("gives a block to each city with a league, none to others", () => {
    const m = landingByCity(
      [
        { id: 1, city: "gyor" },
        { id: 2, city: "pecs" },
      ],
      [{ ...FIRST, leagueId: 1 }],
      now,
    );
    expect([...m.keys()]).toEqual(["gyor", "pecs"]);
    expect(m.get("gyor")!.title).toBe("Nyitva a nevezés");
    expect(m.get("pecs")!.title).toBe("Következő szezon");
    expect(m.has("szeged")).toBe(false);
  });

  it("a city with two leagues shows the one that has a season", () => {
    const m = landingByCity(
      [
        { id: 1, city: "gyor" },
        { id: 2, city: "gyor" },
      ],
      [{ ...FIRST, leagueId: 2 }],
      now,
    );
    expect(m.get("gyor")!.title).toBe("Nyitva a nevezés");
  });
});
