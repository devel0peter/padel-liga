import { describe, expect, it } from "vitest";

import {
  averageStartingElo,
  checkEntry,
  ENTRY_REFUSALS,
  entryOpen,
  entryStatusText,
  TAKEN_OUT_TEXT,
  WITHDRAWAL_REASON_MAX,
  withdrawalReasonError,
  ENTRY_STATUS_LABELS,
  entryView,
  fromPhase,
  joinsPhase,
  lateEntry,
  organizerEntryAction,
} from "./season-entries";

// The first season (README decision log 2026-10-21): registration 2–5 Nov,
// phases from 9 Nov, a break over Christmas. Budapest is UTC+1 in winter.
const at = (iso: string) => new Date(iso);
const season = {
  registrationOpensAt: at("2026-11-01T23:00:00Z"), // 2 Nov 00:00
  registrationClosesAt: at("2026-11-05T22:59:00Z"), // 5 Nov 23:59
  phases: [
    { number: 1, startsAt: at("2026-11-08T23:00:00Z"), deadline: at("2026-11-29T22:59:00Z") },
    { number: 2, startsAt: at("2026-11-29T23:00:00Z"), deadline: at("2026-12-20T22:59:00Z") },
    { number: 3, startsAt: at("2027-01-03T23:00:00Z"), deadline: at("2027-01-24T22:59:00Z") },
    { number: 4, startsAt: at("2027-01-24T23:00:00Z"), deadline: at("2027-02-14T22:59:00Z") },
  ],
};

describe("entryOpen (D18)", () => {
  it("opens with registration", () => {
    expect(entryOpen(season, at("2026-11-01T22:59:59Z"))).toBe(false);
    expect(entryOpen(season, at("2026-11-01T23:00:00Z"))).toBe(true);
  });

  it("stays open after registration closes, until the last phase starts", () => {
    expect(entryOpen(season, at("2026-11-10T12:00:00Z"))).toBe(true);
    expect(entryOpen(season, at("2027-01-24T22:59:59Z"))).toBe(true);
    expect(entryOpen(season, at("2027-01-24T23:00:00Z"))).toBe(false);
  });

  it("is closed for a season without phases", () => {
    expect(entryOpen({ ...season, phases: [] }, at("2026-11-03T12:00:00Z"))).toBe(false);
  });

  it("knows a late entry: once phase 1 has started, not between registration and phase 1", () => {
    expect(lateEntry(season, at("2026-11-06T12:00:00Z"))).toBe(false);
    expect(lateEntry(season, at("2026-11-08T22:59:59Z"))).toBe(false);
    expect(lateEntry(season, at("2026-11-08T23:00:00Z"))).toBe(true);
  });
});

describe("joinsPhase (D18, spec section 4)", () => {
  it("is phase 1 when approved before the season starts", () => {
    expect(joinsPhase(season.phases, at("2026-11-03T12:00:00Z"))).toBe(1);
    expect(joinsPhase(season.phases, at("2026-11-08T22:59:59Z"))).toBe(1);
  });

  it("is the next phase once a phase has started", () => {
    expect(joinsPhase(season.phases, at("2026-11-08T23:00:00Z"))).toBe(2);
    expect(joinsPhase(season.phases, at("2026-12-01T12:00:00Z"))).toBe(3);
    // In the Christmas break: phase 3 hasn't started yet.
    expect(joinsPhase(season.phases, at("2026-12-28T12:00:00Z"))).toBe(3);
  });

  it("is none during the last phase: the pair moves into the next season", () => {
    expect(joinsPhase(season.phases, at("2027-01-25T12:00:00Z"))).toBeNull();
    expect(joinsPhase(season.phases, at("2027-03-01T12:00:00Z"))).toBeNull();
  });

  it("doesn't depend on the order the phases come in", () => {
    expect(joinsPhase([...season.phases].reverse(), at("2026-11-10T12:00:00Z"))).toBe(2);
  });

  it("skips a phase whose groups are already published (#24)", () => {
    expect(joinsPhase(season.phases, at("2026-11-03T12:00:00Z"), [1])).toBe(2);
    expect(joinsPhase(season.phases, at("2026-11-03T12:00:00Z"), [])).toBe(1);
  });
});

