import { budapestTime, type SchedulingEventKind, type SchedulingState, type Side } from "@padel-liga/rules";
import { describe, expect, it } from "vitest";

import { SCHEDULING_GUIDE, eventText, groupLine, schedulingEmailDue, statusView, telHref, todoFor, venueLine } from "./matches";

const slot = budapestTime("2026-11-12", 18, 0);
const ranges = [{ start: slot, end: budapestTime("2026-11-12", 21, 0) }];

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
    const state: SchedulingState = { status: "proposed", by: "a", ranges, clubId: null, at: slot };
    expect(statusView(state, "a")).toEqual({ label: "Ajánlottatok időpontokat, várjuk a másik pár válaszát", tone: "waiting" });
    expect(statusView(state, "b")).toEqual({ label: "Időpontokat ajánlottak, válaszolj", tone: "todo" });
  });

  it("an agreed time says when it becomes fixed by itself (D148)", () => {
    const fixesAt = new Date(slot.getTime() - 6 * 3_600_000);
    const state = { status: "agreed_time", by: "b", slot, clubId: null, at: slot, fixesAt } as const;
    expect(statusView(state, "a")).toEqual({
      label: "Megbeszélt időpont (nov. 12., csütörtök 18:00), fix lesz nov. 12., csütörtök 12:00-kor, ha nem jelzitek, hogy nem így beszéltétek",
      tone: "todo",
    });
    expect(statusView(state, "b")).toEqual({
      label: "Megbeszélt időpont (nov. 12., csütörtök 18:00), fix lesz nov. 12., csütörtök 12:00-kor, ha a másik pár nem jelez",
      tone: "waiting",
    });
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
    expect(todoFor({ status: "proposed", by: "b", ranges, clubId: null, at: slot }, "a", them)).toBe(
      "Válaszolj az időpont-ajánlatra (Kiss Anna – Nagy Béla)",
    );
    expect(todoFor({ status: "agreed_time", by: "b", slot, clubId: null, at: slot, fixesAt: slot }, "a", them)).toBe(
      "Nézd meg a megbeszélt időpontot (Kiss Anna – Nagy Béla): nov. 12., csütörtök 18:00-kor magától fix lesz",
    );
  });

  it("nothing while the other pair has to answer, or once scheduled", () => {
    expect(todoFor({ status: "proposed", by: "a", ranges, clubId: null, at: slot }, "a", them)).toBeNull();
    expect(todoFor({ status: "agreed_time", by: "a", slot, clubId: null, at: slot, fixesAt: slot }, "a", them)).toBeNull();
    expect(todoFor({ status: "scheduled", slot, clubId: null }, "a", them)).toBeNull();
  });
});

describe("eventText (#26 requirement 4)", () => {
  it("describes each step", () => {
    // A range one match long reads as its start, like a proposal stored before D144.
    const legacy = { start: budapestTime("2026-11-13", 9, 30), end: budapestTime("2026-11-13", 10, 30) };
    expect(eventText({ kind: "proposal", ranges: [...ranges, legacy], venue: "Ace Padel" })).toBe(
      "Időpontokat ajánlott: nov. 12., csütörtök 18:00–21:00; nov. 13., péntek 09:30, helyszín: Ace Padel",
    );
    expect(eventText({ kind: "counter_proposal", ranges })).toBe("Új időpontokat ajánlott: nov. 12., csütörtök 18:00–21:00");
    expect(eventText({ kind: "accepted", slot })).toBe("Elfogadta: nov. 12., csütörtök 18:00");
    expect(eventText({ kind: "agreed_time", slot })).toBe("Rögzítette a megbeszélt időpontot: nov. 12., csütörtök 18:00");
    expect(eventText({ kind: "agreed_confirmed", slot })).toBe("Megerősítette a megbeszélt időpontot");
    expect(eventText({ kind: "agreed_declined", slot })).toBe("Nem erősítette meg a megbeszélt időpontot, újra egyeztettek");
    // D148: a tap says only that the SMS or mail app was opened.
    expect(eventText({ kind: "contacted", note: "sms" })).toBe("SMS-t indított a többieknek");
    expect(eventText({ kind: "contacted", note: "email" })).toBe("E-mailt indított a többieknek");
    // Fixed by itself: after 24 hours, or at the start when that came sooner.
    expect(eventText({ kind: "agreed_auto_fixed", slot, at: new Date(slot.getTime() - 3_600_000) })).toBe(
      "Magától fix lett (nov. 12., csütörtök 18:00): a másik pár 24 órán belül nem jelzett.",
    );
    expect(eventText({ kind: "agreed_auto_fixed", slot, at: slot })).toBe("Magától fix lett (nov. 12., csütörtök 18:00): a másik pár a kezdésig nem jelzett.");
  });
});

describe("telHref", () => {
  it("dials the number without spaces", () => {
    expect(telHref("+36 30 123 4567")).toBe("tel:+36301234567");
  });
});

describe("SCHEDULING_GUIDE (#26 requirement 7)", () => {
  it("is 2–3 short sentences: talk by SMS or e-mail, record the time (fixed unless the other pair objects), or give ranges", () => {
    expect(SCHEDULING_GUIDE.length).toBeGreaterThanOrEqual(2);
    expect(SCHEDULING_GUIDE.length).toBeLessThanOrEqual(3);
    const text = SCHEDULING_GUIDE.join(" ");
    expect(text).toContain("SMS-ben vagy e-mailben");
    expect(text).toContain("legalább 2 különböző napon");
    expect(text).toContain("60 perc");
    expect(text).not.toContain("48 órával");
    expect(text).toContain("nem így beszéltétek");
    expect(text).toContain("24 órán belül");
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
