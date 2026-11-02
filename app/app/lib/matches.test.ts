import { budapestTime, type SchedulingState } from "@padel-liga/rules";
import { describe, expect, it } from "vitest";

import { SCHEDULING_GUIDE, eventText, groupLine, parseSlot, parseSlots, statusView, telHref, todoFor } from "./matches";

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
