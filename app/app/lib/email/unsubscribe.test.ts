import { describe, expect, it } from "vitest";

import { unsubscribeHeaders, unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from "./unsubscribe";

describe("unsubscribe tokens", () => {
  it("round-trips an address, lowercased", async () => {
    const t = await unsubscribeToken("Anna@Example.com", "s3cret");
    expect(await verifyUnsubscribeToken(t, "s3cret")).toBe("anna@example.com");
  });

  it("handles accented and plus addresses", async () => {
    const t = await unsubscribeToken("kovács+liga@example.hu", "s3cret");
    expect(await verifyUnsubscribeToken(t, "s3cret")).toBe("kovács+liga@example.hu");
  });

  it("rejects another secret", async () => {
    const t = await unsubscribeToken("anna@example.com", "s3cret");
    expect(await verifyUnsubscribeToken(t, "other")).toBeNull();
  });

  it("rejects a token with a swapped address", async () => {
    const a = await unsubscribeToken("anna@example.com", "s3cret");
    const b = await unsubscribeToken("bela@example.com", "s3cret");
    const forged = `${b.split(".")[0]}.${a.split(".")[1]}`;
    expect(await verifyUnsubscribeToken(forged, "s3cret")).toBeNull();
  });

  it("rejects garbage", async () => {
    for (const t of ["", "abc", "a.b", "!!!.???"]) expect(await verifyUnsubscribeToken(t, "s3cret")).toBeNull();
  });

  it("is URL-safe", async () => {
    const t = await unsubscribeToken("anna@example.com", "s3cret");
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("builds one-click unsubscribe headers", () => {
    const url = unsubscribeUrl("https://padelparbaj.hu", "tok");
    expect(url).toBe("https://padelparbaj.hu/unsubscribe?t=tok");
    expect(unsubscribeHeaders(url)).toEqual({
      "List-Unsubscribe": "<https://padelparbaj.hu/unsubscribe?t=tok>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
