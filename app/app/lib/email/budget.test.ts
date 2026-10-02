import { describe, expect, it } from "vitest";

import { parseDailyLimit, sendBudget, TRANSACTIONAL_RESERVE } from "./budget";

describe("sendBudget", () => {
  it("gives signup emails the whole remaining quota", () => {
    expect(sendBudget(100, 40, "signup_confirmation")).toBe(60);
    expect(sendBudget(100, 99, "partner_notice")).toBe(1);
  });

  it("keeps a reserve free from broadcasts", () => {
    expect(sendBudget(100, 0, "broadcast")).toBe(100 - TRANSACTIONAL_RESERVE);
    expect(sendBudget(100, 100 - TRANSACTIONAL_RESERVE, "broadcast")).toBe(0);
  });

  it("never goes negative", () => {
    expect(sendBudget(100, 150, "signup_confirmation")).toBe(0);
    expect(sendBudget(100, 95, "broadcast")).toBe(0);
  });
});

describe("parseDailyLimit", () => {
  it("reads a positive integer and falls back to 100", () => {
    expect(parseDailyLimit("3000")).toBe(3000);
    for (const v of [undefined, "", "abc", "0", "-5", "1.5"]) expect(parseDailyLimit(v)).toBe(100);
  });
});
