import { describe, expect, it } from "vitest";

import { budapestClock, budapestTime } from "./calendar";
import {
  SLOT_RULES,
  acceptErrors,
  agreedTimeErrors,
  fitsRange,
  isWholeHour,
  mergeRanges,
  openRanges,
  proposalErrors,
  rangeStarts,
  slotErrorMessage,
  type SlotErrorCode,
  type SlotRange,
} from "./slots";

// Phase 1 of the first season: 9–29 Nov 2026, deadline Sunday 23:59.
const deadline = budapestTime("2026-11-29", 23, 59);
const now = budapestTime("2026-11-09", 10, 0);
const at = (day: string, h: number, m = 0) => budapestTime(day, h, m);
const range = (day: string, from: number, to: number): SlotRange => ({ start: at(day, from), end: at(day, to) });
const codes = (errors: { code: SlotErrorCode; slot?: number }[]) => errors.map((e) => (e.slot === undefined ? e.code : `${e.code}@${e.slot}`));

const VALID = [range("2026-11-12", 18, 21), range("2026-11-14", 10, 12)];

describe("proposalErrors (spec 6.1, D144)", () => {
  it("ranges on 2 days pass", () => {
    expect(proposalErrors(VALID, now, deadline)).toEqual([]);
  });

  it("more ranges, several on one day, pass too", () => {
    expect(proposalErrors([...VALID, range("2026-11-12", 8, 10), range("2026-11-20", 7, 23)], now, deadline)).toEqual([]);
  });

  it("a single exact time is a range one match long", () => {
    expect(proposalErrors([range("2026-11-12", 18, 19), range("2026-11-13", 20, 21)], now, deadline)).toEqual([]);
  });

  describe("days: at least 2 different Budapest days", () => {
    it("ranges on one day fail", () => {
      expect(codes(proposalErrors([range("2026-11-12", 9, 12), range("2026-11-12", 14, 20)], now, deadline))).toEqual(["too_few_days"]);
    });

    it("no ranges at all fail", () => {
      expect(codes(proposalErrors([], now, deadline))).toEqual(["too_few_days"]);
    });

    it("one range fails, however long", () => {
      expect(codes(proposalErrors([range("2026-11-12", 7, 23)], now, deadline))).toEqual(["too_few_days"]);
    });

    it("days are Budapest days, not UTC days", () => {
      // 00:30 Budapest on 13 Nov is 23:30 UTC on 12 Nov: the same UTC day as
      // the first range, but a second Budapest day (only the window fails).
      const late = { start: at("2026-11-13", 0), end: at("2026-11-13", 1) };
      expect(late.start.toISOString()).toBe("2026-11-12T23:00:00.000Z");
      expect(codes(proposalErrors([range("2026-11-12", 18, 20), late], now, deadline))).toEqual(["outside_window@1"]);
    });
  });

  describe("length: every range fits one 60-minute match", () => {
    it("exactly 60 minutes passes, a range that ends where it starts fails", () => {
      expect(proposalErrors([range("2026-11-12", 18, 19), range("2026-11-14", 10, 11)], now, deadline)).toEqual([]);
      expect(codes(proposalErrors([range("2026-11-12", 18, 18), range("2026-11-14", 10, 11)], now, deadline))).toEqual(["too_short@0"]);
    });

    it("an end before the start fails", () => {
      expect(codes(proposalErrors([range("2026-11-12", 18, 16), range("2026-11-14", 10, 11)], now, deadline))).toEqual(["too_short@0"]);
    });
  });

  describe("whole hours only", () => {
    it("a start or end off the hour fails", () => {
      const half = { start: at("2026-11-12", 18, 30), end: at("2026-11-12", 20) };
      const endHalf = { start: at("2026-11-14", 10), end: at("2026-11-14", 11, 30) };
      expect(codes(proposalErrors([half, endHalf], now, deadline))).toEqual(["not_whole_hour@0", "not_whole_hour@1"]);
    });

    it("half an hour off the hour and only 30 minutes long fails on both", () => {
      const short = { start: at("2026-11-12", 18), end: at("2026-11-12", 18, 30) };
      expect(codes(proposalErrors([short, range("2026-11-14", 10, 11)], now, deadline))).toEqual(["not_whole_hour@0", "too_short@0"]);
    });
  });

  describe("window: within 07:00–23:00 of one Budapest day, starts 07:00–22:00", () => {
    it("07:00–08:00 and 22:00–23:00 pass", () => {
      expect(proposalErrors([range("2026-11-12", 7, 8), range("2026-11-14", 22, 23)], now, deadline)).toEqual([]);
    });

    it("a range from 06:00 fails", () => {
      expect(codes(proposalErrors([range("2026-11-12", 6, 9), range("2026-11-14", 10, 12)], now, deadline))).toEqual(["outside_window@0"]);
    });

    it("a range to midnight fails: the day changes", () => {
      const toMidnight = { start: at("2026-11-12", 21), end: at("2026-11-13", 0) };
      expect(codes(proposalErrors([toMidnight, range("2026-11-14", 10, 12)], now, deadline))).toEqual(["outside_window@0"]);
    });

    it("a range across midnight fails", () => {
      const across = { start: at("2026-11-12", 22), end: at("2026-11-13", 8) };
      expect(codes(proposalErrors([across, range("2026-11-14", 10, 12)], now, deadline))).toEqual(["outside_window@0"]);
    });
  });

  describe("time: after now, the last start before the deadline", () => {
    it("no lead time: a range from the next hour passes", () => {
      expect(proposalErrors([range("2026-11-09", 11, 12), range("2026-11-10", 7, 8)], now, deadline)).toEqual([]);
    });

    it("a range starting now or earlier fails, even if part of it is ahead", () => {
      expect(codes(proposalErrors([range("2026-11-09", 10, 12), range("2026-11-10", 7, 8)], now, deadline))).toEqual(["in_past@0"]);
      expect(codes(proposalErrors([range("2026-11-09", 8, 14), range("2026-11-10", 7, 8)], now, deadline))).toEqual(["in_past@0"]);
    });

    it("a range in the past fails", () => {
      expect(codes(proposalErrors([range("2026-11-08", 18, 20), range("2026-11-12", 18, 20)], now, deadline))).toEqual(["in_past@0"]);
    });

    it("Sunday 22:00–23:00 of the last week passes, the next Monday fails", () => {
      expect(proposalErrors([range("2026-11-28", 10, 12), range("2026-11-29", 21, 23)], now, deadline)).toEqual([]);
      expect(codes(proposalErrors([range("2026-11-28", 10, 12), range("2026-11-30", 18, 20)], now, deadline))).toEqual(["after_deadline@1"]);
    });

    it("judges the last start: a range whose last start is at the deadline fails", () => {
      const early = at("2026-11-29", 20);
      expect(proposalErrors([range("2026-11-28", 10, 12), range("2026-11-29", 18, 20)], now, early)).toEqual([]);
      expect(codes(proposalErrors([range("2026-11-28", 10, 12), range("2026-11-29", 19, 21)], now, early))).toEqual(["after_deadline@1"]);
    });
  });

  it("lists every broken rule, each range on its own", () => {
    const ranges = [range("2026-11-09", 6, 7), { start: at("2026-11-09", 22, 30), end: at("2026-11-09", 23) }];
    expect(codes(proposalErrors(ranges, now, deadline))).toEqual([
      "too_few_days",
      "outside_window@0",
      "in_past@0",
      "not_whole_hour@1",
      "too_short@1",
      "outside_window@1",
    ]);
  });

  it("an invalid range is reported and doesn't count", () => {
    const ranges = [range("2026-11-12", 18, 20), { start: new Date(Number.NaN), end: at("2026-11-14", 10) }];
    expect(codes(proposalErrors(ranges, now, deadline))).toEqual(["too_few_days", "invalid@1"]);
  });

  describe("daylight saving: judged on the Budapest wall clock", () => {
    // Clocks go forward on Sunday 28 Mar 2027, 02:00 → 03:00 (UTC+1 → UTC+2).
    const springDeadline = budapestTime("2027-04-04", 23, 59);
    const springNow = budapestTime("2027-03-22", 10, 0);

    it("07:00–23:00 after the change passes, though UTC is an hour earlier than in winter", () => {
      const ranges = [range("2027-03-27", 7, 23), range("2027-03-29", 7, 23)];
      expect(ranges[1]!.start.toISOString()).toBe("2027-03-29T05:00:00.000Z");
      expect(proposalErrors(ranges, springNow, springDeadline)).toEqual([]);
    });

    it("a range to 23:30 summer time fails, though it is 22:30 in winter time", () => {
      const late = { start: new Date("2027-03-29T19:00:00Z"), end: new Date("2027-03-29T21:30:00Z") };
      expect(budapestClock(late.end)).toEqual({ day: "2027-03-29", minutes: 23 * 60 + 30 });
      expect(codes(proposalErrors([range("2027-03-27", 10, 12), late], springNow, springDeadline))).toEqual(["not_whole_hour@1", "outside_window@1"]);
    });

    it("autumn: 07:00 the day after clocks go back passes, 06:00 fails", () => {
      // 25 Oct 2026, 03:00 → 02:00 (UTC+2 → UTC+1).
      const autumnNow = budapestTime("2026-10-19", 10, 0);
      const autumnDeadline = budapestTime("2026-11-01", 23, 59);
      expect(proposalErrors([range("2026-10-25", 7, 9), range("2026-10-24", 21, 23)], autumnNow, autumnDeadline)).toEqual([]);
      expect(codes(proposalErrors([range("2026-10-25", 6, 9), range("2026-10-24", 21, 23)], autumnNow, autumnDeadline))).toEqual(["outside_window@0"]);
    });
  });
});

