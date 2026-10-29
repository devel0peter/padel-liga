import { describe, expect, it } from "vitest";

import {
  BULK_KINDS,
  effectiveDailyLimit,
  LOGIN_RESERVE,
  parseDailyLimit,
  RELAY_DAILY_LIMIT,
  RESEND_DAILY_LIMIT,
  sendBudget,
  TRANSACTIONAL_RESERVE,
} from "./budget";

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
  it("reads a positive integer and falls back to Resend's 100", () => {
    expect(RESEND_DAILY_LIMIT).toBe(100);
    expect(parseDailyLimit("3000")).toBe(3000);
    for (const v of [undefined, "", "abc", "0", "-5", "1.5"]) expect(parseDailyLimit(v)).toBe(100);
  });
});

describe("effectiveDailyLimit (#111, #127)", () => {
  it("is 5,000 with the SMTP relay", () => {
    expect(RELAY_DAILY_LIMIT).toBe(5000);
    expect(effectiveDailyLimit(true, "100")).toBe(5000);
    expect(effectiveDailyLimit(true, undefined)).toBe(5000);
  });

  it("stays Resend-safe without the relay: EMAIL_DAILY_LIMIT, else 100", () => {
    expect(effectiveDailyLimit(false, "100")).toBe(100);
    expect(effectiveDailyLimit(false, undefined)).toBe(100);
    expect(effectiveDailyLimit(false, "1000")).toBe(1000);
  });

  it("keeps the login code reserve without the relay: bulk and personal mail stop short of Resend's 100", () => {
    const limit = effectiveDailyLimit(false, undefined);
    expect(sendBudget(limit, 100 - LOGIN_RESERVE, "pair_intro")).toBe(0);
    expect(sendBudget(limit, 100 - TRANSACTIONAL_RESERVE, "broadcast")).toBe(0);
    expect(sendBudget(limit, 100 - LOGIN_RESERVE, "login_code")).toBe(LOGIN_RESERVE);
  });
});

describe("the 5,000 a day limit (#111, #127)", () => {
  it("still keeps the login code reserve and the send order", () => {
    // Bulk mail stops 15 short, other transactional mail 10 short: those are
    // left for login codes.
    expect(sendBudget(5000, 4990, "signup_confirmation")).toBe(0);
    expect(sendBudget(5000, 4985, "broadcast")).toBe(0);
    expect(sendBudget(5000, 4990, "login_code")).toBe(LOGIN_RESERVE);
    expect(sendBudget(5000, 0, "broadcast")).toBe(5000 - TRANSACTIONAL_RESERVE);
  });
});
