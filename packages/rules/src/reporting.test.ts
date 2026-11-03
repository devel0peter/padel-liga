import { describe, expect, it } from "vitest";

import { budapestTime } from "./calendar";
import {
  AUTO_ACCEPT_HOURS,
  autoAcceptAt,
  autoAcceptDue,
  decisionErrors,
  disputeErrors,
  flipScore,
  resultActions,
  resultState,
  resultWaitingFor,
  sameScore,
  type ResultEvent,
  type Ruling,
} from "./reporting";
import type { MatchScore } from "./results";

const at = (day: string, h: number, m = 0) => budapestTime(day, h, m);
const T0 = at("2026-11-12", 20);
const WIN_A: MatchScore = { sets: [[4, 1], [4, 2]] };
const SPLIT: MatchScore = { sets: [[4, 1], [2, 4]], superTieBreak: [10, 8] };
const WIN_B: MatchScore = { sets: [[1, 4], [3, 5]] };

const recorded = (side: "a" | "b", score: MatchScore = WIN_A, when = T0): ResultEvent => ({ kind: "result_recorded", side, at: when, score });
const confirmed = (side: "a" | "b", when = at("2026-11-13", 9)): ResultEvent => ({ kind: "result_confirmed", side, at: when });
const disputed = (side: "a" | "b", score: MatchScore | null = WIN_B, when = at("2026-11-13", 9)): ResultEvent => ({
  kind: "result_disputed",
  side,
  at: when,
  score,
});

describe("resultState (spec 7, #28)", () => {
  it("no log: no result", () => {
    expect(resultState([])).toEqual({ status: "none" });
  });

  it("a recorded result waits for the other pair", () => {
    expect(resultState([recorded("a")])).toEqual({ status: "recorded", by: "a", score: WIN_A, at: T0 });
  });

  it("the other pair confirms: final, played with the recorded score", () => {
    expect(resultState([recorded("b", SPLIT), confirmed("a")])).toEqual({
      status: "final",
      outcome: { kind: "played", score: SPLIT },
      how: "confirmed",
      at: at("2026-11-13", 9),
    });
  });

  it("confirming your own result changes nothing", () => {
    expect(resultState([recorded("a"), confirmed("a")]).status).toBe("recorded");
  });

  it("the other pair disputes: both versions are kept and nothing counts", () => {
    expect(resultState([recorded("a"), disputed("b")])).toEqual({
      status: "disputed",
      by: "a",
      score: WIN_A,
      at: T0,
      counter: WIN_B,
      disputedAt: at("2026-11-13", 9),
    });
  });

  it("disputing your own result changes nothing", () => {
    expect(resultState([recorded("a"), disputed("a")]).status).toBe("recorded");
  });

  it("the recording pair may correct its result while it waits; the clock restarts", () => {
    const later = at("2026-11-12", 22);
    expect(resultState([recorded("a"), recorded("a", SPLIT, later)])).toEqual({ status: "recorded", by: "a", score: SPLIT, at: later });
  });

  it("the other pair can't record over a waiting result: it confirms or disputes", () => {
    expect(resultState([recorded("a"), recorded("b", WIN_B)])).toMatchObject({ status: "recorded", by: "a", score: WIN_A });
  });

  it("nothing changes a confirmed or disputed result but a ruling", () => {
    expect(resultState([recorded("a"), confirmed("b"), recorded("b", WIN_B), disputed("a")])).toMatchObject({ status: "final", how: "confirmed" });
    expect(resultState([recorded("a"), disputed("b"), confirmed("b"), recorded("a", SPLIT)])).toMatchObject({ status: "disputed", score: WIN_A });
  });

  it("a recorded event without a score is ignored", () => {
    expect(resultState([{ kind: "result_recorded", side: "a", at: T0 }])).toEqual({ status: "none" });
  });

  it("a confirmation or dispute without a result is ignored", () => {
    expect(resultState([confirmed("a"), disputed("b")])).toEqual({ status: "none" });
  });

  it("a dispute without its own version still goes to the organizer", () => {
    expect(resultState([recorded("a"), disputed("b", null)])).toMatchObject({ status: "disputed", counter: null });
  });
});

describe("rulings (#28 auto-accept, #29 organizer)", () => {
  const ruling = (kind: Ruling["kind"], outcome: Ruling["outcome"], when = at("2026-11-15", 10)): Ruling => ({ kind, outcome, at: when });

  it("the auto-accept makes the waiting result final", () => {
    expect(resultState([recorded("a")], [ruling("auto_accepted", { kind: "played", score: WIN_A })])).toMatchObject({
      status: "final",
      how: "auto_accepted",
      outcome: { kind: "played", score: WIN_A },
    });
  });

  it("the organizer decides a dispute", () => {
    expect(resultState([recorded("a"), disputed("b")], [ruling("organizer", { kind: "played", score: SPLIT })])).toMatchObject({
      status: "final",
      how: "organizer",
      outcome: { kind: "played", score: SPLIT },
    });
  });

  it("the organizer overrides a confirmed result, and the latest ruling wins", () => {
    const rulings = [ruling("organizer", { kind: "walkover", winner: "b" }), ruling("organizer", { kind: "unplayed" }, at("2026-11-16", 10))];
    expect(resultState([recorded("a"), confirmed("b")], rulings)).toEqual({
      status: "final",
      outcome: { kind: "unplayed" },
      how: "organizer",
      at: at("2026-11-16", 10),
    });
  });

  it("the organizer sets an outcome without any result (both inactive)", () => {
    expect(resultState([], [ruling("organizer", { kind: "both-inactive" })])).toMatchObject({ status: "final", outcome: { kind: "both-inactive" } });
  });
});

