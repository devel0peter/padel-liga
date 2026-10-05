import { describe, expect, it } from "vitest";

import {
  canCreateAccount,
  checkCode,
  codeSendDecision,
  CODE_TTL_MS,
  DEFAULT_RETURN_TO,
  isValidEmail,
  MAX_CODE_ATTEMPTS,
  MAX_CODES_PER_WINDOW,
  nextExpiry,
  normalizeCode,
  normalizeEmail,
  parseCookies,
  REGISTRATION_OPENS_AT,
  registrationOpen,
  resolveGoogleLogin,
  safeReturnTo,
  serializeCookie,
  sessionExpiry,
  SESSION_TTL_MS,
  SUPERADMIN_SESSION_TTL_MS,
  validateProfile,
  type CodeRecord,
} from "./rules";

const now = new Date("2026-10-10T10:00:00Z");
const min = 60 * 1000;
const day = 24 * 60 * min;

describe("emails and codes", () => {
  it("normalizes emails to trimmed lowercase", () => {
    expect(normalizeEmail("  Anna@Example.COM ")).toBe("anna@example.com");
  });

  it("validates emails", () => {
    expect(isValidEmail("anna@example.com")).toBe(true);
    expect(isValidEmail("anna@example")).toBe(false);
    expect(isValidEmail("anna example.com")).toBe(false);
    expect(isValidEmail(`${"a".repeat(250)}@x.hu`)).toBe(false);
  });

  it("accepts a 6-digit code typed with spaces or a dash", () => {
    expect(normalizeCode("123456")).toBe("123456");
    expect(normalizeCode(" 123 456 ")).toBe("123456");
    expect(normalizeCode("123-456")).toBe("123456");
    expect(normalizeCode("012345")).toBe("012345");
  });

  it("rejects anything that isn't 6 digits", () => {
    for (const c of ["", "12345", "1234567", "12345a", "١٢٣٤٥٦"]) expect(normalizeCode(c)).toBeNull();
  });
});

describe("sessions", () => {
  it("last 90 days, 12 hours for the Főadmin", () => {
    expect(SESSION_TTL_MS).toBe(90 * day);
    expect(SUPERADMIN_SESSION_TTL_MS).toBe(12 * 60 * min);
    expect(sessionExpiry(now).getTime() - now.getTime()).toBe(SESSION_TTL_MS);
    expect(sessionExpiry(now, "superadmin").getTime() - now.getTime()).toBe(SUPERADMIN_SESSION_TTL_MS);
  });

  it("are not rewritten within a day of the last extension", () => {
    const expires = new Date(now.getTime() + SESSION_TTL_MS - 23 * 60 * min);
    expect(nextExpiry(expires, now)).toBeNull();
  });

  it("are extended to a full 90 days once a day has passed", () => {
    const expires = new Date(now.getTime() + SESSION_TTL_MS - day);
    expect(nextExpiry(expires, now)).toEqual(sessionExpiry(now));
    const nearlyOver = new Date(now.getTime() + min);
    expect(nextExpiry(nearlyOver, now)).toEqual(sessionExpiry(now));
  });

  it("extend a Főadmin session every few minutes of use, to 12 hours", () => {
    const fresh = sessionExpiry(now, "superadmin");
    expect(nextExpiry(new Date(fresh.getTime() - 5 * min), now, "superadmin")).toBeNull();
    expect(nextExpiry(new Date(fresh.getTime() - 8 * min), now, "superadmin")).toEqual(fresh);
  });

  it("shrink a long session at once when the account becomes Főadmin", () => {
    expect(nextExpiry(sessionExpiry(now), now, "superadmin")).toEqual(sessionExpiry(now, "superadmin"));
  });
});

describe("sending codes", () => {
  it("allows the first code and starts a window", () => {
    expect(codeSendDecision(null, now)).toEqual({ ok: true, windowStart: now, sentInWindow: 1 });
  });

  it("counts codes within the hour", () => {
    const start = new Date(now.getTime() - 10 * min);
    expect(codeSendDecision({ windowStart: start, sentInWindow: 2 }, now)).toEqual({
      ok: true,
      windowStart: start,
      sentInWindow: 3,
    });
  });

  it(`refuses after ${MAX_CODES_PER_WINDOW} codes in an hour`, () => {
    const start = new Date(now.getTime() - 59 * min);
    expect(codeSendDecision({ windowStart: start, sentInWindow: MAX_CODES_PER_WINDOW }, now)).toEqual({ ok: false });
  });

  it("starts a new window after an hour", () => {
    const start = new Date(now.getTime() - 60 * min);
    expect(codeSendDecision({ windowStart: start, sentInWindow: MAX_CODES_PER_WINDOW }, now)).toEqual({
      ok: true,
      windowStart: now,
      sentInWindow: 1,
    });
  });
});

