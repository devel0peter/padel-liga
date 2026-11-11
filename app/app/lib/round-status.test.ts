// The running round's numbers (#350): totals, played and fixed moments read
// back from the log, the day-by-day series in Budapest days, pace, forecast
// and verdict.
import { budapestTime, type MatchScore, type ResultEvent, type Ruling, type SchedulingEvent } from "@padel-liga/rules";
import { describe, expect, it } from "vitest";

import type { OverviewStatus } from "./match-overview";
import {
  compactLine,
  dayEnd,
  daysLeftText,
  fixedAt,
  isFixedAt,
  isPlayedAt,
  paceText,
  playedAt,
  roundStatus,
  shareText,
  verdictText,
  type RoundMatch,
} from "./round-status";

const at = (day: string, hour: number, minute = 0) => budapestTime(day, hour, minute);
const hours = (from: Date, n: number) => new Date(from.getTime() + n * 3_600_000);
const SCORE: MatchScore = {
  sets: [
    [4, 2],
    [4, 3],
  ],
};

// Round 1: Mon 9 – Sun 29 Nov 2026 (Budapest).
const STARTS = at("2026-11-09", 0);
const DEADLINE = at("2026-11-29", 23, 59);

const ev = (kind: SchedulingEvent["kind"], side: "a" | "b", when: Date, extra: Partial<SchedulingEvent> = {}): SchedulingEvent => ({ kind, side, at: when, ...extra });
const recorded = (when: Date, side: "a" | "b" = "a"): ResultEvent => ({ kind: "result_recorded", side, at: when, score: SCORE });
const confirmed = (when: Date, side: "a" | "b" = "b"): ResultEvent => ({ kind: "result_confirmed", side, at: when });
const ruling = (kind: Ruling["kind"], when: Date): Ruling => ({ kind, at: when, outcome: { kind: "played", score: SCORE } });

function match(p: Partial<RoundMatch> = {}): RoundMatch {
  return { groupNumber: 1, week: 1, status: "to_schedule", stuck: false, scheduling: [], results: [], rulings: [], ...p };
}

// A match confirmed as played at `when` (status final).
const playedOn = (when: Date, p: Partial<RoundMatch> = {}) =>
  match({ status: "final", results: [recorded(hours(when, -1)), confirmed(when)], ...p });

const input = (matches: RoundMatch[], now: Date, p: Partial<Parameters<typeof roundStatus>[0]> = {}) => ({
  phaseStartsAt: STARTS,
  deadline: DEADLINE,
  groups: [1, 2],
  matches,
  voided: 0,
  now,
  ...p,
});

describe("played at (#350 definitions)", () => {
  const rec = at("2026-11-10", 20);

  it("confirmed by the other pair: the confirmation's time", () => {
    const m = match({ results: [recorded(rec), confirmed(hours(rec, 3))] });
    expect(playedAt(m, at("2026-11-20", 12))).toEqual(hours(rec, 3));
    expect(isPlayedAt(m, hours(rec, 2))).toBe(false);
  });

  it("accepted by itself after 48 hours: the ruling's time", () => {
    const m = match({ results: [recorded(rec)], rulings: [ruling("auto_accepted", hours(rec, 48))] });
    expect(playedAt(m, at("2026-11-20", 12))).toEqual(hours(rec, 48));
  });

  it("decided by the organizer: the decision's time", () => {
    const m = match({ results: [recorded(rec), { kind: "result_disputed", side: "b", at: hours(rec, 2), score: SCORE }], rulings: [ruling("organizer", hours(rec, 30))] });
    expect(playedAt(m, at("2026-11-20", 12))).toEqual(hours(rec, 30));
  });

  it("decided at the deadline: the deadline ruling's time", () => {
    const m = match({ rulings: [ruling("deadline", at("2026-11-30", 6))] });
    expect(playedAt(m, at("2026-11-30", 7))).toEqual(at("2026-11-30", 6));
  });

  it("the first time it became final, not a later override", () => {
    const m = match({ results: [recorded(rec), confirmed(hours(rec, 1))], rulings: [ruling("organizer", hours(rec, 50))] });
    expect(playedAt(m, at("2026-11-20", 12))).toEqual(hours(rec, 1));
  });

  it("null while it isn't final, or not yet at `now`", () => {
    expect(playedAt(match({ results: [recorded(rec)] }), at("2026-11-11", 12))).toBeNull();
    expect(playedAt(match({ results: [recorded(rec), confirmed(hours(rec, 3))] }), hours(rec, 1))).toBeNull();
  });
});

