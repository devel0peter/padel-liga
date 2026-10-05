import { describe, expect, it } from "vitest";

import { generateCode, randomToken, sha256Hex, timingSafeEqual } from "./tokens";

describe("tokens", () => {
  it("makes url-safe random tokens of 32 bytes", () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(t);
  });

  it("hashes with SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("generates 6-digit codes, leading zeros kept", () => {
    const codes = Array.from({ length: 2000 }, generateCode);
    for (const c of codes) expect(c).toMatch(/^\d{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(1990);
  });

  it("compares strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
