// Login rules (docs/admin-plan.md): no passwords, Google or a one-time email
// code, 90-day sessions. Pure (no I/O) so every rule is unit tested; the
// database side is in *.server.ts next to this file.

import { EMAIL_RE } from "../interest";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SESSION_TTL_MS = 90 * DAY;
// The Admin account: 12 hours of inactivity (docs/admin-plan.md).
export const SUPERADMIN_SESSION_TTL_MS = 12 * HOUR;

export const CODE_TTL_MS = 10 * MINUTE;
export const MAX_CODE_ATTEMPTS = 5;
const CODE_WINDOW_MS = HOUR;
export const MAX_CODES_PER_WINDOW = 5;

// Registration opens Mon 2 Nov 2026 00:00 Budapest time (spec section 18).
// Before that only invited emails can create an account.
export const REGISTRATION_OPENS_AT = new Date("2026-11-01T23:00:00Z");

export const DEFAULT_RETURN_TO = "/profile";
const MAX_NAME = 80;
const MAX_EMAIL = 254;

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= MAX_EMAIL && EMAIL_RE.test(email);
}

// Accepts "123 456" or "123-456" as typed or pasted; null if it isn't 6 digits.
export function normalizeCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

// --- Sessions ---------------------------------------------------------------

export function sessionTtl(role: "player" | "superadmin"): number {
  return role === "superadmin" ? SUPERADMIN_SESSION_TTL_MS : SESSION_TTL_MS;
}

export function sessionExpiry(now: Date, role: "player" | "superadmin" = "player"): Date {
  return new Date(now.getTime() + sessionTtl(role));
}

// The new expiry of a session in use, or null when it needn't be written.
// Extended to a full TTL from now, but written at most once per 1/90 of the
// TTL (a day for 90-day sessions, 8 minutes for 12-hour ones). Shortened at
// once if the role now has a shorter TTL (e.g. just made Admin).
export function nextExpiry(expiresAt: Date, now: Date, role: "player" | "superadmin" = "player"): Date | null {
  const ttl = sessionTtl(role);
  const target = now.getTime() + ttl;
  if (expiresAt.getTime() > target) return new Date(target);
  return target - expiresAt.getTime() >= ttl / 90 ? new Date(target) : null;
}

// --- Login codes ------------------------------------------------------------

export type CodeRecord = {
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  windowStart: Date;
  sentInWindow: number;
};

export type SendDecision = { ok: true; windowStart: Date; sentInWindow: number } | { ok: false };

// At most MAX_CODES_PER_WINDOW codes per email per hour, so nobody can flood
// an inbox or burn the daily email quota.
export function codeSendDecision(existing: Pick<CodeRecord, "windowStart" | "sentInWindow"> | null, now: Date): SendDecision {
  if (!existing || now.getTime() - existing.windowStart.getTime() >= CODE_WINDOW_MS)
    return { ok: true, windowStart: now, sentInWindow: 1 };
  if (existing.sentInWindow >= MAX_CODES_PER_WINDOW) return { ok: false };
  return { ok: true, windowStart: existing.windowStart, sentInWindow: existing.sentInWindow + 1 };
}

export type CodeCheck = "ok" | "wrong" | "expired" | "locked" | "missing";

// `matches`: whether the submitted code's hash equals record.codeHash
// (compared in constant time by the caller). A wrong code costs an attempt;
// after MAX_CODE_ATTEMPTS even the right code is refused.
export function checkCode(record: CodeRecord | null, matches: boolean, now: Date): CodeCheck {
  if (!record) return "missing";
  if (record.attempts >= MAX_CODE_ATTEMPTS) return "locked";
  if (now.getTime() >= record.expiresAt.getTime()) return "expired";
  return matches ? "ok" : "wrong";
}

export const CODE_MESSAGES: Record<Exclude<CodeCheck, "ok">, string> = {
  wrong: "Ez nem jó kód. Nézd meg újra a levelet.",
  expired: "Ez a kód lejárt. Kérj újat.",
  locked: "Túl sok hibás próbálkozás. Kérj új kódot.",
  missing: "Ehhez a címhez nincs érvényes kód. Kérj újat.",
};

// --- Accounts ---------------------------------------------------------------

export function registrationOpen(now: Date): boolean {
  return now.getTime() >= REGISTRATION_OPENS_AT.getTime();
}

// A login for an email without an account creates one only if registration
// is open or the email is invited.
export function canCreateAccount({ invited, now }: { invited: boolean; now: Date }): boolean {
  return invited || registrationOpen(now);
}

export type GoogleLogin =
  | { kind: "existing"; userId: string }
  | { kind: "link"; userId: string }
  | { kind: "create" }
  | { kind: "refused"; reason: "unverified" | "closed" };

// Same email = same account: a Google login attaches to the account with
// that email, but only when Google says the email is verified.
export function resolveGoogleLogin(input: {
  linkedUserId: string | null;
  emailUserId: string | null;
  emailVerified: boolean;
  invited: boolean;
  now: Date;
}): GoogleLogin {
  if (input.linkedUserId) return { kind: "existing", userId: input.linkedUserId };
  if (!input.emailVerified) return { kind: "refused", reason: "unverified" };
  if (input.emailUserId) return { kind: "link", userId: input.emailUserId };
  if (!canCreateAccount(input)) return { kind: "refused", reason: "closed" };
  return { kind: "create" };
}

// Google's profile picture, only from Google's own image host, at a size that
// stays sharp in the sidebar (the URL ends in a size suffix like "=s96-c").
export function googlePicture(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !u.hostname.endsWith(".googleusercontent.com")) return null;
    return u.toString().replace(/=s\d+(-c)?$/, "=s128-c");
  } catch {
    return null;
  }
}

// "Kiss Anna" -> "KA"; for the avatar when there is no picture.
export function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? email).slice(0, 2);
  return letters.toUpperCase();
}

export const REGISTRATION_CLOSED_MESSAGE =
  "A regisztráció november 2-án nyílik. Ha meghívót kaptál, azzal az e-mail-címmel lépj be.";

export type ProfileInput = { name: string; consent: boolean };
export type ProfileErrors = Partial<Record<keyof ProfileInput, string>>;

export function validateProfile(input: { name: unknown; consent: unknown }):
  | { ok: true; value: ProfileInput }
  | { ok: false; errors: ProfileErrors } {
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  const consent = input.consent === "on" || input.consent === true;
  const errors: ProfileErrors = {};
  if (name.length < 2) errors.name = "Add meg a neved.";
  else if (name.length > MAX_NAME) errors.name = `Legfeljebb ${MAX_NAME} karakter.`;
  if (!consent) errors.consent = "A belépéshez fogadd el az adatkezelési tájékoztatót.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { name, consent } };
}

// --- Redirects and cookies --------------------------------------------------

// Only a path on this site: no "//evil.com" or "/\evil.com" (open redirect).
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return DEFAULT_RETURN_TO;
  if (/[\u0000-\u001f]/.test(value)) return DEFAULT_RETURN_TO;
  return value;
}

export function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of (header ?? "").split(";")) {
    const part = raw.trim();
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!out.has(name)) out.set(name, part.slice(eq + 1).trim());
  }
  return out;
}

// httpOnly and SameSite=Lax always; Secure everywhere but local http dev.
export function serializeCookie(
  name: string,
  value: string,
  { maxAgeSeconds, secure }: { maxAgeSeconds: number; secure: boolean },
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}
