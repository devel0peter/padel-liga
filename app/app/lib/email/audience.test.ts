import { describe, expect, it } from "vitest";

import { audienceLabel, signupRecipients } from "./audience";

const none = { city: "", status: "", level: "", mode: "", ref: "", q: "" };

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
    expect(audienceLabel({ ...none, city: "gyor", status: "new", level: "kezdo", mode: "solo" })).toBe(
      "Jelentkezők: Győr · Új · Kezdő · Egyéni",
    );
    expect(audienceLabel({ ...none, city: "other", q: "pécs" })).toBe("Jelentkezők: Más város · „pécs”");
    expect(audienceLabel({ ...none, ref: "gyp" })).toBe("Jelentkezők: Forrás: gyp");
    expect(audienceLabel({ ...none, ref: "none" })).toBe("Jelentkezők: Forrás nélkül");
  });
});
