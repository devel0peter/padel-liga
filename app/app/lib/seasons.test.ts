import { describe, expect, it } from "vitest";

import { currentSeasons, parseSeason, previewPhases, registrationWindow, seasonActions, seasonEnd, type Season } from "./seasons";

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
  return f;
};

const FIRST_SEASON = {
  name: " 2026/27   tél ",
  registrationOpens: "2026-11-02",
  registrationCloses: "2026-11-05",
  firstPhaseStart: "2026-11-09",
  breakStart: ["2026-12-21"],
  breakEnd: ["2027-01-03"],
};

describe("parseSeason", () => {
  it("accepts the first season and computes its 4 phases", () => {
    const r = parseSeason(form(FIRST_SEASON));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({
      name: "2026/27 tél",
      registrationOpens: "2026-11-02",
      registrationCloses: "2026-11-05",
      firstPhaseStart: "2026-11-09",
      breaks: [{ start: "2026-12-21", end: "2027-01-03" }],
    });
    expect(r.phases.map((p) => [p.start, p.end])).toEqual([
      ["2026-11-09", "2026-11-29"],
      ["2026-11-30", "2026-12-20"],
      ["2027-01-04", "2027-01-24"],
      ["2027-01-25", "2027-02-14"],
    ]);
  });

  it("refuses a first phase start that isn't a Monday", () => {
    const r = parseSeason(form({ ...FIRST_SEASON, firstPhaseStart: "2026-11-10" }));
    expect(r).toEqual({ ok: false, errors: { firstPhaseStart: "Az első kör csak hétfőn kezdődhet." } });
  });

  it("requires the name and every day", () => {
    const r = parseSeason(form({ name: "", registrationOpens: "", registrationCloses: "", firstPhaseStart: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["firstPhaseStart", "name", "registrationCloses", "registrationOpens"]);
  });

  it("refuses a too long name", () => {
    const r = parseSeason(form({ ...FIRST_SEASON, name: "x".repeat(61) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(["name"]);
  });

  it("refuses registration closing before it opens", () => {
    const r = parseSeason(form({ ...FIRST_SEASON, registrationCloses: "2026-11-01" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(["registrationCloses"]);
  });

  it("accepts registration opening and closing on the same day", () => {
    expect(parseSeason(form({ ...FIRST_SEASON, registrationOpens: "2026-11-05" })).ok).toBe(true);
  });

  it("refuses registration that doesn't close before the first phase starts", () => {
    for (const closes of ["2026-11-09", "2026-11-20"]) {
      const r = parseSeason(form({ ...FIRST_SEASON, registrationCloses: closes }));
      expect(r).toEqual({ ok: false, errors: { registrationCloses: "A nevezésnek az első kör előtt kell zárulnia." } });
    }
    // The Sunday before is fine: 23:59 is before Monday 00:00.
    expect(parseSeason(form({ ...FIRST_SEASON, registrationCloses: "2026-11-08" })).ok).toBe(true);
  });

  it("checks registration against phase 1 as moved by a break", () => {
    // A break over 9–10 Nov moves phase 1 to 16 Nov, so closing on 12 Nov is fine.
    const r = parseSeason(form({ ...FIRST_SEASON, registrationCloses: "2026-11-12", breakStart: ["2026-11-09"], breakEnd: ["2026-11-10"] }));
    expect(r.ok && r.phases[0]?.start).toBe("2026-11-16");
  });

  it("ignores empty break rows and sorts the breaks", () => {
    const r = parseSeason(
      form({ ...FIRST_SEASON, breakStart: ["2027-01-06", "", "2026-12-21"], breakEnd: ["2027-01-07", "", "2027-01-03"] }),
    );
    expect(r.ok && r.data.breaks).toEqual([
      { start: "2026-12-21", end: "2027-01-03" },
      { start: "2027-01-06", end: "2027-01-07" },
    ]);
  });

  it("accepts a season without breaks", () => {
    const { breakStart: _s, breakEnd: _e, ...noBreaks } = FIRST_SEASON;
    const r = parseSeason(form(noBreaks));
    expect(r.ok && r.data.breaks).toEqual([]);
  });

  it("refuses a half-filled break and one that ends before it starts", () => {
    for (const [s, e] of [["2026-12-21", ""], ["", "2027-01-03"], ["2027-01-03", "2026-12-21"]]) {
      const r = parseSeason(form({ ...FIRST_SEASON, breakStart: [s!], breakEnd: [e!] }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(Object.keys(r.errors)).toEqual(["breaks"]);
    }
  });

  it("refuses more than 10 breaks", () => {
    const days = Array.from({ length: 11 }, (_, i) => `2027-03-${String(i + 1).padStart(2, "0")}`);
    const r = parseSeason(form({ ...FIRST_SEASON, breakStart: days, breakEnd: days }));
    expect(r.ok).toBe(false);
  });
});

describe("registrationWindow", () => {
  it("runs from 00:00 of the first day to 23:59 of the last, Budapest", () => {
    const w = registrationWindow({ registrationOpens: "2026-11-02", registrationCloses: "2026-11-05" });
    expect(w.opensAt.toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-11-05T22:59:00.000Z");
  });
});

describe("previewPhases", () => {
  it("shows the phases once the start is a Monday, skipping unfinished break rows", () => {
    const p = previewPhases("2026-11-09", [
      { start: "2026-12-21", end: "2027-01-03" },
      { start: "2027-01-10", end: "" },
    ]);
    expect(p?.map((x) => x.start)).toEqual(["2026-11-09", "2026-11-30", "2027-01-04", "2027-01-25"]);
  });

  it("shows nothing without a Monday", () => {
    expect(previewPhases("", [])).toBeNull();
    expect(previewPhases("2026-11-10", [])).toBeNull();
  });
});

describe("seasonActions (README decision log, 2026-10-23)", () => {
  it("is editable until the phase 1 groups are published", () => {
    expect(seasonActions({ groupsPublished: false, entries: 5 }).canEdit).toBe(true);
    expect(seasonActions({ groupsPublished: true, entries: 5 }).canEdit).toBe(false);
  });

  it("is deletable only while nobody has entered", () => {
    expect(seasonActions({ groupsPublished: false, entries: 0 }).canDelete).toBe(true);
    expect(seasonActions({ groupsPublished: false, entries: 1 }).canDelete).toBe(false);
  });
});

const season = (id: number, leagueId: number, firstPhaseStart: string): Season => {
  const r = parseSeason(form({ ...FIRST_SEASON, registrationOpens: "2020-01-01", registrationCloses: "2020-01-02", firstPhaseStart }));
  if (!r.ok) throw new Error("bad fixture");
  return {
    id,
    leagueId,
    name: `S${id}`,
    registrationOpensAt: new Date(0),
    registrationClosesAt: new Date(0),
    firstPhaseStart,
    breaks: [],
    phases: r.phases.map(({ number, startsAt, deadline }) => ({ number, startsAt, deadline })),
  };
};

describe("seasonEnd and currentSeasons", () => {
  const first = season(1, 1, "2026-11-09"); // ends 14 Feb 2027
  const next = season(2, 1, "2027-03-01");
  const other = season(3, 2, "2027-03-01");

  it("the season ends at the last phase's deadline", () => {
    expect(seasonEnd(first)?.toISOString()).toBe("2027-02-14T22:59:00.000Z");
    expect(seasonEnd({ phases: [] })).toBeNull();
  });

  it("shows the earliest season that hasn't ended, one per league", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    expect(currentSeasons([next, first, other], now).map((s) => s.id)).toEqual([1, 3]);
  });

  it("moves on once the season's last deadline has passed", () => {
    expect(currentSeasons([first, next], new Date("2027-02-14T22:58:00Z")).map((s) => s.id)).toEqual([1]);
    expect(currentSeasons([first, next], new Date("2027-02-14T23:00:00Z")).map((s) => s.id)).toEqual([2]);
  });

  it("shows nothing when every season is over", () => {
    expect(currentSeasons([first], new Date("2028-01-01T00:00:00Z"))).toEqual([]);
  });
});