describe("checkEntry (D18)", () => {
  const ok = { hasPair: true, open: true, entered: false, myLevel: "halado", partnerLevel: "kezdo" };

  it("lets a pair with both levels apply while the season is open", () => {
    expect(checkEntry(ok)).toBeNull();
  });

  it("needs a pair", () => {
    expect(checkEntry({ ...ok, hasPair: false })).toBe("no_pair");
  });

  it("refuses a second entry to the same season, whatever the first one's status", () => {
    expect(checkEntry({ ...ok, entered: true })).toBe("entered");
    expect(checkEntry({ ...ok, entered: true, open: false })).toBe("entered");
  });

  it("refuses outside the open window", () => {
    expect(checkEntry({ ...ok, open: false })).toBe("closed");
  });

  it("needs both players' level", () => {
    expect(checkEntry({ ...ok, myLevel: null })).toBe("no_level");
    expect(checkEntry({ ...ok, partnerLevel: null })).toBe("partner_no_level");
  });

  it("has a Hungarian message for every refusal", () => {
    for (const r of ["no_pair", "closed", "entered", "no_level", "partner_no_level"] as const) expect(ENTRY_REFUSALS[r]).toMatch(/\.$/);
  });
});

describe("averageStartingElo (spec section 11)", () => {
  it("averages the two players' starting Elo", () => {
    expect(averageStartingElo("kezdo", "kozephalado")).toBe(1100);
    expect(averageStartingElo("versenyzo", "versenyzo")).toBe(1600);
  });

  it("is unknown while a level is missing or unknown", () => {
    expect(averageStartingElo(null, "halado")).toBeNull();
    expect(averageStartingElo("halado", "profi")).toBeNull();
  });
});

describe("status texts", () => {
  it("uses the right article before the phase number", () => {
    expect(fromPhase(1)).toBe("az 1. körtől");
    expect(fromPhase(2)).toBe("a 2. körtől");
    expect(fromPhase(5)).toBe("az 5. körtől");
  });

  it("#153: says where an entered pair starts, with no word of an approval", () => {
    expect(entryStatusText({ status: "approved", joinsPhase: 1 })).toBe("Beneveztetek: az 1. körtől játszotok.");
    expect(entryStatusText({ status: "approved", joinsPhase: 3 })).toBe("Beneveztetek: a 3. körtől játszotok.");
    expect(entryStatusText({ status: "approved", joinsPhase: null })).toBe("Beneveztetek: a következő szezontól játszotok.");
    expect(entryStatusText({ status: "pending", joinsPhase: null })).not.toMatch(/jóváhagy/);
    expect(entryStatusText({ status: "rejected", joinsPhase: null })).toMatch(/nem fogadta el/);
  });

  it("#174: a taken-out pair reads that the organizer took it out and is the one to ask", () => {
    expect(entryStatusText({ status: "withdrawn", joinsPhase: 1 })).toBe(TAKEN_OUT_TEXT);
    expect(TAKEN_OUT_TEXT).toMatch(/A szervező kivett titeket a szezonból/);
    expect(TAKEN_OUT_TEXT).toMatch(/szóljatok neki/);
    expect(TAKEN_OUT_TEXT).not.toMatch(/Nevezünk/);
  });
});

describe("withdrawalReasonError (#34)", () => {
  it("needs a reason", () => {
    expect(withdrawalReasonError("")).toMatch(/miért/);
    expect(withdrawalReasonError("   ")).toMatch(/miért/);
  });

  it("takes at most the limit, counted without the spaces around it", () => {
    expect(withdrawalReasonError("Sérülés")).toBeNull();
    expect(withdrawalReasonError(` ${"x".repeat(WITHDRAWAL_REASON_MAX)} `)).toBeNull();
    expect(withdrawalReasonError("x".repeat(WITHDRAWAL_REASON_MAX + 1))).toMatch(/300/);
  });
});