describe("rangeStarts (spec 6.2, D144)", () => {
  it("every whole hour while a match fits: 14–18 has 14, 15, 16, 17", () => {
    expect(rangeStarts(range("2026-11-12", 14, 18)).map((d) => budapestClock(d).minutes / 60)).toEqual([14, 15, 16, 17]);
  });

  it("a range one match long has its start only", () => {
    expect(rangeStarts(range("2026-11-12", 18, 19))).toEqual([at("2026-11-12", 18)]);
  });

  it("only those after `after`: the hour that is now is gone", () => {
    expect(rangeStarts(range("2026-11-12", 14, 18), at("2026-11-12", 15))).toEqual([at("2026-11-12", 16), at("2026-11-12", 17)]);
    expect(rangeStarts(range("2026-11-12", 14, 18), at("2026-11-12", 15, 20))).toEqual([at("2026-11-12", 16), at("2026-11-12", 17)]);
    expect(rangeStarts(range("2026-11-12", 14, 18), at("2026-11-12", 17))).toEqual([]);
  });

  it("a range kept from before D144 (one off-hour start, one match long) has that start", () => {
    const legacy = { start: at("2026-11-12", 19, 30), end: at("2026-11-12", 20, 30) };
    expect(rangeStarts(legacy)).toEqual([legacy.start]);
  });

  it("a range too short has none", () => {
    expect(rangeStarts({ start: at("2026-11-12", 18), end: at("2026-11-12", 18, 59) })).toEqual([]);
  });
});

