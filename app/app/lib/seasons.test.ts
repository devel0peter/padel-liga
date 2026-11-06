import { describe, expect, it } from "vitest";

import { currentSeason, homeSeasons, parseSeason, previewPhases, registrationWindow, seasonActions, seasonEnd, type Season } from "./seasons";

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
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(["breaks"]);
  });

  it("refuses days outside 2020–2100 instead of failing (a date input takes year 9999)", () => {
    for (const fields of [
      { firstPhaseStart: "9999-12-27" },
      { registrationOpens: "1999-11-01" },
      { registrationCloses: "2101-01-01" },
      { breakStart: ["2026-11-01"], breakEnd: ["9999-12-31"] },
    ]) {
      const r = parseSeason(form({ ...FIRST_SEASON, ...fields }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(Object.values(r.errors)).toContain("Adj meg egy 2020 és 2100 közötti dátumot.");
    }
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

  it("doesn't throw while a date is half typed or far out of range", () => {
    expect(previewPhases("9999-12-27", [])).toBeNull();
    expect(previewPhases("2026-11-09", [{ start: "2026-11-01", end: "9999-12-31" }])?.[0]?.start).toBe("2026-11-09");
  });
});

describe("seasonActions (decision log, 2026-10-23)", () => {
  it("is editable until the phase 1 groups are published", () => {
    expect(seasonActions({ groupsPublished: false, entries: 5 }).canEdit).toBe(true);
    expect(seasonActions({ groupsPublished: true, entries: 5 }).canEdit).toBe(false);
  });

  it("is deletable only while nobody has entered", () => {
    expect(seasonActions({ groupsPublished: false, entries: 0 }).canDelete).toBe(true);
    expect(seasonActions({ groupsPublished: false, entries: 1 }).canDelete).toBe(false);
  });

  it("is not deletable once the groups are published, even if every entry was withdrawn (#24)", () => {
    expect(seasonActions({ groupsPublished: true, entries: 0 }).canDelete).toBe(false);
  });
});

const season = (id: number, leagueId: number, firstPhaseStart: string, registrationClosesAt = new Date(0)): Season => {
  const r = parseSeason(form({ ...FIRST_SEASON, registrationOpens: "2020-01-01", registrationCloses: "2020-01-02", firstPhaseStart }));
  if (!r.ok) throw new Error("bad fixture");
  return {
    id,
    leagueId,
    name: `S${id}`,
    registrationOpensAt: new Date(0),
    registrationClosesAt,
    firstPhaseStart,
    breaks: [],
    phases: r.phases.map(({ number, startsAt, deadline }) => ({ number, startsAt, deadline })),
  };
};

describe("seasonEnd and homeSeasons", () => {
  const first = season(1, 1, "2026-11-09"); // ends 14 Feb 2027
  const next = season(2, 1, "2027-03-01"); // registration closed long ago
  const other = season(3, 2, "2027-03-01");

  it("the season ends at the last phase's deadline", () => {
    expect(seasonEnd(first)?.toISOString()).toBe("2027-02-14T22:59:00.000Z");
    expect(seasonEnd({ phases: [] })).toBeNull();
  });

  it("shows the earliest season that hasn't ended, per league", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    expect(homeSeasons([next, first, other], now).map((s) => s.id)).toEqual([1, 3]);
  });

  it("also shows a later season while its registration is open or ahead", () => {
    const reopening = season(4, 1, "2027-03-01", new Date("2027-02-20T22:59:00Z"));
    const during = new Date("2027-02-01T12:00:00Z"); // first season's last phase
    expect(homeSeasons([reopening, first], during).map((s) => s.id)).toEqual([1, 4]);
    // A later season whose registration has closed waits its turn.
    expect(homeSeasons([next, first], during).map((s) => s.id)).toEqual([1]);
  });

  it("moves on once the season's last deadline has passed", () => {
    expect(homeSeasons([first, next], new Date("2027-02-14T22:58:00Z")).map((s) => s.id)).toEqual([1]);
    expect(homeSeasons([first, next], new Date("2027-02-14T23:00:00Z")).map((s) => s.id)).toEqual([2]);
  });

  it("shows nothing when every season is over", () => {
    expect(homeSeasons([first], new Date("2028-01-01T00:00:00Z"))).toEqual([]);
  });
});

// The public table's season and the strikes on Párok (#294: strikes reset
// each season, so the next season shows none of the last one's).
describe("currentSeason", () => {
  const first = season(1, 1, "2026-11-09"); // ends 14 Feb 2027
  const next = season(2, 1, "2027-03-01");

  it("the earliest season that hasn't ended; once it has, the next one, even before it starts", () => {
    expect(currentSeason([next, first], new Date("2027-01-10T12:00:00Z"))?.id).toBe(1);
    expect(currentSeason([next, first], new Date("2027-02-20T12:00:00Z"))?.id).toBe(2);
  });

  it("the latest once every season is over, and none without seasons", () => {
    expect(currentSeason([next, first], new Date("2028-01-01T00:00:00Z"))?.id).toBe(2);
    expect(currentSeason([], new Date())).toBeUndefined();
  });
});