describe("ENTRY_STATUS_LABELS", () => {
  it("#174: a withdrawn entry has one word", () => {
    expect(ENTRY_STATUS_LABELS.withdrawn).toBe("Visszavonva");
  });
});

describe("entryView", () => {
  const base = {
    season,
    now: at("2026-11-03T12:00:00Z"),
    hasPair: true,
    myLevel: "halado",
    partnerLevel: "halado",
    entry: null,
  };

  it("offers Nevezünk while open", () => {
    expect(entryView(base)).toEqual({ kind: "apply", late: false });
    expect(entryView({ ...base, now: at("2026-11-07T12:00:00Z") })).toEqual({ kind: "apply", late: false });
    expect(entryView({ ...base, now: at("2026-11-20T12:00:00Z") })).toEqual({ kind: "apply", late: true });
  });

  it("shows nothing before registration opens or after the last phase starts", () => {
    expect(entryView({ ...base, now: at("2026-10-30T12:00:00Z") })).toBeNull();
    expect(entryView({ ...base, now: at("2027-01-26T12:00:00Z") })).toBeNull();
  });

  it("says why a pair can't apply yet", () => {
    expect(entryView({ ...base, hasPair: false })).toMatchObject({ kind: "blocked", reason: "no_pair" });
    expect(entryView({ ...base, myLevel: null })).toMatchObject({ kind: "blocked", reason: "no_level" });
    expect(entryView({ ...base, partnerLevel: null })).toMatchObject({ kind: "blocked", reason: "partner_no_level" });
  });

  it("shows the entry's status and the organizer's note, also after the window", () => {
    const entry = { status: "rejected" as const, joinsPhase: null, note: "Tele vagyunk." };
    expect(entryView({ ...base, entry })).toEqual({ kind: "status", status: "rejected", text: entryStatusText(entry), note: "Tele vagyunk." });
    expect(entryView({ ...base, entry, now: at("2027-01-30T12:00:00Z") })).toMatchObject({ kind: "status" });
  });
});

describe("organizerEntryAction (#154)", () => {
  const winter = { ...season, id: 1, name: "Tél" };
  const spring = {
    ...season,
    id: 2,
    name: "Tavasz",
    registrationOpensAt: at("2027-02-01T12:00:00Z"),
    registrationClosesAt: at("2027-02-10T12:00:00Z"),
  };
  const now = at("2026-11-03T12:00:00Z");

  it("offers to take an entered pair out", () => {
    expect(organizerEntryAction([winter], { seasonId: 1, status: "approved" }, now)).toEqual({ kind: "remove", seasonId: 1, season: "Tél" });
    expect(organizerEntryAction([winter], { seasonId: 1, status: "pending" }, now)).toMatchObject({ kind: "remove" });
  });

  it("offers to enter a pair without an entry, for the first season open for entries", () => {
    expect(organizerEntryAction([winter, spring], null, now)).toEqual({ kind: "enter", seasonId: 1, season: "Tél" });
    expect(organizerEntryAction([spring], null, now)).toBeNull();
    expect(organizerEntryAction([winter], null, at("2027-01-26T12:00:00Z"))).toBeNull();
  });

  it("offers to enter a taken-out pair again while its season is open, nothing for a rejected one", () => {
    expect(organizerEntryAction([winter], { seasonId: 1, status: "withdrawn" }, now)).toEqual({ kind: "enter", seasonId: 1, season: "Tél" });
    expect(organizerEntryAction([winter], { seasonId: 1, status: "withdrawn" }, at("2027-01-26T12:00:00Z"))).toBeNull();
    expect(organizerEntryAction([winter], { seasonId: 1, status: "rejected" }, now)).toBeNull();
  });
});
