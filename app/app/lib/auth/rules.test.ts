import { describe, expect, it } from "vitest";

import { effectiveDailyLimit } from "~/lib/email/budget";

import {
  checkCode,
  codeSendDecision,
  CODE_TTL_MS,
  DEFAULT_RETURN_TO,
  googlePicture,
  initials,
  isStaleCode,
  isValidEmail,
  loginEmailParam,
  MAX_CODE_ATTEMPTS,
  MAX_CODES_PER_WINDOW,
  newAddressCodeCap,
  newAddressCodeDecision,
  nextExpiry,
  normalizeCode,
  normalizeEmail,
  parseSex,
  parseCookies,
  resolveGoogleLogin,
  safeReturnTo,
  serializeCookie,
  SEXES,
  sessionExpiry,
  SESSION_TTL_MS,
  STALE_CODE_GRACE_MS,
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
  it("last 90 days, 12 hours for the Admin", () => {
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

  it("extend a Admin session every few minutes of use, to 12 hours", () => {
    const fresh = sessionExpiry(now, "superadmin");
    expect(nextExpiry(new Date(fresh.getTime() - 5 * min), now, "superadmin")).toBeNull();
    expect(nextExpiry(new Date(fresh.getTime() - 8 * min), now, "superadmin")).toEqual(fresh);
  });

  it("shrink a long session at once when the account becomes Admin", () => {
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

describe("stale code records (#168)", () => {
  const hour = 60 * min;
  // A code sent at `sent`, the window started at `windowStart`.
  const sentAt = (sent: Date, windowStart = sent): CodeRecord => ({
    codeHash: "h",
    expiresAt: new Date(sent.getTime() + CODE_TTL_MS),
    attempts: MAX_CODE_ATTEMPTS,
    windowStart,
    sentInWindow: MAX_CODES_PER_WINDOW,
  });
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("is stale once its code expired an hour ago and its window ended", () => {
    expect(STALE_CODE_GRACE_MS).toBe(hour);
    expect(isStaleCode(sentAt(ago(CODE_TTL_MS + hour)), now)).toBe(true);
    expect(isStaleCode(sentAt(ago(3 * day)), now)).toBe(true);
  });

  it("is kept while its code is valid", () => {
    expect(isStaleCode(sentAt(ago(min), ago(2 * hour)), now)).toBe(false);
  });

  it("is kept for an hour after its code expired, so a late try still reads as expired", () => {
    const record = { ...sentAt(ago(CODE_TTL_MS + hour - min), ago(2 * hour)), attempts: 0 };
    expect(checkCode(record, true, now)).toBe("expired");
    expect(isStaleCode(record, now)).toBe(false);
  });

  it("is kept inside its hourly window, so the hourly code limit holds", () => {
    // Window started 59 minutes ago, its code expired long enough ago.
    const record = { ...sentAt(ago(CODE_TTL_MS + hour)), windowStart: ago(59 * min) };
    expect(codeSendDecision(record, now)).toEqual({ ok: false });
    expect(isStaleCode(record, now)).toBe(false);
  });

  it("weakens no limit when deleted: a stale record decides like no record", () => {
    for (const record of [sentAt(ago(CODE_TTL_MS + hour)), sentAt(ago(day), ago(day + 30 * min)), sentAt(ago(7 * day))]) {
      expect(isStaleCode(record, now)).toBe(true);
      expect(codeSendDecision(record, now)).toEqual(codeSendDecision(null, now));
      // Neither a right code nor a wrong one gets in, with or without it.
      expect(checkCode(record, true, now)).not.toBe("ok");
      expect(checkCode(null, true, now)).not.toBe("ok");
    }
  });
});

describe("codes to new addresses (#113)", () => {
  const base = { hasAccount: false, invited: false, suppression: null, sentToNewLast24h: 0, dailyLimit: 100 } as const;

  it("caps them at a quarter of the daily limit", () => {
    expect(newAddressCodeCap(100)).toBe(25);
    expect(newAddressCodeCap(5000)).toBe(1250);
    expect(newAddressCodeDecision({ ...base, sentToNewLast24h: 24 })).toBe("send");
    expect(newAddressCodeDecision({ ...base, sentToNewLast24h: 25 })).toBe("capped");
  });

  it("is 1,250 with the relay and 25 without it (#127)", () => {
    expect(newAddressCodeCap(effectiveDailyLimit(true, undefined))).toBe(1250);
    expect(newAddressCodeCap(effectiveDailyLimit(false, undefined))).toBe(25);
    const relay = { ...base, dailyLimit: effectiveDailyLimit(true, undefined) };
    expect(newAddressCodeDecision({ ...relay, sentToNewLast24h: 1249 })).toBe("send");
    expect(newAddressCodeDecision({ ...relay, sentToNewLast24h: 1250 })).toBe("capped");
  });

  it("never caps an account or an invited address", () => {
    expect(newAddressCodeDecision({ ...base, hasAccount: true, sentToNewLast24h: 99 })).toBe("send");
    expect(newAddressCodeDecision({ ...base, invited: true, sentToNewLast24h: 99 })).toBe("send");
  });

  it("skips a new address that bounced or complained, invited or not", () => {
    for (const suppression of ["bounced", "complained"] as const) {
      expect(newAddressCodeDecision({ ...base, suppression })).toBe("suppressed");
      expect(newAddressCodeDecision({ ...base, suppression, invited: true })).toBe("suppressed");
    }
  });

  it("sends to an unsubscribed new address and to an account whose address bounced", () => {
    expect(newAddressCodeDecision({ ...base, suppression: "unsubscribed" })).toBe("send");
    expect(newAddressCodeDecision({ ...base, hasAccount: true, suppression: "bounced" })).toBe("send");
  });
});

describe("Google login", () => {
  const base = { linkedUserId: null, emailUserId: null, emailVerified: true };

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

  it("creates an account for any new verified email, no invite needed (#113)", () => {
    expect(resolveGoogleLogin(base)).toEqual({ kind: "create" });
  });

  it("never creates an account for an unverified Google email", () => {
    expect(resolveGoogleLogin({ ...base, emailVerified: false })).toEqual({ kind: "refused", reason: "unverified" });
  });
});

describe("profile", () => {
  const first = { requireConsent: true };
  const edit = { requireConsent: false };

  const PHONE = "06 30 123 4567";

  it("first login needs a name, a level, a phone number and consent", () => {
    expect(validateProfile({ name: "  Kiss   Anna ", level: "halado", phone: PHONE, consent: "on", sex: "female" }, first)).toEqual({
      ok: true,
      value: { name: "Kiss Anna", level: "halado", phone: "+36301234567", consent: true, sex: "female" },
    });
    const r = validateProfile({ name: " ", level: "", phone: "", consent: null }, first);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["consent", "level", "name", "phone", "sex"]);
  });

  it("refuses a missing phone number with its own message", () => {
    for (const phone of ["", "   ", null, undefined]) {
      const r = validateProfile({ name: "Kiss Anna", level: "kezdo", phone, consent: "on", sex: "female" }, first);
      expect(r, String(phone)).toEqual({ ok: false, errors: { phone: "Add meg a telefonszámod, a meccsek egyeztetéséhez kell." } });
    }
  });

  it("stores the phone number as E.164", () => {
    const r = validateProfile({ name: "Kiss Anna", level: "kezdo", phone: "+36 1 234 5678", consent: "on", sex: "female" }, first);
    expect(r).toEqual({ ok: true, value: { name: "Kiss Anna", level: "kezdo", phone: "+3612345678", consent: true, sex: "female" } });
  });

  it("refuses a phone number that is not Hungarian", () => {
    const r = validateProfile({ name: "Kiss Anna", level: "kezdo", phone: "+43 660 1234567", consent: "on", sex: "female" }, first);
    expect(r).toEqual({ ok: false, errors: { phone: "Magyar telefonszámot adj meg, pl. +36 30 123 4567." } });
  });

  it("requires a known level", () => {
    for (const level of ["", "expert", undefined, 3, "constructor", "__proto__"]) {
      const r = validateProfile({ name: "Kiss Anna", level, phone: PHONE, consent: "on", sex: "female" }, first);
      expect(r.ok, String(level)).toBe(false);
    }
    for (const level of ["kezdo", "kozephalado", "halado", "versenyzo"])
      expect(validateProfile({ name: "Kiss Anna", level, phone: PHONE, consent: "on", sex: "female" }, first).ok, level).toBe(true);
  });

  it("the profile page needs no consent but can't clear the phone number", () => {
    expect(validateProfile({ name: "Kiss Anna", level: "versenyzo", phone: PHONE, consent: null, sex: "female" }, edit)).toEqual({
      ok: true,
      value: { name: "Kiss Anna", level: "versenyzo", phone: "+36301234567", consent: false, sex: "female" },
    });
    const r = validateProfile({ name: "Kiss Anna", level: "versenyzo", phone: "  ", consent: null, sex: "female" }, edit);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(["phone"]);
  });

  it("requires Férfi or Nő and nothing else (#133)", () => {
    for (const sex of ["", undefined, null, "other", "ferfi", "Nő", "MALE", "__proto__"]) {
      const r = validateProfile({ name: "Kiss Anna", level: "kezdo", phone: PHONE, consent: "on", sex }, first);
      expect(r, String(sex)).toEqual({ ok: false, errors: { sex: "Válaszd ki: férfi vagy nő." } });
    }
    for (const sex of ["male", "female"]) {
      const r = validateProfile({ name: "Kiss Anna", level: "kezdo", phone: PHONE, consent: null, sex }, edit);
      expect(r.ok && r.value.sex, sex).toBe(sex);
    }
    expect(SEXES).toEqual({ male: "Férfi", female: "Nő" });
    expect(parseSex("female")).toBe("female");
    expect(parseSex("x")).toBeNull();
  });

  it("caps the name length", () => {
    const r = validateProfile({ name: "a".repeat(81), level: "kezdo", phone: PHONE, consent: "on", sex: "female" }, first);
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

describe("profile picture", () => {
  it("keeps Google's image URL, sized for the sidebar", () => {
    expect(googlePicture("https://lh3.googleusercontent.com/a/ACg8oc=s96-c")).toBe(
      "https://lh3.googleusercontent.com/a/ACg8oc=s128-c",
    );
    expect(googlePicture("https://lh3.googleusercontent.com/a/ACg8oc")).toBe("https://lh3.googleusercontent.com/a/ACg8oc");
  });

  it("ignores anything not on Google's image host", () => {
    for (const u of [undefined, "", "http://lh3.googleusercontent.com/a/x", "https://evil.com/x.png", "https://googleusercontent.com.evil.com/x", "javascript:alert(1)"])
      expect(googlePicture(u)).toBeNull();
  });

  it("falls back to initials", () => {
    expect(initials("Kiss Anna", "a@x.hu")).toBe("KA");
    expect(initials("Kovács Béla Péter", "a@x.hu")).toBe("KP");
    expect(initials("Anna", "a@x.hu")).toBe("AN");
    expect(initials("  ", "zoli@x.hu")).toBe("ZO");
  });
});

describe("loginEmailParam", () => {
  it("prefills the login form from the invite link's ?email=", () => {
    expect(loginEmailParam("anna@example.com")).toBe("anna@example.com");
    expect(loginEmailParam("  Anna@Example.com ")).toBe("anna@example.com");
  });

  it("ignores a missing or invalid address", () => {
    expect(loginEmailParam(null)).toBe("");
    expect(loginEmailParam("")).toBe("");
    expect(loginEmailParam("not an email")).toBe("");
    expect(loginEmailParam(`${"a".repeat(250)}@example.com`)).toBe("");
  });
});
