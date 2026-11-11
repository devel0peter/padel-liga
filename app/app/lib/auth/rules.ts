// Login rules (docs/admin-plan.md): no passwords, Google or a one-time email
// code, 90-day sessions. Pure (no I/O) so every rule is unit tested; the
// database side is in *.server.ts next to this file.

import { EMAIL_RE, isLevel, type Level } from "../interest";
import { PHONE_REQUIRED, parsePhone } from "../phone";

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

export const DEFAULT_RETURN_TO = "/home";
export const MAX_NAME = 80;
const MAX_EMAIL = 254;

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= MAX_EMAIL && EMAIL_RE.test(email);
}

// The `?email=` of the registration invite link (#20): prefills the login
// form. Not a credential: logging in still needs Google or the emailed code.
export function loginEmailParam(value: string | null): string {
  const email = normalizeEmail(value ?? "");
  return isValidEmail(email) ? email : "";
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

// A code record nothing needs any more (#168): its code expired at least
// STALE_CODE_GRACE_MS ago and its hour-long window ended, so a new request
// starts a fresh window and a fresh code either way (codeSendDecision of it
// equals that of no record). The cron deletes these. The grace hour keeps
// "Ez a kód lejárt" for a late try instead of "nincs érvényes kód". The
// window check is implied (a window starts no later than its last code,
// which expires CODE_TTL_MS after it, so an hour past expiry is past the
// window too); it stays as a safeguard should the TTL or the window change.
export const STALE_CODE_GRACE_MS = HOUR;

export function staleCodeCutoffs(now: Date): { expiredBy: Date; windowStartedBy: Date } {
  return {
    expiredBy: new Date(now.getTime() - STALE_CODE_GRACE_MS),
    windowStartedBy: new Date(now.getTime() - CODE_WINDOW_MS),
  };
}

export function isStaleCode(record: Pick<CodeRecord, "expiresAt" | "windowStart">, now: Date): boolean {
  const { expiredBy, windowStartedBy } = staleCodeCutoffs(now);
  return record.expiresAt <= expiredBy && record.windowStart <= windowStartedBy;
}

// Codes to an address without an account (#113). Anyone may sign up, so a
// bot past the bot check could otherwise type random addresses and use up the
// daily email quota that every login shares. An address with an account
// always gets its code. A new address gets none when it bounced or complained
// before, and none once codes to new, uninvited addresses reached
// NEW_ADDRESS_CODE_SHARE of the daily limit in the last 24 hours. An invited
// address (registration invite, Szervező appointment) is not capped.
// Skipped codes look like sent ones, so the form doesn't tell which addresses
// have an account.
export const NEW_ADDRESS_CODE_SHARE = 0.25;

export function newAddressCodeCap(dailyLimit: number): number {
  return Math.floor(dailyLimit * NEW_ADDRESS_CODE_SHARE);
}

export type NewAddressCode = "send" | "suppressed" | "capped";

export function newAddressCodeDecision(input: {
  hasAccount: boolean;
  invited: boolean;
  suppression: "unsubscribed" | "bounced" | "complained" | null;
  sentToNewLast24h: number;
  dailyLimit: number;
}): NewAddressCode {
  if (input.hasAccount) return "send";
  // Unsubscribing stops bulk mail, not a code the person asked for.
  if (input.suppression === "bounced" || input.suppression === "complained") return "suppressed";
  if (input.invited) return "send";
  return input.sentToNewLast24h >= newAddressCodeCap(input.dailyLimit) ? "capped" : "send";
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

export type GoogleLogin =
  | { kind: "existing"; userId: string }
  | { kind: "link"; userId: string }
  | { kind: "create" }
  | { kind: "refused"; reason: "unverified" };

// Same email = same account: a Google login attaches to the account with
// that email, but only when Google says the email is verified. Anyone may
// create an account (#113): no invite needed.
export function resolveGoogleLogin(input: {
  linkedUserId: string | null;
  emailUserId: string | null;
  emailVerified: boolean;
}): GoogleLogin {
  if (input.linkedUserId) return { kind: "existing", userId: input.linkedUserId };
  if (!input.emailVerified) return { kind: "refused", reason: "unverified" };
  if (input.emailUserId) return { kind: "link", userId: input.emailUserId };
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

// Férfi or Nő (#133): the only two answers, what the player says; never
// inferred from a name.
export const SEXES = { male: "Férfi", female: "Nő" } as const;
export type Sex = keyof typeof SEXES;
export const SEX_REQUIRED = "Válaszd ki: férfi vagy nő.";

export function parseSex(value: unknown): Sex | null {
  return value === "male" || value === "female" ? value : null;
}

export type ProfileInput = { name: string; level: Level; phone: string; consent: boolean; sex: Sex };
export type ProfileErrors = Partial<Record<keyof ProfileInput, string>>;

// The profile form (first login and the profile page): name, level, phone
// number and sex are all required; the phone is stored as E.164 (phone.ts).
// `requireConsent`: the first-login page also asks for the privacy consent.
export function validateProfile(
  input: { name: unknown; level: unknown; phone: unknown; consent?: unknown; sex?: unknown },
  { requireConsent }: { requireConsent: boolean },
): { ok: true; value: ProfileInput } | { ok: false; errors: ProfileErrors } {
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  const consent = input.consent === "on" || input.consent === true;
  const errors: ProfileErrors = {};
  if (name.length < 2) errors.name = "Add meg a neved.";
  else if (name.length > MAX_NAME) errors.name = `Legfeljebb ${MAX_NAME} karakter.`;
  const level = typeof input.level === "string" && isLevel(input.level) ? input.level : null;
  if (!level) errors.level = "Válaszd ki a szinted.";
  const phone = parsePhone(input.phone);
  if (!phone.ok) errors.phone = phone.error;
  else if (!phone.value) errors.phone = PHONE_REQUIRED;
  const sex = parseSex(input.sex);
  if (!sex) errors.sex = SEX_REQUIRED;
  if (requireConsent && !consent) errors.consent = "A belépéshez fogadd el az adatkezelési tájékoztatót.";
  if (Object.keys(errors).length || !level || !phone.ok || !phone.value || !sex) return { ok: false, errors };
  return { ok: true, value: { name, level, phone: phone.value, consent, sex } };
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
