import { budapestTime, type SchedulingEventKind, type SchedulingState, type Side } from "@padel-liga/rules";
import { describe, expect, it } from "vitest";

import { SCHEDULING_GUIDE, eventText, groupLine, parseSlot, schedulingEmailDue, parseSlots, statusView, telHref, todoFor, venueLine } from "./matches";

const slot = budapestTime("2026-11-12", 18, 0);

describe("groupLine (spec 14, #25)", () => {
  it("names the division and the group", () => {
    expect(groupLine(1, 2)).toBe("Bronz divízió, 1. csoport");
    expect(groupLine(2, 2)).toBe("Réz divízió, 2. csoport");
    expect(groupLine(3, 3)).toBe("Rookie divízió, 3. csoport");
    expect(groupLine(8, 15)).toBe("Réz divízió, 8. csoport");
  });
});

describe("statusView (#25 requirement 2)", () => {
  it("to schedule", () => {
    expect(statusView({ status: "to_schedule" }, "a")).toEqual({ label: "Egyeztetésre vár", tone: "todo" });
  });

  it("a proposal waits for you or for them", () => {
    const state: SchedulingState = { status: "proposed", by: "a", slots: [slot], clubId: null, at: slot };
    expect(statusView(state, "a")).toEqual({ label: "Ajánlottatok időpontokat, a másik pár válaszára vár", tone: "waiting" });
    expect(statusView(state, "b")).toEqual({ label: "Időpontokat ajánlottak, válaszolj", tone: "todo" });
  });

  it("an agreed time waits for you or for them", () => {
    const state = { status: "agreed_time", by: "b", slot, clubId: null, at: slot } as const;
    expect(statusView(state, "a")).toEqual({ label: "Megbeszélt időpont (nov. 12., csütörtök 18:00), erősítsd meg", tone: "todo" });
    expect(statusView(state, "b").tone).toBe("waiting");
  });

  it("scheduled: the time and the venue", () => {
    expect(statusView({ status: "scheduled", slot, clubId: 1 }, "a", "Ace Padel")).toEqual({
      label: "Lefixálva: nov. 12., csütörtök 18:00, Ace Padel",
      tone: "done",
    });
    expect(statusView({ status: "scheduled", slot, clubId: null }, "b").label).toBe("Lefixálva: nov. 12., csütörtök 18:00");
  });
});

describe("todoFor (#25 requirement 3)", () => {
  const them = "Kiss Anna – Nagy Béla";

  it("an item for each open step that waits on this player", () => {
    expect(todoFor({ status: "to_schedule" }, "a", them)).toBe("Ajánlj időpontot (Kiss Anna – Nagy Béla ellen)");
    expect(todoFor({ status: "proposed", by: "b", slots: [slot], clubId: null, at: slot }, "a", them)).toBe(
      "Válaszolj az időpont-ajánlatra (Kiss Anna – Nagy Béla)",
    );
    expect(todoFor({ status: "agreed_time", by: "b", slot, clubId: null, at: slot }, "a", them)).toBe(
      "Erősítsd meg a megbeszélt időpontot (Kiss Anna – Nagy Béla)",
    );
  });

  it("nothing while the other pair has to answer, or once scheduled", () => {
    expect(todoFor({ status: "proposed", by: "a", slots: [slot], clubId: null, at: slot }, "a", them)).toBeNull();
    expect(todoFor({ status: "agreed_time", by: "a", slot, clubId: null, at: slot }, "a", them)).toBeNull();
    expect(todoFor({ status: "scheduled", slot, clubId: null }, "a", them)).toBeNull();
  });
});

describe("eventText (#26 requirement 4)", () => {
  it("describes each step", () => {
    const later = budapestTime("2026-11-13", 9, 30);
    expect(eventText({ kind: "proposal", slots: [slot, later], venue: "Ace Padel" })).toBe(
      "Időpontokat ajánlott: nov. 12., csütörtök 18:00; nov. 13., péntek 09:30, helyszín: Ace Padel",
    );
    expect(eventText({ kind: "counter_proposal", slots: [slot] })).toBe("Új időpontokat ajánlott: nov. 12., csütörtök 18:00");
    expect(eventText({ kind: "accepted", slot })).toBe("Elfogadta: nov. 12., csütörtök 18:00");
    expect(eventText({ kind: "agreed_time", slot })).toBe("Rögzítette a megbeszélt időpontot: nov. 12., csütörtök 18:00");
    expect(eventText({ kind: "agreed_confirmed", slot })).toBe("Megerősítette a megbeszélt időpontot");
    expect(eventText({ kind: "agreed_declined", slot })).toBe("Nem erősítette meg a megbeszélt időpontot, újra egyeztettek");
  });
});

