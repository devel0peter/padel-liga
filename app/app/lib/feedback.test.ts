import { describe, expect, it } from "vitest";

import {
  ACCOUNT_LIMITS,
  browserFamily,
  deviceClass,
  ERRORS,
  MESSAGE_MAX,
  pagePath,
  rateLimits,
  validateFeedback,
  VISITOR_LIMITS,
  withinLimits,
} from "./feedback";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const WIN_EDGE = `${WIN_CHROME} Edg/130.0.0.0`;
const MAC_FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0";
const SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36";
const FB_IN_APP = `${IPHONE} [FBAN/FBIOS;FBAV/480.0.0.0;]`;
const OPERA = `${WIN_CHROME} OPR/114.0.0.0`;

describe("validateFeedback (#239 requirement 2)", () => {
  it("accepts each form type with a message, trimmed, without a rating", () => {
    for (const kind of ["bug", "idea", "other"] as const)
      expect(validateFeedback({ kind, message: "  Nem tölt be a tabella.  ", rating: 4 })).toEqual({
        ok: true,
        value: { kind, message: "Nem tölt be a tabella.", rating: null },
      });
  });

  it("refuses an empty or blank message for the form types", () => {
    expect(validateFeedback({ kind: "bug", message: "" })).toEqual({ ok: false, error: ERRORS.empty });
    expect(validateFeedback({ kind: "idea", message: "   \n " })).toEqual({ ok: false, error: ERRORS.empty });
    expect(validateFeedback({ kind: "other", message: null })).toEqual({ ok: false, error: ERRORS.empty });
  });

  it("takes exactly 2000 characters and refuses 2001", () => {
    expect(validateFeedback({ kind: "bug", message: "a".repeat(MESSAGE_MAX) }).ok).toBe(true);
    expect(validateFeedback({ kind: "bug", message: "a".repeat(MESSAGE_MAX + 1) })).toEqual({ ok: false, error: ERRORS.tooLong });
  });

  it("refuses an unknown type", () => {
    expect(validateFeedback({ kind: "praise", message: "Szuper" })).toEqual({ ok: false, error: ERRORS.kind });
    expect(validateFeedback({ kind: null, message: "Szuper" })).toEqual({ ok: false, error: ERRORS.kind });
  });

  it("a rating needs 1–5 stars; its comment is optional and at most 2000 characters", () => {
    expect(validateFeedback({ kind: "rating", message: "", rating: 5 })).toEqual({ ok: true, value: { kind: "rating", message: "", rating: 5 } });
    expect(validateFeedback({ kind: "rating", message: " jó ", rating: "1" })).toEqual({ ok: true, value: { kind: "rating", message: "jó", rating: 1 } });
    for (const rating of [0, 6, 2.5, "x", null, undefined])
      expect(validateFeedback({ kind: "rating", message: "", rating }), String(rating)).toEqual({ ok: false, error: ERRORS.rating });
    expect(validateFeedback({ kind: "rating", message: "a".repeat(MESSAGE_MAX + 1), rating: 3 })).toEqual({ ok: false, error: ERRORS.tooLong });
  });
});

describe("pagePath (#239 requirement 3)", () => {
  it("keeps the path only: no query string, no fragment", () => {
    expect(pagePath("/league/gyor?week=2#tabella")).toBe("/league/gyor");
    expect(pagePath("/")).toBe("/");
    expect(pagePath("/rules#5")).toBe("/rules");
  });

  it("replaces ids: numbers, account UUIDs and link tokens", () => {
    expect(pagePath("/matches/123")).toBe("/matches/:id");
    expect(pagePath("/players/0b6f3c2e-8f1a-4c1e-9d3b-2a7e5c9f1d20")).toBe("/players/:id");
    expect(pagePath("/admin/users/0b6f3c2e-8f1a-4c1e-9d3b-2a7e5c9f1d20")).toBe("/admin/users/:id");
    expect(pagePath("/pair/join/abcDEF")).toBe("/pair/join/:token");
    expect(pagePath("/admin/leagues/gyor/seasons/3/entries")).toBe("/admin/leagues/gyor/seasons/:id/entries");
    expect(pagePath("/matches/9/calendar.ics")).toBe("/matches/:id/calendar.ics");
  });

  it("is empty for anything that isn't one of our own paths", () => {
    for (const bad of [null, undefined, "", "https://evil.example/x", "//evil.example", "/\\evil", "home"]) expect(pagePath(bad), String(bad)).toBe("");
  });

  it("is at most 200 characters", () => {
    expect(pagePath(`/${"a/".repeat(200)}`).length).toBe(200);
  });
});

describe("deviceClass and browserFamily (#239 requirement 3)", () => {
  it("phones and tablets are mobile, the rest desktop", () => {
    expect(deviceClass(IPHONE)).toBe("mobile");
    expect(deviceClass(ANDROID_CHROME)).toBe("mobile");
    expect(deviceClass("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)")).toBe("mobile");
    expect(deviceClass(WIN_CHROME)).toBe("desktop");
    expect(deviceClass(MAC_FIREFOX)).toBe("desktop");
    expect(deviceClass(null)).toBe("desktop");
  });

  it("names the family, not the full string", () => {
    expect(browserFamily(IPHONE)).toBe("Safari");
    expect(browserFamily(ANDROID_CHROME)).toBe("Chrome");
    expect(browserFamily(WIN_CHROME)).toBe("Chrome");
    expect(browserFamily(WIN_EDGE)).toBe("Edge");
    expect(browserFamily(OPERA)).toBe("Opera");
    expect(browserFamily(MAC_FIREFOX)).toBe("Firefox");
    expect(browserFamily(SAMSUNG)).toBe("Samsung Internet");
    expect(browserFamily(FB_IN_APP)).toBe("Facebook");
    expect(browserFamily("curl/8.0")).toBe("Egyéb");
    expect(browserFamily(undefined)).toBe("Egyéb");
  });
});

describe("rate limits (#239 requirement 4, #240 requirement 6)", () => {
  it("an account: 5 an hour and 20 a day; visitors together: 30 an hour", () => {
    expect(rateLimits("u1")).toBe(ACCOUNT_LIMITS);
    expect(rateLimits(null)).toBe(VISITOR_LIMITS);
    expect(ACCOUNT_LIMITS).toEqual([
      { seconds: 3600, max: 5 },
      { seconds: 86400, max: 20 },
    ]);
    expect(VISITOR_LIMITS).toEqual([{ seconds: 3600, max: 30 }]);
  });

  it("allows one more while every window is under its maximum", () => {
    expect(withinLimits(ACCOUNT_LIMITS, [0, 0])).toBe(true);
    expect(withinLimits(ACCOUNT_LIMITS, [4, 19])).toBe(true);
    expect(withinLimits(ACCOUNT_LIMITS, [5, 5])).toBe(false);
    expect(withinLimits(ACCOUNT_LIMITS, [0, 20])).toBe(false);
    expect(withinLimits(VISITOR_LIMITS, [29])).toBe(true);
    expect(withinLimits(VISITOR_LIMITS, [30])).toBe(false);
  });
});
