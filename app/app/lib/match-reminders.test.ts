import { budapestTime, type SchedulingState } from "@padel-liga/rules";
import { describe, expect, it } from "vitest";

import {
  budapestHour,
  digestItems,
  dueReminders,
  isMorningRun,
  isTomorrowRun,
  reminderMessage,
  tomorrowDue,
  tomorrowMessage,
  type ReminderMatch,
} from "./match-reminders";

const at = (day: string, h: number, m = 0) => budapestTime(day, h, m);

// Phase 1 of the first season: Mon 9 – Sun 29 Nov 2026 (winter time).
const START = at("2026-11-09", 0);
const DEADLINE = at("2026-11-29", 23, 59);
const open: SchedulingState = { status: "to_schedule" };
const match = (week: number, over: Partial<ReminderMatch> = {}): ReminderMatch => ({
  week,
  phaseStartsAt: START,
  deadline: DEADLINE,
  status: "open",
  state: open,
  kinds: [],
  ...over,
});
const morning = (day: string) => at(day, 7);

describe("when the cron sends what (D75)", () => {
  it("the morning starts at 07:00 Budapest, in winter and in summer time", () => {
    // Winter: 07:00 Budapest is 06:00 UTC; summer: 05:00 UTC.
    expect(isMorningRun(new Date("2026-11-11T06:00:00Z"))).toBe(true);
    expect(isMorningRun(new Date("2026-11-11T05:50:00Z"))).toBe(false);
    expect(isMorningRun(new Date("2027-04-07T05:00:00Z"))).toBe(true);
    expect(isMorningRun(new Date("2027-04-07T04:50:00Z"))).toBe(false);
  });

  it("the morning's runs go on until noon: 11:50 is one, 12:00 is not", () => {
    expect(isMorningRun(at("2026-11-11", 11, 50))).toBe(true);
    expect(isMorningRun(at("2026-11-11", 12))).toBe(false);
  });

  it("across both daylight-saving changes the hour follows the Budapest clock", () => {
    // Sun 25 Oct 2026: 03:00 summer time becomes 02:00 winter time.
    expect(budapestHour(new Date("2026-10-25T05:00:00Z"))).toBe(6);
    expect(budapestHour(new Date("2026-10-26T06:00:00Z"))).toBe(7);
    expect(budapestHour(new Date("2026-10-24T05:00:00Z"))).toBe(7);
    // Sun 28 Mar 2027: 02:00 winter time becomes 03:00 summer time.
    expect(budapestHour(new Date("2027-03-27T06:00:00Z"))).toBe(7);
    expect(budapestHour(new Date("2027-03-29T05:00:00Z"))).toBe(7);
  });

  it("holnap meccs runs from 18:00 to 21:00 sharp Budapest (D84): not at 17:50 or 21:10", () => {
    const runs = [at("2026-11-11", 17, 50), at("2026-11-11", 18), at("2026-11-11", 21), at("2026-11-11", 21, 10)];
    expect(runs.map(isTomorrowRun)).toEqual([false, true, true, false]);
  });
});

