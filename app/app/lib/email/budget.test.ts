import { describe, expect, it } from "vitest";

import { BULK_KINDS, DEFAULT_DAILY_LIMIT, LOGIN_RESERVE, parseDailyLimit, sendBudget, TRANSACTIONAL_RESERVE } from "./budget";

describe("sendBudget", () => {
  it("gives login codes the whole remaining quota", () => {
    expect(sendBudget(100, 40, "login_code")).toBe(60);
    expect(sendBudget(100, 99, "login_code")).toBe(1);
  });

  it("keeps a reserve for login codes free from other transactional emails", () => {
    expect(sendBudget(100, 40, "signup_confirmation")).toBe(60 - LOGIN_RESERVE);
    expect(sendBudget(100, 100 - LOGIN_RESERVE, "partner_notice")).toBe(0);
    expect(sendBudget(100, 100 - LOGIN_RESERVE, "login_code")).toBe(LOGIN_RESERVE);
  });

  it("keeps a reserve free from broadcasts", () => {
    expect(sendBudget(100, 0, "broadcast")).toBe(100 - TRANSACTIONAL_RESERVE);
    expect(sendBudget(100, 100 - TRANSACTIONAL_RESERVE, "broadcast")).toBe(0);
  });

  it("treats registration invites as bulk mail, behind the same reserve as broadcasts", () => {
    expect(sendBudget(100, 0, "registration_invite")).toBe(100 - TRANSACTIONAL_RESERVE);
    expect(sendBudget(100, 100 - TRANSACTIONAL_RESERVE, "registration_invite")).toBe(0);
    expect(BULK_KINDS).toEqual(["broadcast", "registration_invite"]);
  });

  it("treats pair invites and answers as transactional: behind login codes, ahead of bulk mail", () => {
    expect(sendBudget(100, 40, "pair_invite")).toBe(60 - LOGIN_RESERVE);
    expect(sendBudget(100, 40, "pair_answer")).toBe(60 - LOGIN_RESERVE);
    expect(sendBudget(100, 100 - TRANSACTIONAL_RESERVE, "pair_invite")).toBe(TRANSACTIONAL_RESERVE - LOGIN_RESERVE);
  });

  it("never goes negative", () => {
    expect(sendBudget(100, 150, "signup_confirmation")).toBe(0);
    expect(sendBudget(100, 150, "login_code")).toBe(0);
    expect(sendBudget(100, 95, "broadcast")).toBe(0);
  });
});

describe("parseDailyLimit", () => {
  it("reads a positive integer and falls back to 2,000 (#111)", () => {
    expect(DEFAULT_DAILY_LIMIT).toBe(2000);
    expect(parseDailyLimit("3000")).toBe(3000);
    for (const v of [undefined, "", "abc", "0", "-5", "1.5"]) expect(parseDailyLimit(v)).toBe(2000);
  });
});

describe("the 2,000 a day limit (#111)", () => {
  it("still keeps the login code reserve and the send order", () => {
    // Bulk mail stops 15 short, other transactional mail 10 short: those are
    // left for login codes.
    expect(sendBudget(2000, 1990, "signup_confirmation")).toBe(0);
    expect(sendBudget(2000, 1985, "broadcast")).toBe(0);
    expect(sendBudget(2000, 1990, "login_code")).toBe(LOGIN_RESERVE);
    expect(sendBudget(2000, 0, "broadcast")).toBe(2000 - TRANSACTIONAL_RESERVE);
  });
});
