import { describe, expect, it } from "vitest";

import { formatPhone, parsePhone } from "./phone";

describe("parsePhone", () => {
  it("accepts the Hungarian ways of writing a mobile number", () => {
    for (const input of [
      "06301234567",
      "06 30 123 4567",
      "06-30-123-4567",
      "06 30/123-4567",
      "+36301234567",
      "+36 30 123 4567",
      "36301234567",
      "36 30 123 4567",
      "+36 (30) 123.4567",
      "  +36 30 123 4567  ",
    ])
      expect(parsePhone(input), input).toEqual({ ok: true, value: "+36301234567" });
  });

  it("accepts every Hungarian mobile prefix", () => {
    for (const p of ["20", "30", "31", "50", "70"]) expect(parsePhone(`06${p}1234567`)).toEqual({ ok: true, value: `+36${p}1234567` });
  });

  it("accepts a Budapest and a countryside landline", () => {
    expect(parsePhone("06 1 234 5678")).toEqual({ ok: true, value: "+3612345678" });
    expect(parsePhone("+36 96 123 456")).toEqual({ ok: true, value: "+3696123456" });
  });

  it("treats an empty value as no phone number", () => {
    expect(parsePhone("")).toEqual({ ok: true, value: null });
    expect(parsePhone("   ")).toEqual({ ok: true, value: null });
    expect(parsePhone(null)).toEqual({ ok: true, value: null });
    expect(parsePhone(undefined)).toEqual({ ok: true, value: null });
  });

  it("refuses numbers from other countries", () => {
    for (const input of ["+43 660 1234567", "+421 905 123 456", "0043 660 1234567", "+1 202 555 0100"]) {
      expect(parsePhone(input).ok, input).toBe(false);
    }
  });

  it("refuses numbers of the wrong length or shape", () => {
    for (const input of [
      "06 30 123 456", // mobile one digit short
      "06 30 123 45678", // mobile one digit long
      "06 1 234 567", // Budapest landline short
      "+36 96 123 4567", // landline long
      "+36 30 123 45ab",
      "30 123 4567", // no country prefix
      "06 00 123 4567", // no such prefix
      "06 06 301234567",
      "abc",
      "+36",
      "06",
      "++36301234567",
      "06 30 123 4567 ext 5",
      "06 30 123 4567 +",
    ])
      expect(parsePhone(input).ok, input).toBe(false);
  });

  it("gives a Hungarian error message", () => {
    expect(parsePhone("12")).toEqual({ ok: false, error: "Magyar telefonszámot adj meg, pl. +36 30 123 4567." });
  });
});

describe("formatPhone", () => {
  it("shows a mobile number as +36 30 123 4567", () => {
    expect(formatPhone("+36301234567")).toBe("+36 30 123 4567");
    expect(formatPhone("+36701234567")).toBe("+36 70 123 4567");
  });

  it("shows a Budapest landline as +36 1 234 5678", () => {
    expect(formatPhone("+3612345678")).toBe("+36 1 234 5678");
  });

  it("shows a countryside landline as +36 96 123 456", () => {
    expect(formatPhone("+3696123456")).toBe("+36 96 123 456");
  });

  it("returns an empty string for no number", () => {
    expect(formatPhone(null)).toBe("");
    expect(formatPhone("")).toBe("");
  });

  it("returns an unrecognised stored value as is", () => {
    expect(formatPhone("+4366012345")).toBe("+4366012345");
  });

  it("round-trips through parsePhone", () => {
    for (const n of ["+36301234567", "+3612345678", "+3696123456"]) {
      expect(parsePhone(formatPhone(n))).toEqual({ ok: true, value: n });
    }
  });
});
