import { describe, expect, it } from "vitest";

import type { MatchScore, ResultState, SchedulingState } from "@padel-liga/rules";

import { doneText, homeTodo, homeTodos, matchPill, matchScore, matchWhen, nextRound, roundClock, type MatchLike } from "./home";

const at = (iso: string) => new Date(iso);
const score: MatchScore = { sets: [[4, 5], [2, 4]] };
const tieBreak: MatchScore = { sets: [[1, 4], [4, 2]], superTieBreak: [8, 10] };

const match = (over: Partial<MatchLike> = {}): MatchLike => ({
  id: 7,
  week: 2,
  opponents: "Horváth / Molnár",
  side: "a",
  state: { status: "to_schedule" },
  result: { status: "none" },
  setGames: 4,
  ...over,
});

const recorded = (by: "a" | "b"): ResultState => ({ status: "recorded", by, score, at: at("2026-11-27T10:54:00Z") });
const final = (outcome: Extract<ResultState, { status: "final" }>["outcome"]): ResultState => ({ status: "final", outcome, how: "confirmed", at: at("2026-11-20T10:00:00Z") });
const proposed = (by: "a" | "b"): SchedulingState => ({ status: "proposed", by, ranges: [], clubId: null, at: at("2026-11-26T10:00:00Z") });
const agreed = (by: "a" | "b"): SchedulingState => ({
  status: "agreed_time",
  by,
  slot: at("2026-12-01T18:00:00Z"),
  clubId: null,
  at: at("2026-11-26T10:00:00Z"),
  fixesAt: at("2026-11-27T10:00:00Z"),
});
const scheduled: SchedulingState = { status: "scheduled", slot: at("2026-12-01T18:00:00Z"), clubId: null };

describe("matchPill", () => {
  it("needs a time: blue, also when the opponents' offer waits", () => {
    expect(matchPill(match())).toEqual({ tone: "info", label: "Időpont kell" });
    expect(matchPill(match({ state: proposed("b") }))).toEqual({ tone: "info", label: "Időpont kell" });
  });

  it("waits on the other pair: neutral", () => {
    expect(matchPill(match({ state: proposed("a") }))).toEqual({ tone: "neutral", label: "Ellenfélre vár" });
    expect(matchPill(match({ state: agreed("a") }))).toEqual({ tone: "neutral", label: "Ellenfélre vár" });
    expect(matchPill(match({ state: { status: "to_schedule", nextBy: "b" } }))).toEqual({ tone: "neutral", label: "Ellenfélre vár" });
    expect(matchPill(match({ state: scheduled, result: recorded("a") }))).toEqual({ tone: "neutral", label: "Ellenfélre vár" });
  });

  it("after a late cancellation by the own pair a time is needed again", () => {
    expect(matchPill(match({ state: { status: "to_schedule", nextBy: "a" } }))).toEqual({ tone: "info", label: "Időpont kell" });
  });

  it("an agreed time or a result of theirs waits on the player: amber", () => {
    expect(matchPill(match({ state: agreed("b") }))).toEqual({ tone: "warning", label: "Megbeszélt időpont" });
    expect(matchPill(match({ state: scheduled, result: recorded("b") }))).toEqual({ tone: "warning", label: "Megerősítésre vár" });
  });

  it("a fixed time is neutral, a dispute red", () => {
    expect(matchPill(match({ state: scheduled }))).toEqual({ tone: "neutral", label: "Fix időpont" });
    expect(matchPill(match({ result: { status: "disputed", by: "a", score, at: at("2026-11-27T10:00:00Z"), counter: null, disputedAt: at("2026-11-27T11:00:00Z") } }))).toEqual({
      tone: "danger",
      label: "Vitatott",
    });
  });

  it("a final result: won green, lost red (both losing too), unplayed neutral", () => {
    const won: MatchScore = { sets: [[4, 2], [4, 1]] };
    expect(matchPill(match({ result: final({ kind: "played", score: won }) }))).toEqual({ tone: "success", label: "Győzelem" });
    expect(matchPill(match({ side: "b", result: final({ kind: "played", score: won }) }))).toEqual({ tone: "danger", label: "Vereség" });
    expect(matchPill(match({ result: final({ kind: "walkover", winner: "a" }) }))).toEqual({ tone: "success", label: "Győzelem" });
    expect(matchPill(match({ result: final({ kind: "both-inactive" }) }))).toEqual({ tone: "danger", label: "Vereség" });
    expect(matchPill(match({ result: final({ kind: "unplayed" }) }))).toEqual({ tone: "neutral", label: "Elmaradt" });
  });
});

describe("matchScore", () => {
  it("is the player's side first, the super tie-break as a third pair", () => {
    expect(matchScore(match({ result: recorded("b") }))).toBe("4:5, 2:4");
    expect(matchScore(match({ side: "b", result: recorded("a") }))).toBe("5:4, 4:2");
    expect(matchScore(match({ result: final({ kind: "played", score: tieBreak }) }))).toBe("1:4, 4:2, 8:10");
  });

  it("a walkover and both losing in the round's set format; none without a result or unplayed", () => {
    expect(matchScore(match({ result: final({ kind: "walkover", winner: "a" }) }))).toBe("4:0, 4:0");
    expect(matchScore(match({ setGames: 6, result: final({ kind: "walkover", winner: "b" }) }))).toBe("0:6, 0:6");
    expect(matchScore(match({ result: final({ kind: "both-inactive" }) }))).toBe("0:4, 0:4");
    expect(matchScore(match({ result: final({ kind: "unplayed" }) }))).toBeNull();
    expect(matchScore(match())).toBeNull();
  });
});

