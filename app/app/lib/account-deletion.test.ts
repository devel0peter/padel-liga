import { describe, expect, it } from "vitest";

import { anonymizedEmail, deletionPlan, isAnonymizedEmail, mailNamesPerson, type DeletionCheck } from "./account-deletion";

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

describe("mailNamesPerson", () => {
  const anna = { email: "a@x.hu", name: "Anna Teszt" };
  const mail = (kind: string, text: string | null) => ({ kind, text });

  it("finds their address as a whole address, in any kind", () => {
    expect(mailNamesPerson(mail("pair_intro", "Az e-mail-címe: a@x.hu\nÍrj neki."), anna)).toBe(true);
    expect(mailNamesPerson(mail("broadcast", "a@x.hu"), anna)).toBe(true);
    expect(mailNamesPerson(mail("pair_intro", "Írj: A@X.HU."), anna)).toBe(true);
    // Not the end of another address, nor the start of a longer one.
    expect(mailNamesPerson(mail("pair_intro", "Az e-mail-címe: anna@x.hu"), anna)).toBe(false);
    expect(mailNamesPerson(mail("pair_intro", "Az e-mail-címe: maria.a@x.hu"), anna)).toBe(false);
    expect(mailNamesPerson(mail("pair_intro", "Az e-mail-címe: a@x.hun"), anna)).toBe(false);
    expect(mailNamesPerson(mail("pair_intro", "Az e-mail-címe: a@x.hu.com"), anna)).toBe(false);
  });

  it("finds their name as whole words, only in kinds that name others", () => {
    expect(mailNamesPerson(mail("groups_published", "1. hét: Anna Teszt és Béla ellen"), anna)).toBe(true);
    expect(mailNamesPerson(mail("match_proposal", "Anna Teszt, Béla"), anna)).toBe(true);
    expect(mailNamesPerson(mail("groups_published", "1. hét: Anna Tesztelő és Béla ellen"), anna)).toBe(false);
    // A broadcast names only its recipient, who may have the same name.
    expect(mailNamesPerson(mail("broadcast", "Szia Anna Teszt!"), anna)).toBe(false);
    expect(mailNamesPerson(mail("groups_published", null), anna)).toBe(false);
  });

  it("skips the greeting: a namesake's own mail isn't about them", () => {
    expect(mailNamesPerson(mail("groups_published", "Szia Anna Teszt!\n\n1. hét: Cili és Dóra ellen"), anna)).toBe(false);
    expect(mailNamesPerson(mail("match_tomorrow", "Szia Anna Teszt!\n\nHolnap játszotok Cili és Dóra ellen"), anna)).toBe(false);
    // The name after the greeting still counts, also in the same line.
    expect(mailNamesPerson(mail("groups_published", "Szia Anna Teszt!\n\n1. hét: Anna Teszt és Béla ellen"), anna)).toBe(true);
    expect(mailNamesPerson(mail("season_entry_decision", "Szia B! Anna Teszt és te nevezhettek."), anna)).toBe(true);
    expect(mailNamesPerson(mail("match_result", "Szia B!\n\nAnna Teszt és Béla rögzítette"), anna)).toBe(true);
    expect(mailNamesPerson(mail("stuck_reminder", "Szia!\n\nAnna Teszt már regisztrált, csak rád vár."), anna)).toBe(true);
  });

  it("doesn't match a name under 3 letters, or regex characters as such", () => {
    expect(mailNamesPerson(mail("groups_published", "Al és Béla"), { email: "z@x.hu", name: "Al" })).toBe(false);
    expect(mailNamesPerson(mail("groups_published", "Kis Béla ellen"), { email: "z@x.hu", name: "K.s Béla" })).toBe(false);
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
