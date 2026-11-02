import { describe, expect, it } from "vitest";

import { budapestClock, budapestTime } from "./calendar";
import { SLOT_RULES, agreedTimeErrors, proposalErrors, slotErrorMessage, type SlotErrorCode } from "./slots";

// Phase 1 of the first season: 9–29 Nov 2026, deadline Sunday 23:59.
const deadline = budapestTime("2026-11-29", 23, 59);
const now = budapestTime("2026-11-09", 10, 0);
const at = (day: string, h: number, m = 0) => budapestTime(day, h, m);
const codes = (errors: { code: SlotErrorCode; slot?: number }[]) => errors.map((e) => (e.slot === undefined ? e.code : `${e.code}@${e.slot}`));

const VALID = [at("2026-11-12", 18), at("2026-11-12", 19, 30), at("2026-11-14", 10)];

describe("proposalErrors (spec 6.1, #8)", () => {
  it("a valid proposal passes", () => {
    expect(proposalErrors(VALID, now, deadline)).toEqual([]);
  });

  it("more than 3 slots pass too", () => {
    expect(proposalErrors([...VALID, at("2026-11-20", 8)], now, deadline)).toEqual([]);
  });

  describe("count: at least 3 slots", () => {
    it("2 slots fail", () => {
      expect(codes(proposalErrors([at("2026-11-12", 18), at("2026-11-14", 10)], now, deadline))).toEqual(["too_few_slots"]);
    });

    it("the same start twice counts once", () => {
      const slots = [at("2026-11-12", 18), at("2026-11-12", 18), at("2026-11-14", 10)];
      expect(codes(proposalErrors(slots, now, deadline))).toEqual(["too_few_slots"]);
    });

    it("no slots at all fail on count and days", () => {
      expect(codes(proposalErrors([], now, deadline))).toEqual(["too_few_slots", "too_few_days"]);
    });
  });

  describe("days: at least 2 different Budapest days", () => {
    it("3 slots on one day fail", () => {
      const slots = [at("2026-11-12", 9), at("2026-11-12", 14), at("2026-11-12", 20)];
      expect(codes(proposalErrors(slots, now, deadline))).toEqual(["too_few_days"]);
    });

    it("days are Budapest days, not UTC days", () => {
      // 00:30 Budapest on 13 Nov is 23:30 UTC on 12 Nov: the same UTC day as
      // the other two, but a second Budapest day (only the window fails).
      const slots = [at("2026-11-12", 18), at("2026-11-12", 20), at("2026-11-13", 0, 30)];
      expect(slots[2]!.toISOString()).toBe("2026-11-12T23:30:00.000Z");
      expect(codes(proposalErrors(slots, now, deadline))).toEqual(["outside_window@2"]);
    });
  });

  describe("window: each slot starts 07:00–22:00 Budapest", () => {
    it("07:00 and 22:00 pass", () => {
      const slots = [at("2026-11-12", 7), at("2026-11-12", 22), at("2026-11-14", 10)];
      expect(proposalErrors(slots, now, deadline)).toEqual([]);
    });

    it("06:59 fails", () => {
      const slots = [at("2026-11-12", 6, 59), at("2026-11-12", 19), at("2026-11-14", 10)];
      expect(codes(proposalErrors(slots, now, deadline))).toEqual(["outside_window@0"]);
    });

    it("22:01 fails", () => {
      const slots = [at("2026-11-12", 18), at("2026-11-12", 22, 1), at("2026-11-14", 10)];
      expect(codes(proposalErrors(slots, now, deadline))).toEqual(["outside_window@1"]);
    });
  });

  describe("lead time: at least 48 hours after proposing", () => {
    it("47 h 59 min ahead fails, 48 h passes", () => {
      const rest = [at("2026-11-14", 10), at("2026-11-15", 10)];
      expect(codes(proposalErrors([at("2026-11-11", 9, 59), ...rest], now, deadline))).toEqual(["too_soon@0"]);
      expect(proposalErrors([at("2026-11-11", 10), ...rest], now, deadline)).toEqual([]);
    });

    it("a slot in the past fails as too soon", () => {
      const slots = [at("2026-11-08", 18), at("2026-11-12", 19), at("2026-11-14", 10)];
      expect(codes(proposalErrors(slots, now, deadline))).toEqual(["too_soon@0"]);
    });
  });

  describe("deadline: each slot before the phase deadline", () => {
    it("Sunday 22:00 of the last week passes, the next Monday fails", () => {
      expect(proposalErrors([at("2026-11-28", 10), at("2026-11-29", 21), at("2026-11-29", 22)], now, deadline)).toEqual([]);
      const slots = [at("2026-11-28", 10), at("2026-11-29", 21), at("2026-11-30", 18)];
      expect(codes(proposalErrors(slots, now, deadline))).toEqual(["after_deadline@2"]);
    });
  });

  it("lists every broken rule, each slot on its own", () => {
    const slots = [at("2026-11-10", 6), at("2026-11-10", 23)];
    expect(codes(proposalErrors(slots, now, deadline))).toEqual([
      "too_few_slots",
      "too_few_days",
      "outside_window@0",
      "too_soon@0",
      "outside_window@1",
      "too_soon@1",
    ]);
  });

  it("an invalid date is reported and doesn't count", () => {
    const slots = [at("2026-11-12", 18), new Date(Number.NaN), at("2026-11-14", 10)];
    expect(codes(proposalErrors(slots, now, deadline))).toEqual(["too_few_slots", "invalid@1"]);
  });

  describe("daylight saving: judged on the Budapest wall clock", () => {
    // Clocks go forward on Sunday 28 Mar 2027, 02:00 → 03:00 (UTC+1 → UTC+2).
    const springDeadline = budapestTime("2027-04-04", 23, 59);

    it("07:00 and 22:00 after the change pass, though UTC is an hour earlier than in winter", () => {
      const springNow = budapestTime("2027-03-22", 10, 0);
      const slots = [at("2027-03-27", 7), at("2027-03-29", 7), at("2027-03-29", 22)];
      expect(slots[1]!.toISOString()).toBe("2027-03-29T05:00:00.000Z");
      expect(proposalErrors(slots, springNow, springDeadline)).toEqual([]);
    });

    it("22:30 summer time fails, though it is 21:30 in winter time", () => {
      const springNow = budapestTime("2027-03-22", 10, 0);
      const late = new Date("2027-03-29T20:30:00Z");
      expect(budapestClock(late)).toEqual({ day: "2027-03-29", minutes: 22 * 60 + 30 });
      const slots = [at("2027-03-27", 10), at("2027-03-29", 10), late];
      expect(codes(proposalErrors(slots, springNow, springDeadline))).toEqual(["outside_window@2"]);
    });

    it("the lead time is 48 real hours across the change", () => {
      // From Saturday 10:00 (UTC+1), 48 hours later is Monday 11:00 (UTC+2).
      const springNow = budapestTime("2027-03-27", 10, 0);
      const rest = [at("2027-04-01", 10), at("2027-04-02", 10)];
      expect(codes(proposalErrors([at("2027-03-29", 10, 59), ...rest], springNow, springDeadline))).toEqual(["too_soon@0"]);
      expect(proposalErrors([at("2027-03-29", 11), ...rest], springNow, springDeadline)).toEqual([]);
    });

    it("autumn: 07:00 the day after clocks go back passes, 06:59 fails", () => {
      // 25 Oct 2026, 03:00 → 02:00 (UTC+2 → UTC+1).
      const autumnNow = budapestTime("2026-10-19", 10, 0);
      const autumnDeadline = budapestTime("2026-11-01", 23, 59);
      expect(proposalErrors([at("2026-10-25", 7), at("2026-10-26", 7), at("2026-10-24", 21)], autumnNow, autumnDeadline)).toEqual([]);
      const slots = [at("2026-10-25", 6, 59), at("2026-10-26", 7), at("2026-10-24", 21)];
      expect(codes(proposalErrors(slots, autumnNow, autumnDeadline))).toEqual(["outside_window@0"]);
    });
  });
});