describe("checking codes", () => {
  const record = (over: Partial<CodeRecord> = {}): CodeRecord => ({
    codeHash: "h",
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    attempts: 0,
    windowStart: now,
    sentInWindow: 1,
    ...over,
  });

  it("accepts the right code in time", () => {
    expect(checkCode(record(), true, now)).toBe("ok");
  });

  it("rejects a wrong code", () => {
    expect(checkCode(record(), false, now)).toBe("wrong");
  });

  it("rejects without a code on record", () => {
    expect(checkCode(null, true, now)).toBe("missing");
  });

  it("rejects an expired code, even the right one", () => {
    expect(checkCode(record({ expiresAt: now }), true, now)).toBe("expired");
  });

  it(`locks after ${MAX_CODE_ATTEMPTS} wrong tries, even the right code`, () => {
    expect(checkCode(record({ attempts: MAX_CODE_ATTEMPTS - 1 }), true, now)).toBe("ok");
    expect(checkCode(record({ attempts: MAX_CODE_ATTEMPTS }), true, now)).toBe("locked");
  });
});

describe("registration", () => {
  it("opens on 2 Nov 2026 at midnight Budapest time", () => {
    expect(REGISTRATION_OPENS_AT.toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(registrationOpen(new Date("2026-11-01T22:59:59Z"))).toBe(false);
    expect(registrationOpen(new Date("2026-11-01T23:00:00Z"))).toBe(true);
  });

  it("lets only invited emails create an account before that", () => {
    expect(canCreateAccount({ invited: false, now })).toBe(false);
    expect(canCreateAccount({ invited: true, now })).toBe(true);
    expect(canCreateAccount({ invited: false, now: REGISTRATION_OPENS_AT })).toBe(true);
  });
});

describe("Google login", () => {
  const base = { linkedUserId: null, emailUserId: null, emailVerified: true, invited: false, now };

  it("logs in the account already linked to this Google account", () => {
    expect(resolveGoogleLogin({ ...base, linkedUserId: "u1", emailUserId: "u2" })).toEqual({
      kind: "existing",
      userId: "u1",
    });
  });

  it("links to the account with the same verified email", () => {
    expect(resolveGoogleLogin({ ...base, emailUserId: "u2" })).toEqual({ kind: "link", userId: "u2" });
  });

  it("never links an unverified Google email", () => {
    expect(resolveGoogleLogin({ ...base, emailUserId: "u2", emailVerified: false })).toEqual({
      kind: "refused",
      reason: "unverified",
    });
  });

  it("creates an account only when invited or registration is open", () => {
    expect(resolveGoogleLogin(base)).toEqual({ kind: "refused", reason: "closed" });
    expect(resolveGoogleLogin({ ...base, invited: true })).toEqual({ kind: "create" });
    expect(resolveGoogleLogin({ ...base, now: REGISTRATION_OPENS_AT })).toEqual({ kind: "create" });
  });
});

describe("first-login profile", () => {
  it("needs a name and consent", () => {
    expect(validateProfile({ name: "  Kiss   Anna ", consent: "on" })).toEqual({
      ok: true,
      value: { name: "Kiss Anna", consent: true },
    });
    const r = validateProfile({ name: " ", consent: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["consent", "name"]);
  });

  it("caps the name length", () => {
    const r = validateProfile({ name: "a".repeat(81), consent: "on" });
    expect(r.ok).toBe(false);
  });
});

describe("return paths", () => {
  it("keeps paths on this site", () => {
    expect(safeReturnTo("/admin?x=1")).toBe("/admin?x=1");
  });

  it("falls back for anything else", () => {
    for (const v of [null, undefined, "", "admin", "//evil.com", "/\\evil.com", "https://evil.com", "/a\nb"])
      expect(safeReturnTo(v)).toBe(DEFAULT_RETURN_TO);
  });
});

describe("cookies", () => {
  it("parses a cookie header, first value wins", () => {
    const c = parseCookies("a=1; b=x=y; a=2; junk; =z");
    expect(c.get("a")).toBe("1");
    expect(c.get("b")).toBe("x=y");
    expect(c.size).toBe(2);
    expect(parseCookies(null).size).toBe(0);
  });

  it("serializes an httpOnly, Lax cookie, Secure outside local dev", () => {
    expect(serializeCookie("s", "v", { maxAgeSeconds: 60, secure: true })).toBe(
      "s=v; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure",
    );
    expect(serializeCookie("s", "", { maxAgeSeconds: 0, secure: false })).toBe("s=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  });
});
