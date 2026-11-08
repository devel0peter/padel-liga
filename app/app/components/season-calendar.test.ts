import { describe, expect, it } from "vitest";

import { currentPhase } from "./season-calendar";

const d = (iso: string) => new Date(iso);
const PHASES = [
  { number: 1, startsAt: d("2026-10-25T23:00:00Z"), deadline: d("2026-11-15T22:59:00Z") },
  { number: 2, startsAt: d("2026-11-15T23:00:00Z"), deadline: d("2026-12-06T22:59:00Z") },
];

describe("currentPhase (D139): the round marked on Kezdőlap", () => {
  it("is the round whose start has come and whose deadline hasn't passed", () => {
    expect(currentPhase(PHASES, d("2026-11-08T10:00:00Z"))).toBe(1);
    expect(currentPhase(PHASES, d("2026-11-15T22:59:00Z"))).toBe(1);
    expect(currentPhase(PHASES, d("2026-11-15T23:00:00Z"))).toBe(2);
  });

  it("is none before the season and after its end", () => {
    expect(currentPhase(PHASES, d("2026-10-20T10:00:00Z"))).toBeNull();
    expect(currentPhase(PHASES, d("2026-12-07T10:00:00Z"))).toBeNull();
    expect(currentPhase([], d("2026-11-08T10:00:00Z"))).toBeNull();
  });
});