describe("agreedTimeErrors (spec 6.3, #8)", () => {
  it("1 hour ahead passes: no lead time", () => {
    expect(agreedTimeErrors(at("2026-11-09", 11), now, deadline)).toEqual([]);
  });

  it("23:00 passes: no time window", () => {
    expect(agreedTimeErrors(at("2026-11-10", 23), now, deadline)).toEqual([]);
  });

  it("a single slot is enough: no count or day rule", () => {
    expect(agreedTimeErrors(at("2026-11-12", 18), now, deadline)).toEqual([]);
  });

  it("in the past or right now fails", () => {
    expect(codes(agreedTimeErrors(at("2026-11-09", 9), now, deadline))).toEqual(["in_past@0"]);
    expect(codes(agreedTimeErrors(now, now, deadline))).toEqual(["in_past@0"]);
  });

  it("after the deadline fails", () => {
    expect(codes(agreedTimeErrors(at("2026-11-30", 10), now, deadline))).toEqual(["after_deadline@0"]);
    expect(codes(agreedTimeErrors(deadline, now, deadline))).toEqual(["after_deadline@0"]);
  });

  it("an invalid date fails", () => {
    expect(codes(agreedTimeErrors(new Date(Number.NaN), now, deadline))).toEqual(["invalid@0"]);
  });
});

describe("slotErrorMessage (#8 requirement 6)", () => {
  it("each rule has its own Hungarian message", () => {
    const all: SlotErrorCode[] = ["invalid", "too_few_slots", "too_few_days", "outside_window", "too_soon", "in_past", "after_deadline"];
    const messages = all.map((c) => slotErrorMessage(c));
    expect(new Set(messages).size).toBe(all.length);
    expect(slotErrorMessage("too_few_slots")).toBe("Legalább 3 különböző időpontot ajánlj.");
    expect(slotErrorMessage("too_few_days")).toBe("Az időpontok legalább 2 különböző napra essenek.");
    expect(slotErrorMessage("outside_window")).toBe("Az időpont 7:00 és 22:00 között kezdődjön.");
    expect(slotErrorMessage("too_soon")).toBe("Az időpont legalább 48 órával későbbi legyen, mint most.");
    expect(slotErrorMessage("after_deadline")).toBe("Az időpont a kör határideje előtt legyen.");
  });

  it("follows the rules it is given", () => {
    expect(slotErrorMessage("outside_window", { ...SLOT_RULES, earliest: 8 * 60 + 30 })).toBe("Az időpont 8:30 és 22:00 között kezdődjön.");
  });
});

describe("budapestClock", () => {
  it("reads the Budapest wall clock in winter and summer", () => {
    expect(budapestClock(new Date("2026-11-12T17:00:00Z"))).toEqual({ day: "2026-11-12", minutes: 18 * 60 });
    expect(budapestClock(new Date("2026-07-01T22:30:00Z"))).toEqual({ day: "2026-07-02", minutes: 30 });
  });
});