describe("fixed at (#350 definitions)", () => {
  const slot = at("2026-11-13", 18);
  const now = at("2026-11-12", 12);

  it("an accepted slot: the acceptance's time", () => {
    const m = match({
      scheduling: [
        ev("proposal", "a", at("2026-11-10", 9), { ranges: [{ start: slot, end: hours(slot, 2) }] }),
        ev("accepted", "b", at("2026-11-10", 15), { slot }),
      ],
    });
    expect(fixedAt(m, now)).toEqual(at("2026-11-10", 15));
  });

  it("a confirmed agreed time: the confirmation's time", () => {
    const m = match({ scheduling: [ev("agreed_time", "a", at("2026-11-10", 9), { slot }), ev("agreed_confirmed", "b", at("2026-11-10", 11))] });
    expect(fixedAt(m, now)).toEqual(at("2026-11-10", 11));
  });

  it("an agreed time fixed by itself (D148): 24 hours later, logged or not", () => {
    const agreed = ev("agreed_time", "a", at("2026-11-10", 9), { slot });
    expect(fixedAt(match({ scheduling: [agreed, ev("agreed_auto_fixed", "b", at("2026-11-11", 9, 10))] }), now)).toEqual(at("2026-11-11", 9));
    expect(fixedAt(match({ scheduling: [agreed] }), now)).toEqual(at("2026-11-11", 9));
    expect(isFixedAt(match({ scheduling: [agreed] }), at("2026-11-11", 8))).toBe(false);
  });

  it("a fixed time cancelled (#27) is not fixed until fixed again", () => {
    const later = at("2026-11-20", 18);
    const scheduling = [
      ev("agreed_time", "a", at("2026-11-10", 9), { slot }),
      ev("agreed_confirmed", "b", at("2026-11-10", 11)),
      ev("cancelled", "a", at("2026-11-11", 10), { slot }),
    ];
    expect(fixedAt(match({ scheduling }), now)).toBeNull();
    expect(isFixedAt(match({ scheduling }), at("2026-11-10", 12))).toBe(true);
    const refixed = [...scheduling, ev("agreed_time", "b", at("2026-11-12", 8), { slot: later }), ev("agreed_confirmed", "a", at("2026-11-12", 9))];
    expect(fixedAt(match({ scheduling: refixed }), now)).toEqual(at("2026-11-12", 9));
  });

  it("a result fixes the match even without a fixed time", () => {
    const m = match({ results: [recorded(at("2026-11-11", 21))] });
    expect(fixedAt(m, now)).toEqual(at("2026-11-11", 21));
  });
});

describe("roundStatus totals (#350 requirements 1, 2)", () => {
  const now = at("2026-11-18", 12);
  const statuses: OverviewStatus[] = ["to_schedule", "to_schedule", "proposed", "agreed_time", "scheduled", "result_pending", "disputed", "final", "final"];
  const matches = statuses.map((status, i) => match({ status, stuck: i < 2, groupNumber: (i % 2) + 1, week: (i % 3) + 1 }));
  const s = roundStatus(input(matches, now, { voided: 3 }));

  it("statuses add up to the total, in the overview's order; withdrawn and stuck beside them", () => {
    expect(s.total).toBe(9);
    expect(s.counts.map((c) => c.count)).toEqual([2, 1, 1, 1, 1, 1, 2]);
    expect(s.counts.reduce((sum, c) => sum + c.count, 0)).toBe(s.total);
    expect(s.counts[0]).toEqual({ status: "to_schedule", label: "Egyeztetésre vár", count: 2 });
    expect(s.voided).toBe(3);
    expect(s.stuck).toBe(2);
  });

  it("played is Lejátszva; fixed is Lefixálva or later", () => {
    expect(s.played).toBe(2);
    expect(s.fixed).toBe(5);
  });

  it("days left count today and the deadline day", () => {
    expect(s.today).toBe("2026-11-18");
    expect(s.daysLeft).toBe(12);
    expect(roundStatus(input([], at("2026-11-29", 20))).daysLeft).toBe(1);
    expect(daysLeftText(12)).toBe("még 12 nap");
    expect(daysLeftText(1)).toBe("ma a határidő");
  });

  it("per week: played / total and not fixed", () => {
    expect(s.weeks).toEqual([
      { week: 1, played: 0, total: 3, notFixed: 2 },
      { week: 2, played: 1, total: 3, notFixed: 1 },
      { week: 3, played: 1, total: 3, notFixed: 1 },
    ]);
  });
});