describe("parseSlot", () => {
  it("reads a datetime-local value as Budapest time, in winter and in summer", () => {
    expect(parseSlot("2026-11-12T18:00")).toEqual(new Date("2026-11-12T17:00:00Z"));
    expect(parseSlot("2027-04-01T18:00")).toEqual(new Date("2027-04-01T16:00:00Z"));
  });

  it("empty is empty; anything else unreadable is null", () => {
    expect(parseSlot("  ")).toBe("");
    for (const bad of ["2026-11-12", "2026-11-31T10:00", "2026-11-12T24:00", "2026-11-12T10:60", "holnap"]) expect(parseSlot(bad)).toBeNull();
  });

  it("parseSlots skips empty rows and keeps unreadable ones as invalid dates", () => {
    const out = parseSlots(["2026-11-12T18:00", "", "rossz"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(new Date("2026-11-12T17:00:00Z"));
    expect(Number.isNaN(out[1]!.getTime())).toBe(true);
  });
});

describe("telHref", () => {
  it("dials the number without spaces", () => {
    expect(telHref("+36 30 123 4567")).toBe("tel:+36301234567");
  });
});

describe("SCHEDULING_GUIDE (#26 requirement 7)", () => {
  it("is 2–3 short sentences about proposing, recording an agreed time and the other pair's answer", () => {
    expect(SCHEDULING_GUIDE.length).toBeGreaterThanOrEqual(2);
    expect(SCHEDULING_GUIDE.length).toBeLessThanOrEqual(3);
    const text = SCHEDULING_GUIDE.join(" ");
    expect(text).toContain("legalább 3 időpontot");
    expect(text).toContain("2 különböző napra");
    expect(text).toContain("megbeszéltétek");
    expect(text).toContain("A másik pár");
  });
});

describe("venue and cancellation (#27)", () => {
  const them = "Kiss Anna – Nagy Béla";

  it("a scheduled match shows the venue with the court", () => {
    expect(statusView({ status: "scheduled", slot, clubId: 1, court: "2-es pálya" }, "a", "Ace Padel").label).toBe(
      "Lefixálva: nov. 12., csütörtök 18:00, Ace Padel, 2-es pálya",
    );
    expect(venueLine("Ace Padel", null)).toBe("Ace Padel");
    expect(venueLine(null, "2-es pálya")).toBeNull();
  });

  it("after a late cancellation the cancelling pair sees it must propose next; only it gets the Teendő", () => {
    const state: SchedulingState = { status: "to_schedule", nextBy: "b" };
    expect(statusView(state, "b")).toEqual({ label: "Későn mondtátok le, nektek kell új időpontokat ajánlani", tone: "todo" });
    expect(statusView(state, "a")).toEqual({ label: "Későn mondták le, nekik kell új időpontokat ajánlaniuk", tone: "waiting" });
    expect(todoFor(state, "b", them)).toBe("Ajánlj időpontot (Kiss Anna – Nagy Béla ellen)");
    expect(todoFor(state, "a", them)).toBeNull();
  });

  it("the log names the venue, and a late cancellation as late", () => {
    expect(eventText({ kind: "venue", venue: "Ace Padel", court: "2-es pálya" })).toBe("Rögzítette a helyszínt: Ace Padel, 2-es pálya");
    const hoursBefore = (n: number) => new Date(slot.getTime() - n * 3_600_000);
    expect(eventText({ kind: "cancelled", slot, at: hoursBefore(23) })).toBe(
      "Lemondta a meccset (nov. 12., csütörtök 18:00). Késői lemondás: 24 órán belül volt.",
    );
    expect(eventText({ kind: "cancelled", slot, at: hoursBefore(25) })).toBe("Lemondta a meccset (nov. 12., csütörtök 18:00)");
  });
});

describe("schedulingEmailDue (#191 requirement 3, #171)", () => {
  const t = (day: string, hour: number, minute = 0) => budapestTime(day, hour, minute);
  const step = (kind: SchedulingEventKind, side: Side, at: Date) => ({ kind, side, at });

  it("the first proposal, counter-proposal or agreed time of the day from a pair: an email", () => {
    expect(schedulingEmailDue([], "a", t("2026-11-10", 11))).toBe(true);
    // The other pair's steps were emailed to this pair, not to the other.
    expect(schedulingEmailDue([step("proposal", "b", t("2026-11-10", 9))], "a", t("2026-11-10", 11))).toBe(true);
  });

  it("a second one the same Budapest day from the same pair: none", () => {
    for (const kind of ["proposal", "counter_proposal", "agreed_time"] as const)
      expect(schedulingEmailDue([step(kind, "a", t("2026-11-10", 0, 5))], "a", t("2026-11-10", 23, 55))).toBe(false);
  });

  it("the next Budapest day: an email again, also across midnight and in summer time", () => {
    expect(schedulingEmailDue([step("proposal", "a", t("2026-11-10", 23, 50))], "a", t("2026-11-11", 0, 10))).toBe(true);
    expect(schedulingEmailDue([step("proposal", "a", t("2026-06-10", 23, 50))], "a", t("2026-06-11", 0, 10))).toBe(true);
    expect(schedulingEmailDue([step("proposal", "a", t("2026-06-10", 0, 10))], "a", t("2026-06-10", 23, 50))).toBe(false);
  });

  it("steps that send no email don't count", () => {
    const quiet = (["accepted", "agreed_confirmed", "agreed_declined", "venue", "cancelled"] as const).map((k) => step(k, "a", t("2026-11-10", 9)));
    expect(schedulingEmailDue(quiet, "a", t("2026-11-10", 11))).toBe(true);
  });
});