describe("fitsRange", () => {
  const r = range("2026-11-12", 14, 18);

  it("a whole hour from the start to the end minus 60 minutes fits", () => {
    expect(fitsRange(at("2026-11-12", 14), r)).toBe(true);
    expect(fitsRange(at("2026-11-12", 17), r)).toBe(true);
  });

  it("before the start, too late to finish, or off the hour doesn't", () => {
    expect(fitsRange(at("2026-11-12", 13), r)).toBe(false);
    expect(fitsRange(at("2026-11-12", 18), r)).toBe(false);
    expect(fitsRange(at("2026-11-12", 15, 30), r)).toBe(false);
  });

  it("the off-hour start of a range kept from before D144 fits", () => {
    expect(fitsRange(at("2026-11-12", 19, 30), { start: at("2026-11-12", 19, 30), end: at("2026-11-12", 20, 30) })).toBe(true);
  });
});

describe("openRanges: what can still be picked as time passes", () => {
  const ranges = [range("2026-11-12", 14, 18), range("2026-11-13", 18, 19)];

  it("untouched before they start", () => {
    expect(openRanges(ranges, now)).toEqual(ranges);
  });

  it("a started range starts at its next start", () => {
    expect(openRanges(ranges, at("2026-11-12", 15, 20))).toEqual([range("2026-11-12", 16, 18), ranges[1]]);
  });

  it("a range with no start left drops out", () => {
    expect(openRanges(ranges, at("2026-11-12", 17))).toEqual([ranges[1]]);
    expect(openRanges(ranges, at("2026-11-13", 18))).toEqual([]);
  });
});

describe("mergeRanges", () => {
  it("joins overlapping and touching ranges and sorts them", () => {
    const merged = mergeRanges([range("2026-11-13", 18, 20), range("2026-11-12", 16, 18), range("2026-11-12", 14, 17), range("2026-11-12", 20, 22)]);
    expect(merged).toEqual([range("2026-11-12", 14, 18), range("2026-11-12", 20, 22), range("2026-11-13", 18, 20)]);
  });

  it("keeps a range inside another once, and drops empty or invalid ones", () => {
    expect(mergeRanges([range("2026-11-12", 14, 20), range("2026-11-12", 15, 16), range("2026-11-12", 9, 9), { start: new Date(NaN), end: now }])).toEqual([
      range("2026-11-12", 14, 20),
    ]);
  });
});