describe("matchWhen", () => {
  const start = at("2026-11-15T23:00:00Z");
  it("is the week without a time, the start once fixed or agreed", () => {
    expect(matchWhen(match({ week: 3 }), start)).toBe("nov. 30. – dec. 6.");
    expect(matchWhen(match({ state: scheduled }), start)).toBe("dec. 1., kedd 19:00");
    expect(matchWhen(match({ state: agreed("b") }), start)).toBe("dec. 1., kedd 19:00");
  });
});

describe("homeTodo", () => {
  it("the opponents' result is confirmed on the card, with the score and when it is accepted by itself", () => {
    expect(homeTodo(match({ state: scheduled, result: recorded("b") }))).toEqual({
      matchId: 7,
      kind: "confirm",
      title: "Erősítsd meg az eredményt",
      description: "Horváth / Molnár ellen:",
      score: "4:5, 2:4",
      note: "nov. 29., vasárnap 11:54 után magától elfogadjuk.",
    });
  });

  it("nothing waits on the player for their own result, a dispute or a final one", () => {
    expect(homeTodo(match({ result: recorded("a") }))).toBeNull();
    expect(homeTodo(match({ result: final({ kind: "unplayed" }) }))).toBeNull();
    expect(homeTodo(match({ result: { status: "disputed", by: "b", score, at: at("2026-11-27T10:00:00Z"), counter: null, disputedAt: at("2026-11-27T11:00:00Z") } }))).toBeNull();
  });

  it("scheduling steps lead to the match page", () => {
    expect(homeTodo(match())).toMatchObject({ kind: "open", title: "Ajánlj időpontot", description: "Horváth / Molnár ellen", note: null });
    expect(homeTodo(match({ state: proposed("b") }))).toMatchObject({ kind: "open", title: "Válassz időpontot", description: "Horváth / Molnár időpontokat ajánlott" });
    expect(homeTodo(match({ state: agreed("b") }))).toMatchObject({
      kind: "open",
      title: "Nézd meg a megbeszélt időpontot",
      description: "Horváth / Molnár: dec. 1., kedd 19:00",
      note: "nov. 27., péntek 11:00-kor magától fix lesz.",
    });
  });

  it("none while the other pair has the next step, or the time is fixed", () => {
    expect(homeTodo(match({ state: proposed("a") }))).toBeNull();
    expect(homeTodo(match({ state: agreed("a") }))).toBeNull();
    expect(homeTodo(match({ state: scheduled }))).toBeNull();
    expect(homeTodo(match({ state: { status: "to_schedule", nextBy: "b" } }))).toBeNull();
    expect(homeTodo(match({ state: { status: "to_schedule", nextBy: "a" } }))).not.toBeNull();
  });

  it("homeTodos keeps the matches' order and skips the ones without a step", () => {
    expect(homeTodos([match({ id: 1, state: scheduled }), match({ id: 2 }), match({ id: 3, state: proposed("b") })]).map((t) => t.matchId)).toEqual([2, 3]);
  });
});

describe("roundClock", () => {
  const start = at("2026-11-15T23:00:00Z");
  const deadline = at("2026-12-06T22:59:00Z");
  it("counts whole Budapest days to the deadline's day and the share of time gone", () => {
    const c = roundClock(start, deadline, at("2026-11-27T12:00:00Z"));
    expect(c.daysLeft).toBe(9);
    expect(c.progress).toBeGreaterThan(0.5);
    expect(c.progress).toBeLessThan(0.6);
  });

  it("is 0 days on the deadline's day and stays within 0 and 1", () => {
    expect(roundClock(start, deadline, at("2026-12-06T08:00:00Z")).daysLeft).toBe(0);
    expect(roundClock(start, deadline, at("2026-12-08T08:00:00Z"))).toEqual({ daysLeft: 0, progress: 1 });
    expect(roundClock(start, deadline, at("2026-11-10T08:00:00Z")).progress).toBe(0);
  });
});

describe("doneText", () => {
  it("counts the final results", () => {
    expect(doneText([match({ result: final({ kind: "unplayed" }) }), match({ result: recorded("a") }), match()])).toBe("1 / 3 meccsetek kész");
  });
});

describe("nextRound", () => {
  const window = { round: 1, nextRound: 2, deadline: at("2026-12-06T22:59:00Z"), nextStart: at("2026-12-06T23:00:00Z") };
  it("says the pair is in, opted out, or left, and links to the league's card", () => {
    expect(nextRound({ kind: "in", window }, "minta")).toEqual({
      tone: "success",
      title: "Benne vagytok a 2. körben",
      detail: "dec. 7-től, nem kell tenned semmit",
      to: "/leagues/minta",
    });
    expect(nextRound({ kind: "out", window, mine: false }, "minta")).toMatchObject({ tone: "warning", title: "Nem folytatjátok" });
    expect(nextRound({ kind: "left", round: 1 }, "minta")).toMatchObject({ tone: "warning", detail: null });
  });
});