describe("the withdrawn pair's matches (D87)", () => {
  it("are only counted as Nem számít: no day of the series has them", () => {
    const now = at("2026-11-12", 12);
    const s = roundStatus(input([match(), playedOn(at("2026-11-10", 20))], now, { voided: 2 }));
    expect(s.total).toBe(2);
    expect(s.voided).toBe(2);
    expect(s.series[0]!.remaining).toBe(2);
    expect(s.series[0]!.ideal).toBe(2);
    expect(s.series.every((d) => (d.remaining ?? 0) <= 2 && (d.notFixed ?? 0) <= 2)).toBe(true);
  });
});

describe("the day-by-day series (#350 requirement 4)", () => {
  it("one day per day of the round, values up to today only", () => {
    const now = at("2026-11-12", 12);
    const m = [playedOn(at("2026-11-10", 20)), playedOn(at("2026-11-12", 9)), match()];
    const s = roundStatus(input(m, now));
    expect(s.series).toHaveLength(21);
    expect(s.series[0]!.day).toBe("2026-11-09");
    expect(s.series[20]!.day).toBe("2026-11-29");
    expect(s.series.map((d) => d.remaining).slice(0, 5)).toEqual([3, 2, 2, 1, null]);
    expect(s.series[0]!.ideal).toBe(3);
    expect(s.series[20]!.ideal).toBe(0);
    expect(s.series[10]!.ideal).toBeCloseTo(1.5);
  });

  it("the not fixed line follows fixing and cancelling", () => {
    const slot = at("2026-11-14", 18);
    const m = match({
      status: "to_schedule",
      scheduling: [ev("agreed_time", "a", at("2026-11-09", 9), { slot }), ev("agreed_confirmed", "b", at("2026-11-09", 10)), ev("cancelled", "b", at("2026-11-11", 9), { slot })],
    });
    const s = roundStatus(input([m], at("2026-11-12", 12)));
    expect(s.series.map((d) => d.notFixed).slice(0, 4)).toEqual([0, 0, 1, 1]);
  });

  it("week marks on each week's first day", () => {
    const m = [match({ week: 1 }), match({ week: 2 }), match({ week: 3 })];
    expect(roundStatus(input(m, at("2026-11-12", 12))).weekMarks).toEqual([
      { day: "2026-11-09", label: "1. hét" },
      { day: "2026-11-16", label: "2. hét" },
      { day: "2026-11-23", label: "3. hét" },
    ]);
  });

  it("an extended deadline (#356) lengthens the axis, the ideal line and the forecast", () => {
    const now = at("2026-11-20", 12);
    const m = [playedOn(at("2026-11-10", 20)), playedOn(at("2026-11-16", 20)), match(), match()];
    const s = roundStatus(input(m, now, { deadline: at("2026-12-06", 23, 59) }));
    expect(s.series).toHaveLength(28);
    expect(s.series.at(-1)!.day).toBe("2026-12-06");
    expect(s.series.at(-1)!.ideal).toBe(0);
    expect(s.series[20]!.ideal).toBeGreaterThan(0);
    expect(s.daysLeft).toBe(17);
    expect(s.series.at(-1)!.forecast).toBe(s.total - s.forecast!);
  });

  it("before the round starts: the axis, the ideal line, no values", () => {
    const s = roundStatus(input([match(), match()], at("2026-11-08", 12)));
    expect(s.series).toHaveLength(21);
    expect(s.series.every((d) => d.remaining === null && d.notFixed === null && d.forecast === null)).toBe(true);
    expect(s.verdict).toBe("early");
    expect(s.groups.every((g) => !g.behind)).toBe(true);
  });
});