describe("dueReminders (spec 13, #31)", () => {
  it("no proposal 2 days into the week: from Wednesday of the match's week, for each week", () => {
    expect(dueReminders(match(1), morning("2026-11-10"))).toEqual([]);
    expect(dueReminders(match(1), morning("2026-11-11"))).toEqual(["match_no_proposal"]);
    expect(dueReminders(match(2), morning("2026-11-11"))).toEqual([]);
    expect(dueReminders(match(2), morning("2026-11-18"))).toEqual(["match_no_proposal"]);
    // Just after midnight on Wednesday counts as Wednesday.
    expect(dueReminders(match(1), at("2026-11-11", 0, 5))).toEqual(["match_no_proposal"]);
  });

  it("not once either pair has proposed or recorded a time, even if it lapsed", () => {
    for (const kind of ["proposal", "counter_proposal", "agreed_time"] as const)
      expect(dueReminders(match(1, { kinds: [kind] }), morning("2026-11-11"))).toEqual([]);
  });

  it("end of the scheduled week, still not scheduled: from the Monday after, never for week 3", () => {
    const proposed = { kinds: ["proposal" as const] };
    expect(dueReminders(match(1, proposed), at("2026-11-15", 23))).toEqual([]);
    expect(dueReminders(match(1, proposed), morning("2026-11-16"))).toEqual(["match_week_end"]);
    expect(dueReminders(match(2, proposed), morning("2026-11-23"))).toEqual(["match_week_end"]);
    expect(dueReminders(match(3, proposed), morning("2026-11-26"))).toEqual(["match_deadline_soon"]);
  });

  it("3 days before the deadline, still not scheduled: from the Thursday before its Sunday", () => {
    const proposed = { kinds: ["proposal" as const] };
    expect(dueReminders(match(3, proposed), morning("2026-11-25"))).toEqual([]);
    expect(dueReminders(match(3, proposed), morning("2026-11-26"))).toEqual(["match_deadline_soon"]);
  });

  it("several due at once (a missed run): the latest first", () => {
    expect(dueReminders(match(1), morning("2026-11-26"))).toEqual(["match_deadline_soon", "match_week_end", "match_no_proposal"]);
  });

  it("nothing for a scheduled match, a played or resolved one, or after the deadline", () => {
    const scheduled: SchedulingState = { status: "scheduled", slot: at("2026-11-28", 10), clubId: null };
    expect(dueReminders(match(1, { state: scheduled, status: "scheduled" }), morning("2026-11-26"))).toEqual([]);
    for (const status of ["result_pending", "disputed", "final"])
      expect(dueReminders(match(1, { status }), morning("2026-11-26"))).toEqual([]);
    expect(dueReminders(match(3), new Date(DEADLINE.getTime() + 60_000))).toEqual([]);
  });

  it("across the October daylight-saving change the days stay Budapest days", () => {
    // A phase Mon 19 Oct – Sun 8 Nov 2026; week 2 starts Mon 26 Oct, the day after the change.
    const m = match(2, { phaseStartsAt: at("2026-10-19", 0), deadline: at("2026-11-08", 23, 59) });
    expect(dueReminders(m, at("2026-10-27", 23, 59))).toEqual([]);
    expect(dueReminders(m, at("2026-10-28", 0))).toEqual(["match_no_proposal"]);
    // Week 1's end: Monday 26 Oct at 00:00 Budapest, 23:00 UTC on Sunday.
    const w1 = match(1, { phaseStartsAt: at("2026-10-19", 0), deadline: at("2026-11-08", 23, 59), kinds: ["proposal"] });
    expect(dueReminders(w1, new Date("2026-10-25T22:59:00Z"))).toEqual([]);
    expect(dueReminders(w1, new Date("2026-10-25T23:00:00Z"))).toEqual(["match_week_end"]);
  });

  it("across the March change too", () => {
    // A phase Mon 22 Mar – Sun 11 Apr 2027; week 2 starts the day after the change.
    const m = match(2, { phaseStartsAt: at("2027-03-22", 0), deadline: at("2027-04-11", 23, 59), kinds: ["proposal"] });
    expect(dueReminders(m, new Date("2027-04-04T21:59:00Z"))).toEqual([]);
    expect(dueReminders(m, new Date("2027-04-04T22:00:00Z"))).toEqual(["match_week_end"]);
  });
});

