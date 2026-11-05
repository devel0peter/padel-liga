import { describe, expect, it } from "vitest";

import { resolutionDue } from "./deadline";
import { confirmRefusal, noShowClosesAt, noShowOutcome, rejectRefusal, reportRefusal, reportWithdrawalRefusal, type NoShowStatus } from "./no-show";
import { groupStandings } from "./standings";

// Phase 1's deadline: Sunday 29 Nov 2026 23:59 Budapest; resolved Monday 06:00.
const deadline = new Date("2026-11-29T22:59:00Z");
const slot = new Date("2026-11-18T18:00:00Z");
const scheduled = { voided: false, status: "scheduled", scheduledAt: slot, deadline, openReport: false };
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);

describe("reporting a no-show (spec 8, #33)", () => {
  it("is refused before the agreed slot starts", () => {
    expect(reportRefusal(scheduled, ms(slot, -1))).toBe("too_early");
    expect(reportRefusal(scheduled, ms(slot, -24 * 3600_000))).toBe("too_early");
  });

  it("is allowed from the slot's start until the deadline resolution", () => {
    expect(reportRefusal(scheduled, slot)).toBeNull();
    expect(reportRefusal(scheduled, ms(deadline, 3600_000))).toBeNull();
    expect(reportRefusal(scheduled, ms(resolutionDue(deadline), -1))).toBeNull();
  });

  it("closes when the deadline resolution's time comes (Monday 06:00 Budapest)", () => {
    expect(noShowClosesAt(deadline)).toEqual(new Date("2026-11-30T05:00:00Z"));
    expect(reportRefusal(scheduled, noShowClosesAt(deadline))).toBe("too_late");
  });

  it("needs an agreed slot and no recorded result", () => {
    for (const status of ["open", "result_pending", "disputed", "final"])
      expect(reportRefusal({ ...scheduled, status }, ms(slot, 1))).toBe("not_scheduled");
    expect(reportRefusal({ ...scheduled, scheduledAt: null }, ms(slot, 1))).toBe("not_scheduled");
  });

  it("is refused on a withdrawn pair's match", () => {
    expect(reportRefusal({ ...scheduled, voided: true }, ms(slot, 1))).toBe("voided");
  });

  it("allows one waiting report per match", () => {
    expect(reportRefusal({ ...scheduled, openReport: true }, ms(slot, 1))).toBe("already");
  });
});

describe("withdrawing a report", () => {
  it("only by the reporter, while it waits", () => {
    expect(reportWithdrawalRefusal({ status: "open", reportedBy: "a" }, "a")).toBeNull();
    expect(reportWithdrawalRefusal({ status: "open", reportedBy: "a" }, "b")).toBe("not_reporter");
    expect(reportWithdrawalRefusal({ status: "open", reportedBy: null }, "a")).toBe("not_reporter");
    for (const status of ["withdrawn", "confirmed", "rejected"] as NoShowStatus[])
      expect(reportWithdrawalRefusal({ status, reportedBy: "a" }, "a")).toBe("not_open");
  });
});

describe("the organizer's decision", () => {
  it("confirms only a waiting report on a match that counts and isn't final", () => {
    expect(confirmRefusal({ status: "open" }, { voided: false, status: "scheduled" })).toBeNull();
    // A result recorded after the report: the organizer may still confirm.
    expect(confirmRefusal({ status: "open" }, { voided: false, status: "result_pending" })).toBeNull();
    expect(confirmRefusal({ status: "open" }, { voided: false, status: "final" })).toBe("final");
    expect(confirmRefusal({ status: "open" }, { voided: true, status: "scheduled" })).toBe("voided");
    for (const status of ["withdrawn", "confirmed", "rejected"] as NoShowStatus[])
      expect(confirmRefusal({ status }, { voided: false, status: "scheduled" })).toBe("not_open");
  });

  it("rejects any waiting report", () => {
    expect(rejectRefusal({ status: "open" })).toBeNull();
    for (const status of ["withdrawn", "confirmed", "rejected"] as NoShowStatus[]) expect(rejectRefusal({ status })).toBe("not_open");
  });

  it("records a 4-0 4-0 walkover for the reporting side; the other side is the absent one", () => {
    expect(noShowOutcome("a")).toEqual({ outcome: { kind: "walkover", winner: "a" }, absent: "b" });
    expect(noShowOutcome("b")).toEqual({ outcome: { kind: "walkover", winner: "b" }, absent: "a" });
  });

  it("counts in the standings as a walkover: 3 points, 2-0 sets and 8-0 games for the reporting pair", () => {
    const { outcome } = noShowOutcome("b");
    const rows = groupStandings(
      [
        { id: "p1", elo: 1500 },
        { id: "p2", elo: 1400 },
      ],
      [{ a: "p1", b: "p2", outcome }],
    );
    expect(rows[0]).toMatchObject({ id: "p2", rank: 1, points: 3, wins: 1, setsWon: 2, setsLost: 0, gamesWon: 8, gamesLost: 0 });
    expect(rows[1]).toMatchObject({ id: "p1", rank: 2, points: 0, losses: 1, setsWon: 0, setsLost: 2, gamesWon: 0, gamesLost: 8 });
  });
});