describe("resultActions (#28)", () => {
  it("no result: either pair records", () => {
    for (const side of ["a", "b"] as const) expect(resultActions({ status: "none" }, side)).toEqual({ record: true, confirm: false, dispute: false });
  });

  it("waiting: the recorder may correct, the other pair confirms or disputes", () => {
    const s = resultState([recorded("a")]);
    expect(resultActions(s, "a")).toEqual({ record: true, confirm: false, dispute: false });
    expect(resultActions(s, "b")).toEqual({ record: false, confirm: true, dispute: true });
  });

  it("disputed or final: no player step", () => {
    const none = { record: false, confirm: false, dispute: false };
    for (const s of [resultState([recorded("a"), disputed("b")]), resultState([recorded("a"), confirmed("b")])])
      for (const side of ["a", "b"] as const) expect(resultActions(s, side)).toEqual(none);
  });

  it("only the other pair is waited on", () => {
    expect(resultWaitingFor(resultState([recorded("b")]))).toEqual(["a"]);
    expect(resultWaitingFor({ status: "none" })).toEqual([]);
    expect(resultWaitingFor(resultState([recorded("b"), disputed("a")]))).toEqual([]);
  });
});

describe("auto-accept after 48 hours (spec 7, #28)", () => {
  const s = resultState([recorded("a")]);
  const due = new Date(T0.getTime() + AUTO_ACCEPT_HOURS * 3600_000);

  it("is due exactly 48 hours after recording, not a minute before", () => {
    expect(autoAcceptAt(s)).toEqual(due);
    expect(autoAcceptDue(s, new Date(due.getTime() - 60_000))).toBe(false);
    expect(autoAcceptDue(s, due)).toBe(true);
    expect(autoAcceptDue(s, new Date(due.getTime() + 3600_000))).toBe(true);
  });

  it("counts from the correction, not the first record", () => {
    const corrected = resultState([recorded("a"), recorded("a", SPLIT, at("2026-11-13", 20))]);
    expect(autoAcceptDue(corrected, due)).toBe(false);
    expect(autoAcceptDue(corrected, at("2026-11-15", 20))).toBe(true);
  });

  it("never for a disputed, confirmed or missing result", () => {
    const late = at("2026-12-01", 12);
    expect(autoAcceptDue(resultState([recorded("a"), disputed("b")]), late)).toBe(false);
    expect(autoAcceptDue(resultState([recorded("a"), confirmed("b")]), late)).toBe(false);
    expect(autoAcceptDue({ status: "none" }, late)).toBe(false);
    expect(autoAcceptAt({ status: "none" })).toBeNull();
  });

  it("across the daylight-saving change it is still 48 real hours", () => {
    // Sat 24 Oct 2026 20:00 CEST (18:00 UTC); clocks go back on Sunday.
    const before = resultState([recorded("a", WIN_A, at("2026-10-24", 20))]);
    expect(autoAcceptAt(before)!.toISOString()).toBe("2026-10-26T18:00:00.000Z");
  });
});

describe("disputeErrors (#28)", () => {
  it("accepts a different valid version", () => {
    expect(disputeErrors(WIN_A, WIN_B)).toEqual([]);
  });

  it("refuses an invalid version with the engine's Hungarian message", () => {
    expect(disputeErrors(WIN_A, { sets: [[4, 3], [4, 0]] })).toEqual(["1. szett: 4:3 nem lehet. Lehet 4:0, 4:1, 4:2, 5:3 vagy (tie-break után) 5:4."]);
  });

  it("refuses the same score: that is a confirmation", () => {
    expect(disputeErrors(SPLIT, { sets: [[4, 1], [2, 4]], superTieBreak: [10, 8] })).toEqual([
      "Ez ugyanaz az eredmény, amit rögzítettek: erősítsd meg inkább.",
    ]);
  });
});

describe("sameScore and flipScore", () => {
  it("compares set by set, including the super tie-break", () => {
    expect(sameScore(SPLIT, { sets: [[4, 1], [2, 4]], superTieBreak: [10, 8] })).toBe(true);
    expect(sameScore(SPLIT, { sets: [[4, 1], [2, 4]], superTieBreak: [12, 10] })).toBe(false);
    expect(sameScore(WIN_A, flipScore(WIN_A))).toBe(false);
  });

  it("turns every set round", () => {
    expect(flipScore(SPLIT)).toEqual({ sets: [[1, 4], [4, 2]], superTieBreak: [8, 10] });
    expect(flipScore(WIN_A)).toEqual({ sets: [[1, 4], [2, 4]] });
  });
});

describe("decisionErrors (#29)", () => {
  it("an override without a reason is refused", () => {
    expect(decisionErrors({ kind: "walkover", winner: "a" }, "  ")).toEqual(["Írd meg az indoklást: a döntés a meccs naplójába kerül."]);
  });

  it("a too long reason is refused", () => {
    expect(decisionErrors({ kind: "unplayed" }, "x".repeat(501))).toEqual(["Az indoklás legfeljebb 500 karakter legyen."]);
  });

  it("a played outcome needs a valid score", () => {
    expect(decisionErrors({ kind: "played", score: { sets: [[4, 1], [2, 4]] } }, "Mindkét pár képet küldött")).toEqual([
      "1:1-es szettállásnál add meg a szuper tie-break eredményét.",
    ]);
  });

  it("every outcome with a reason is accepted", () => {
    for (const outcome of [
      { kind: "played", score: SPLIT },
      { kind: "walkover", winner: "b" },
      { kind: "both-inactive" },
      { kind: "unplayed" },
    ] as const)
      expect(decisionErrors(outcome, "A napló alapján")).toEqual([]);
  });
});