describe("tomorrowDue: the evening before an accepted slot", () => {
  const slot = at("2026-11-12", 18);
  const scheduled = { status: "scheduled", state: { status: "scheduled", slot, clubId: null } as SchedulingState };

  it("the evening run of the day before, not other hours or days", () => {
    expect(tomorrowDue(scheduled, at("2026-11-11", 18))).toBe(true);
    expect(tomorrowDue(scheduled, at("2026-11-11", 21))).toBe(true);
    expect(tomorrowDue(scheduled, at("2026-11-11", 17))).toBe(false);
    // The 10-minute runs at the edges (#222).
    expect(tomorrowDue(scheduled, at("2026-11-11", 17, 50))).toBe(false);
    expect(tomorrowDue(scheduled, at("2026-11-11", 21, 10))).toBe(false);
    expect(tomorrowDue(scheduled, at("2026-11-10", 18))).toBe(false);
    expect(tomorrowDue(scheduled, at("2026-11-12", 18))).toBe(false);
  });

  it("an early slot after midnight counts for the evening before", () => {
    const early = { status: "scheduled", state: { status: "scheduled", slot: at("2026-11-12", 7), clubId: null } as SchedulingState };
    expect(tomorrowDue(early, at("2026-11-11", 20))).toBe(true);
  });

  it("across the October change: the day before by the Budapest calendar", () => {
    const sunday = { status: "scheduled", state: { status: "scheduled", slot: at("2026-10-25", 10), clubId: null } as SchedulingState };
    expect(tomorrowDue(sunday, at("2026-10-24", 18))).toBe(true);
    const monday = { status: "scheduled", state: { status: "scheduled", slot: at("2026-10-26", 10), clubId: null } as SchedulingState };
    expect(tomorrowDue(monday, at("2026-10-25", 18))).toBe(true);
    expect(tomorrowDue(monday, at("2026-10-24", 18))).toBe(false);
  });

  it("not for a match that isn't scheduled, or is already played", () => {
    expect(tomorrowDue({ status: "open", state: { status: "to_schedule" } }, at("2026-11-11", 18))).toBe(false);
    expect(tomorrowDue({ ...scheduled, status: "final" }, at("2026-11-11", 18))).toBe(false);
  });
});

describe("texts", () => {
  it("each reminder links to the match, with the week and no names", () => {
    const input = { matchId: 7, week: 1, deadline: DEADLINE };
    expect(reminderMessage("match_no_proposal", input)).toEqual({
      title: "Még nincs időpont-ajánlat",
      body: "Az 1. heti meccsetekre még senki nem ajánlott időpontot. Ajánljatok most, vagy rögzítsétek, ha már megbeszéltétek.",
      url: "/matches/7",
    });
    expect(reminderMessage("match_week_end", { ...input, week: 2 })).toEqual({
      title: "Pótoljátok a kör végéig",
      body: "A 2. heti meccsetek még nincs lefixálva. Határidő: nov. 29., vasárnap 23:59.",
      url: "/matches/7",
    });
    expect(reminderMessage("match_deadline_soon", { ...input, week: 3 }).body).toBe(
      "A 3. heti meccsetek még nincs lefixálva, a határidő nov. 29., vasárnap 23:59. Ha addig nem játsszátok le, a szabályzat szerint dől el, akár játék nélküli vereséggel.",
    );
  });

  it("holnap meccs: starts with Holnap, then day, time and venue (#184)", () => {
    expect(tomorrowMessage({ matchId: 7, slot: at("2026-11-12", 18), venue: "Ace Padel", court: "2-es pálya" })).toEqual({
      title: "Holnap meccs",
      body: "Holnap (nov. 12., csütörtök) 18:00, Ace Padel, 2-es pálya. Jó játékot!",
      url: "/matches/7",
    });
    expect(tomorrowMessage({ matchId: 7, slot: at("2026-11-12", 18), venue: null, court: null }).body).toBe(
      "Holnap (nov. 12., csütörtök) 18:00. Jó játékot!",
    );
    expect(tomorrowMessage({ matchId: 7, slot: at("2026-11-12", 9), venue: "Ace Padel", court: null }).body).toBe(
      "Holnap (nov. 12., csütörtök) 09:00, Ace Padel. Jó játékot!",
    );
  });
});

describe("digestItems", () => {
  const item = (id: number, read: boolean) => ({ id, title: `T${id}`, body: "B", url: `/matches/${id}`, readAt: read ? new Date() : null });

  it("only what wasn't opened in the app, oldest first", () => {
    expect(digestItems([item(3, false), item(1, false), item(2, true)])).toEqual([
      { title: "T1", body: "B", url: "/matches/1" },
      { title: "T3", body: "B", url: "/matches/3" },
    ]);
  });

  it("nothing to send when everything was read or there was nothing", () => {
    expect(digestItems([item(1, true)])).toBeNull();
    expect(digestItems([])).toBeNull();
  });
});