describe("acceptErrors (spec 6.2, D144)", () => {
  const ranges = [range("2026-11-12", 14, 18)];

  it("a whole-hour start inside a range passes, up to the end minus 60 minutes", () => {
    expect(acceptErrors(at("2026-11-12", 14), ranges, now)).toEqual([]);
    expect(acceptErrors(at("2026-11-12", 17), ranges, now)).toEqual([]);
  });

  it("outside the ranges fails", () => {
    expect(codes(acceptErrors(at("2026-11-12", 18), ranges, now))).toEqual(["not_offered@0"]);
    expect(codes(acceptErrors(at("2026-11-12", 13), ranges, now))).toEqual(["not_offered@0"]);
  });

  it("off the hour fails", () => {
    expect(codes(acceptErrors(at("2026-11-12", 15, 30), ranges, now))).toEqual(["not_whole_hour@0"]);
  });

  it("a start that has passed fails", () => {
    expect(codes(acceptErrors(at("2026-11-12", 15), ranges, at("2026-11-12", 15)))).toEqual(["in_past@0"]);
  });

  it("the off-hour start of a range kept from before D144 passes", () => {
    const legacy = [{ start: at("2026-11-12", 19, 30), end: at("2026-11-12", 20, 30) }];
    expect(acceptErrors(at("2026-11-12", 19, 30), legacy, now)).toEqual([]);
  });

  it("an invalid date fails", () => {
    expect(codes(acceptErrors(new Date(Number.NaN), ranges, now))).toEqual(["invalid@0"]);
  });
});

describe("agreedTimeErrors (spec 6.3, #8, D144)", () => {
  it("1 hour ahead passes: no lead time", () => {
    expect(agreedTimeErrors(at("2026-11-09", 11), now, deadline)).toEqual([]);
  });

  it("23:00 passes: no time window", () => {
    expect(agreedTimeErrors(at("2026-11-10", 23), now, deadline)).toEqual([]);
  });

  it("a single slot is enough: no count or day rule", () => {
    expect(agreedTimeErrors(at("2026-11-12", 18), now, deadline)).toEqual([]);
  });

  it("off the hour fails", () => {
    expect(codes(agreedTimeErrors(at("2026-11-12", 18, 30), now, deadline))).toEqual(["not_whole_hour@0"]);
  });

  it("in the past or right now fails", () => {
    expect(codes(agreedTimeErrors(at("2026-11-09", 9), now, deadline))).toEqual(["in_past@0"]);
    expect(codes(agreedTimeErrors(now, now, deadline))).toEqual(["in_past@0"]);
  });

  it("after the deadline fails", () => {
    expect(codes(agreedTimeErrors(at("2026-11-30", 10), now, deadline))).toEqual(["after_deadline@0"]);
    expect(codes(agreedTimeErrors(at("2026-11-30", 0), now, at("2026-11-30", 0)))).toEqual(["after_deadline@0"]);
  });

  it("an invalid date fails", () => {
    expect(codes(agreedTimeErrors(new Date(Number.NaN), now, deadline))).toEqual(["invalid@0"]);
  });
});

describe("isWholeHour", () => {
  it("on the Budapest hour in winter and summer; not at a minute or a second past", () => {
    expect(isWholeHour(at("2026-11-12", 18))).toBe(true);
    expect(isWholeHour(at("2027-07-01", 18))).toBe(true);
    expect(isWholeHour(at("2026-11-12", 18, 1))).toBe(false);
    expect(isWholeHour(new Date(at("2026-11-12", 18).getTime() + 1000))).toBe(false);
    expect(isWholeHour(new Date(Number.NaN))).toBe(false);
  });
});

describe("slotErrorMessage (#8 requirement 6)", () => {
  it("each rule has its own Hungarian message", () => {
    const all: SlotErrorCode[] = ["invalid", "too_few_days", "too_short", "not_whole_hour", "outside_window", "in_past", "after_deadline", "not_offered"];
    const messages = all.map((c) => slotErrorMessage(c));
    expect(new Set(messages).size).toBe(all.length);
    expect(slotErrorMessage("too_few_days")).toBe("Adj meg ráérést legalább 2 különböző napra.");
    expect(slotErrorMessage("too_short")).toBe("Egy ráérésbe férjen bele egy 60 perces meccs.");
    expect(slotErrorMessage("not_whole_hour")).toBe("Csak egész órát adhatsz meg.");
    expect(slotErrorMessage("outside_window")).toBe("A ráérés 7:00 és 23:00 közé essen, egy napon belül.");
    expect(slotErrorMessage("after_deadline")).toBe("Az időpont a kör határideje előtt legyen.");
  });

  it("follows the rules it is given", () => {
    expect(slotErrorMessage("outside_window", { ...SLOT_RULES, earliest: 8 * 60 + 30 })).toBe("A ráérés 8:30 és 23:00 közé essen, egy napon belül.");
    expect(slotErrorMessage("too_short", { ...SLOT_RULES, matchMinutes: 90 })).toBe("Egy ráérésbe férjen bele egy 90 perces meccs.");
  });
});

describe("budapestClock", () => {
  it("reads the Budapest wall clock in winter and summer", () => {
    expect(budapestClock(new Date("2026-11-12T17:00:00Z"))).toEqual({ day: "2026-11-12", minutes: 18 * 60 });
    expect(budapestClock(new Date("2026-07-01T22:30:00Z"))).toEqual({ day: "2026-07-02", minutes: 30 });
  });
});
