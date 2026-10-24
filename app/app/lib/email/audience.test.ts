import { describe, expect, it } from "vitest";

import { audienceLabel, inviteRecipients, signupRecipients, type InviteCandidate } from "./audience";

const GYOR = [{ slug: "gyor", name: "Győr" }];

const none = { city: "", status: "", level: "", mode: "", ref: "", club: "", q: "" };

describe("signupRecipients", () => {
  it("takes only the signer, never the partner", () => {
    const { recipients } = signupRecipients([{ name1: "Anna", email1: "anna@example.com" }], new Set());
    expect(recipients).toEqual([{ name: "Anna", email: "anna@example.com" }]);
  });

  it("dedupes addresses case-insensitively, keeping the first", () => {
    const { recipients } = signupRecipients(
      [
        { name1: "Anna", email1: "anna@example.com" },
        { name1: "Anna 2", email1: "ANNA@example.com" },
      ],
      new Set(),
    );
    expect(recipients).toEqual([{ name: "Anna", email: "anna@example.com" }]);
  });

  it("skips and counts unsubscribed addresses", () => {
    const r = signupRecipients(
      [
        { name1: "Anna", email1: "anna@example.com" },
        { name1: "Béla", email1: "bela@example.com" },
      ],
      new Set(["bela@example.com"]),
    );
    expect(r.recipients.map((x) => x.email)).toEqual(["anna@example.com"]);
    expect(r.suppressed).toBe(1);
  });
});

describe("audienceLabel", () => {
  it("says everyone without filters", () => {
    expect(audienceLabel(none)).toBe("Minden jelentkező");
  });

  it("lists the filters in Hungarian", () => {
    expect(audienceLabel({ ...none, city: "gyor", status: "new", level: "kezdo", mode: "solo" }, GYOR)).toBe(
      "Jelentkezők: Győr · Új · Kezdő · Egyéni",
    );
    expect(audienceLabel({ ...none, city: "other", q: "pécs" })).toBe("Jelentkezők: Más város · „pécs”");
    expect(audienceLabel({ ...none, ref: "gyp" })).toBe("Jelentkezők: Forrás: gyp");
    expect(audienceLabel({ ...none, ref: "none" })).toBe("Jelentkezők: Forrás nélkül");
    expect(audienceLabel({ ...none, club: "gyp" })).toBe("Jelentkezők: Klub: gyp");
  });
});

describe("inviteRecipients", () => {
  const row = (over: Partial<InviteCandidate> = {}): InviteCandidate => ({
    name1: "Anna",
    email1: "anna@example.com",
    city: "gyor",
    status: "new",
    invitedAt: null,
    ...over,
  });
  const ctx = { leagueCities: new Set(["gyor"]), suppressed: new Set<string>(), accounts: new Set<string>() };
  const emails = (rows: InviteCandidate[], c = ctx) => inviteRecipients(rows, c).map((r) => r.email);

  it("invites the signer by name, never the partner entered on the form", () => {
    const pair = { ...row(), mode: "pair", name2: "Béla", email2: "bela@example.com" };
    expect(inviteRecipients([pair], ctx)).toEqual([{ name: "Anna", email: "anna@example.com" }]);
  });

  it("invites each address once, case-insensitively", () => {
    expect(emails([row(), row({ email1: "ANNA@example.com", name1: "Anna 2" })])).toEqual(["anna@example.com"]);
  });

  it("includes solo signups", () => {
    expect(emails([row({ email1: "solo@example.com" })])).toEqual(["solo@example.com"]);
  });

  it("skips signups in a city without a league, and 'other' cities", () => {
    expect(emails([row({ city: "pecs" }), row({ city: "other", email1: "b@example.com" })])).toEqual([]);
  });

  it("skips withdrawn signups", () => {
    expect(emails([row({ status: "withdrawn" })])).toEqual([]);
    expect(emails([row({ status: "contacted" }), row({ status: "paired", email1: "b@example.com" })])).toEqual([
      "anna@example.com",
      "b@example.com",
    ]);
  });

  it("skips unsubscribed or bounced addresses", () => {
    expect(emails([row()], { ...ctx, suppressed: new Set(["anna@example.com"]) })).toEqual([]);
  });

  it("skips addresses that already have an account", () => {
    expect(emails([row({ email1: "Anna@Example.com" })], { ...ctx, accounts: new Set(["anna@example.com"]) })).toEqual([]);
  });

  it("skips an address already invited, through any of its signups", () => {
    const invitedAt = new Date("2026-11-02T08:00:00Z");
    expect(emails([row({ invitedAt })])).toEqual([]);
    // A second signup of the same address (e.g. another city) doesn't bring it back.
    expect(emails([row(), row({ email1: "ANNA@example.com", city: "pecs", invitedAt })])).toEqual([]);
  });
});
