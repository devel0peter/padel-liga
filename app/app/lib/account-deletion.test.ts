import { describe, expect, it } from "vitest";

import { anonymizedEmail, deletionPlan, isAnonymizedEmail, type DeletionCheck } from "./account-deletion";

const check = (over: Partial<DeletionCheck> = {}): DeletionCheck => ({
  actorId: "admin",
  target: { id: "p", platformRole: "player" },
  history: false,
  playing: false,
  ...over,
});

describe("deletionPlan", () => {
  it("removes an account without history completely", () => {
    expect(deletionPlan(check())).toEqual({ ok: true, mode: "remove" });
  });

  it("anonymizes an account with history", () => {
    expect(deletionPlan(check({ history: true }))).toEqual({ ok: true, mode: "anonymize" });
  });

  it("refuses while a pair of theirs plays in a running phase", () => {
    expect(deletionPlan(check({ history: true, playing: true }))).toEqual({ ok: false, refusal: "playing" });
  });

  it("refuses the Admin's own account and another Admin's", () => {
    expect(deletionPlan(check({ target: { id: "admin", platformRole: "superadmin" } }))).toEqual({ ok: false, refusal: "self" });
    expect(deletionPlan(check({ target: { id: "other", platformRole: "superadmin" } }))).toEqual({ ok: false, refusal: "admin" });
  });

  it("refuses an account that is gone or already anonymized", () => {
    expect(deletionPlan(check({ target: null }))).toEqual({ ok: false, refusal: "gone" });
  });
});

describe("anonymizedEmail", () => {
  it("is unique per account and undeliverable", () => {
    expect(anonymizedEmail("abc")).toBe("deleted-abc@deleted.invalid");
    expect(anonymizedEmail("abc")).not.toBe(anonymizedEmail("abd"));
  });
});

describe("isAnonymizedEmail", () => {
  it("knows the placeholder, and nothing else", () => {
    expect(isAnonymizedEmail(anonymizedEmail("abc"))).toBe(true);
    expect(isAnonymizedEmail(" Deleted-ABC@Deleted.Invalid ")).toBe(true);
    expect(isAnonymizedEmail("deleted@example.com")).toBe(false);
    expect(isAnonymizedEmail("someone@deleted.invalid.hu")).toBe(false);
  });
});
