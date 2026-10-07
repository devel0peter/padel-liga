import { describe, expect, it } from "vitest";

import { isAccepted, isPlausibleToken, parseHostnames } from "./turnstile";

describe("turnstile", () => {
  const hosts = parseHostnames(" padelparbaj.hu , Localhost,");

  it("parses a comma-separated hostname list", () => {
    expect([...hosts]).toEqual(["padelparbaj.hu", "localhost"]);
    expect(parseHostnames(undefined).size).toBe(0);
  });

  it("accepts a success for our action on our host", () => {
    expect(isAccepted({ success: true, action: "signup", hostname: "padelparbaj.hu" }, "signup", hosts)).toBe(true);
  });

  it("rejects a failure, another action or another host", () => {
    expect(isAccepted({ success: false, action: "signup", hostname: "padelparbaj.hu" }, "signup", hosts)).toBe(false);
    expect(isAccepted({ success: true, action: "login", hostname: "padelparbaj.hu" }, "signup", hosts)).toBe(false);
    expect(isAccepted({ success: true, action: "signup", hostname: "evil.example" }, "signup", hosts)).toBe(false);
    expect(isAccepted({ success: true, action: "signup" }, "signup", hosts)).toBe(false);
  });

  it("rejects an empty, missing or oversized token", () => {
    expect(isPlausibleToken("abc")).toBe(true);
    expect(isPlausibleToken("")).toBe(false);
    expect(isPlausibleToken(null)).toBe(false);
    expect(isPlausibleToken("x".repeat(2049))).toBe(false);
  });
});
