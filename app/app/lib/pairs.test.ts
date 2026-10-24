import { describe, expect, it } from "vitest";

import { randomToken } from "./auth/tokens";
import {
  canCancel,
  canDissolve,
  checkAnswer,
  checkInvite,
  inviteLink,
  isInviteToken,
  MAX_INVITES_PER_DAY,
  type AnswerCheck,
  type InviteCheck,
} from "./pairs";

const invite = (over: Partial<InviteCheck> = {}): InviteCheck => ({
  inviterEmail: "anna@example.com",
  inviteeEmail: "bela@example.com",
  inviterPaired: false,
  inviteePaired: false,
  pendingOutgoing: false,
  sentLastDay: 0,
  ...over,
});

describe("checkInvite", () => {
  it("allows an invite and normalizes the address", () => {
    expect(checkInvite(invite({ inviteeEmail: "  Bela@Example.COM " }))).toEqual({ ok: true, email: "bela@example.com" });
  });

  it("refuses an invalid address", () => {
    expect(checkInvite(invite({ inviteeEmail: "bela" }))).toEqual({ ok: false, reason: "email" });
    expect(checkInvite(invite({ inviteeEmail: "" }))).toEqual({ ok: false, reason: "email" });
  });

  it("refuses inviting yourself, whatever the case", () => {
    expect(checkInvite(invite({ inviteeEmail: "ANNA@example.com" }))).toEqual({ ok: false, reason: "self" });
  });

  it("refuses when the inviter already has an active pair in the league", () => {
    expect(checkInvite(invite({ inviterPaired: true }))).toEqual({ ok: false, reason: "inviter_paired" });
  });

  it("refuses an invite to someone already in an active pair in the league", () => {
    expect(checkInvite(invite({ inviteePaired: true }))).toEqual({ ok: false, reason: "invitee_paired" });
  });

  it("allows only one pending outgoing invite per league", () => {
    expect(checkInvite(invite({ pendingOutgoing: true }))).toEqual({ ok: false, reason: "already_inviting" });
  });

  it("limits invites per day", () => {
    expect(checkInvite(invite({ sentLastDay: MAX_INVITES_PER_DAY - 1 })).ok).toBe(true);
    expect(checkInvite(invite({ sentLastDay: MAX_INVITES_PER_DAY }))).toEqual({ ok: false, reason: "too_many" });
  });
});

const answer = (over: Partial<AnswerCheck> = {}): AnswerCheck => ({
  status: "pending",
  inviteeEmail: "bela@example.com",
  userEmail: "bela@example.com",
  inviterPaired: false,
  userPaired: false,
  ...over,
});

describe("checkAnswer", () => {
  it("lets the invitee accept or decline a pending invite", () => {
    expect(checkAnswer(answer(), "accept")).toBeNull();
    expect(checkAnswer(answer(), "decline")).toBeNull();
  });

  it("matches the address case-insensitively", () => {
    expect(checkAnswer(answer({ userEmail: "Bela@Example.com" }), "accept")).toBeNull();
  });

  it("refuses anyone but the invitee, even with the link", () => {
    expect(checkAnswer(answer({ userEmail: "cecil@example.com" }), "accept")).toBe("not_yours");
    expect(checkAnswer(answer({ userEmail: "cecil@example.com" }), "decline")).toBe("not_yours");
  });

  it.each(["accepted", "declined", "cancelled"] as const)("refuses an answer to a %s invite", (status) => {
    expect(checkAnswer(answer({ status }), "accept")).toBe("answered");
    expect(checkAnswer(answer({ status }), "decline")).toBe("answered");
  });

  it("refuses accepting when the invitee is already in an active pair in the league", () => {
    expect(checkAnswer(answer({ userPaired: true }), "accept")).toBe("you_paired");
  });

  it("refuses accepting when the inviter paired up with someone else meanwhile", () => {
    expect(checkAnswer(answer({ inviterPaired: true }), "accept")).toBe("inviter_paired");
  });

  it("still lets a paired player decline", () => {
    expect(checkAnswer(answer({ userPaired: true, inviterPaired: true }), "decline")).toBeNull();
  });
});

describe("canCancel", () => {
  it("lets only the inviter cancel a pending invite", () => {
    expect(canCancel({ status: "pending", inviterId: "a" }, "a")).toBe(true);
    expect(canCancel({ status: "pending", inviterId: "a" }, "b")).toBe(false);
  });

  it.each(["accepted", "declined", "cancelled"] as const)("refuses cancelling a %s invite", (status) => {
    expect(canCancel({ status, inviterId: "a" }, "a")).toBe(false);
  });
});

describe("canDissolve", () => {
  const pair = { status: "active" as const, playerA: "a", playerB: "b" };

  it("lets either player dissolve while the pair is in no running group", () => {
    expect(canDissolve(pair, "a", false)).toBe(true);
    expect(canDissolve(pair, "b", false)).toBe(true);
  });

  it("refuses while the pair is in a group of a running phase", () => {
    expect(canDissolve(pair, "a", true)).toBe(false);
  });

  it("refuses someone outside the pair", () => {
    expect(canDissolve(pair, "c", false)).toBe(false);
  });

  it("refuses a pair already dissolved", () => {
    expect(canDissolve({ ...pair, status: "dissolved" }, "a", false)).toBe(false);
  });
});

describe("inviteLink", () => {
  const site = "https://padelparbaj.hu";

  it("sends an account holder straight to the invite", () => {
    expect(inviteLink(site, "tok", { email: "bela@example.com", hasAccount: true })).toBe("https://padelparbaj.hu/pair/invite/tok");
  });

  it("sends someone without an account through the login page, address filled in, back to the invite", () => {
    const url = new URL(inviteLink(site, "tok", { email: "bela+x@example.com", hasAccount: false }));
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("email")).toBe("bela+x@example.com");
    expect(url.searchParams.get("returnTo")).toBe("/pair/invite/tok");
  });
});

describe("isInviteToken", () => {
  it("accepts what randomToken makes", () => {
    expect(isInviteToken(randomToken())).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isInviteToken(undefined)).toBe(false);
    expect(isInviteToken("")).toBe(false);
    expect(isInviteToken("short")).toBe(false);
    expect(isInviteToken(`${randomToken()}x`)).toBe(false);
    expect(isInviteToken("a".repeat(42) + "/")).toBe(false);
  });
});