describe("Budapest days across the clock changes", () => {
  it("a day ends at the next Budapest midnight (25 Oct 2026, 29 Mar 2026)", () => {
    expect(dayEnd("2026-10-24")).toEqual(new Date("2026-10-24T22:00:00Z"));
    expect(dayEnd("2026-10-25")).toEqual(new Date("2026-10-25T23:00:00Z"));
    expect(dayEnd("2026-03-28")).toEqual(new Date("2026-03-28T23:00:00Z"));
    expect(dayEnd("2026-03-29")).toEqual(new Date("2026-03-29T22:00:00Z"));
  });

  it("autumn: a match played at 23:30 on 25 Oct counts on that day, not the next", () => {
    // Round Mon 12 Oct – Sun 1 Nov 2026; Budapest goes back to UTC+1 on 25 Oct.
    const start = at("2026-10-12", 0);
    const late = new Date("2026-10-25T22:30:00Z"); // 23:30 Budapest, 25 Oct
    const early = new Date("2026-10-24T22:30:00Z"); // 00:30 Budapest, 25 Oct
    const s = roundStatus(input([playedOn(late), playedOn(early), match()], at("2026-10-28", 12), { phaseStartsAt: start, deadline: at("2026-11-01", 23, 59) }));
    const day = (d: string) => s.series.find((x) => x.day === d)!;
    expect(day("2026-10-24").remaining).toBe(3);
    expect(day("2026-10-25").remaining).toBe(1);
  });

  it("spring: 00:30 on 30 Mar (UTC+2) is 30 Mar, 23:30 on 29 Mar is 29 Mar", () => {
    const start = at("2026-03-23", 0);
    const s = roundStatus(
      input([playedOn(new Date("2026-03-29T21:30:00Z")), playedOn(new Date("2026-03-29T22:30:00Z")), match()], at("2026-04-02", 12), {
        phaseStartsAt: start,
        deadline: at("2026-04-12", 23, 59),
      }),
    );
    const day = (d: string) => s.series.find((x) => x.day === d)!;
    expect(day("2026-03-28").remaining).toBe(3);
    expect(day("2026-03-29").remaining).toBe(2);
    expect(day("2026-03-30").remaining).toBe(1);
  });
});

describe("pace, forecast and verdict (#350 requirement 3)", () => {
  // 10 matches; `n` played on each listed day, at 20:00.
  const round = (playedDays: string[], now: Date, total = 10) => {
    const played = playedDays.map((d) => playedOn(at(d, 20)));
    return roundStatus(input([...played, ...Array.from({ length: total - played.length }, () => match())], now));
  };

  it("fewer than 7 days behind: the pace is over the days since the start", () => {
    // Fri 13 Nov: 4 whole days behind (Mon–Thu), 2 played in them, 1 today.
    const s = round(["2026-11-09", "2026-11-11", "2026-11-13"], at("2026-11-13", 21));
    expect(s.pace).toBe(0.5);
    expect(s.played).toBe(3);
    expect(s.daysLeft).toBe(17);
    expect(s.forecast).toBe(10); // 3 + floor(0.5 × 17) = 11, capped at 10
    expect(s.verdict).toBe("on_track");
  });

  it("more than 7 days behind: only the last 7 count", () => {
    // Thu 19 Nov: the last 7 whole days are 12–18 Nov.
    const s = round(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-18"], at("2026-11-19", 10), 40);
    expect(s.pace).toBeCloseTo(2 / 7);
    expect(s.daysLeft).toBe(11);
    expect(s.forecast).toBe(5 + Math.floor((2 / 7) * 11));
    expect(s.verdict).toBe("behind");
    expect(s.shortfall).toBe(40 - s.forecast!);
    expect(s.neededPace).toBeCloseTo(35 / 11);
  });

  it("the forecast never passes the total", () => {
    const s = round(["2026-11-10", "2026-11-10", "2026-11-11", "2026-11-11"], at("2026-11-13", 9), 5);
    expect(s.forecast).toBe(5);
    expect(s.verdict).toBe("on_track");
  });

  it("before the 4th day, or with nothing played: Még korai becsülni", () => {
    expect(round(["2026-11-09", "2026-11-10"], at("2026-11-11", 22)).verdict).toBe("early");
    expect(round([], at("2026-11-20", 12)).verdict).toBe("early");
    expect(round(["2026-11-09"], at("2026-11-12", 9)).verdict).not.toBe("early");
  });

  it("the forecast line: today's remainder to the forecast's remainder on the deadline day", () => {
    const s = round(["2026-11-09", "2026-11-11", "2026-11-13"], at("2026-11-16", 9), 30);
    const today = s.series.findIndex((d) => d.day === "2026-11-16");
    expect(s.series[today]!.forecast).toBe(27);
    expect(s.series.at(-1)!.forecast).toBe(30 - s.forecast!);
    expect(s.series.filter((d) => d.forecast !== null)).toHaveLength(2);
    expect(round([], at("2026-11-16", 9)).series.every((d) => d.forecast === null)).toBe(true);
  });

  it("the texts", () => {
    expect(verdictText({ verdict: "early", shortfall: 0 })).toBe("Még korai becsülni.");
    expect(verdictText({ verdict: "on_track", shortfall: 0 })).toBe("Jó ütemben: a mostani tempóval minden meccs lemegy a határidőig.");
    expect(verdictText({ verdict: "behind", shortfall: 7 })).toBe("Lemaradás: a mostani tempóval kb. 7 meccs maradhat le.");
    expect(paceText({ neededPace: 1.5, pace: 0.8 })).toBe("naponta 1,5 meccs kellene, eddig 0,8/nap");
    expect(paceText({ neededPace: 2, pace: 0 })).toBe("naponta 2,0 meccs kellene, eddig 0,0/nap");
    expect(shareText(12, 48)).toBe("25%");
    expect(shareText(1, 3)).toBe("33,3%");
    expect(shareText(0, 0)).toBe("0%");
    expect(compactLine({ played: 12, total: 48, daysLeft: 9, verdict: "behind" })).toBe("Lejátszva 12/48 (25%) · még 9 nap · Lemaradás");
    expect(compactLine({ played: 48, total: 48, daysLeft: 1, verdict: "on_track" })).toBe("Lejátszva 48/48 (100%) · ma a határidő · Jó ütemben");
  });
});

describe("per group (#350 requirement 6)", () => {
  it("a group more than 25 points below the ideal share for today is behind", () => {
    // Thu 19 Nov is day 11 of 21: the ideal share is 10/20 = 50%.
    const now = at("2026-11-19", 12);
    const g1 = [playedOn(at("2026-11-10", 20)), match(), match(), match(), match()]; // 20%: behind
    const g2 = [playedOn(at("2026-11-10", 20), { groupNumber: 2 }), playedOn(at("2026-11-11", 20), { groupNumber: 2 }), match({ groupNumber: 2 }), match({ groupNumber: 2 })]; // 50%
    const s = roundStatus(input([...g1, ...g2], now, { groups: [2, 1, 3] }));
    expect(s.groups).toEqual([
      { group: 2, played: 2, total: 4, behind: false },
      { group: 1, played: 1, total: 5, behind: true },
      { group: 3, played: 0, total: 0, behind: false },
    ]);
  });

  it("exactly 25 points below is not behind", () => {
    const now = at("2026-11-19", 12);
    const s = roundStatus(input([playedOn(at("2026-11-10", 20)), match(), match(), match()], now, { groups: [1] }));
    expect(s.groups[0]).toEqual({ group: 1, played: 1, total: 4, behind: false });
  });
});
