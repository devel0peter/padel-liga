// Hungarian phone numbers for the profile (spec section 3). Pure (no I/O).
// Stored as E.164 ("+36301234567"), shown as "+36 30 123 4567". Only Hungarian
// numbers are accepted: the league is local and match-day calls stay in
// Hungary (README decision log, 2026-10-23).

export const PHONE_ERROR = "Magyar telefonszámot adj meg, pl. +36 30 123 4567.";

export type PhoneResult = { ok: true; value: string | null } | { ok: false; error: string };

// Mobile prefixes (20, 30, 31, 50, 70) take 7 more digits.
const MOBILE = /^(?:20|30|31|50|70)\d{7}$/;
// Budapest (1) takes 7 more digits, every other area code (2 digits, 22-99, never a mobile prefix) 6.
const BUDAPEST = /^1\d{7}$/;
const LANDLINE = /^(?!(?:20|30|31|50|70))[2-9]\d{7}$/;

// Accepts 06…, +36… and 36…, with spaces, dashes, dots, slashes and brackets
// between the digits. An empty value is "no phone number" (it is optional).
// Returns the E.164 form.
export function parsePhone(input: unknown): PhoneResult {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { ok: true, value: null };
  // "+" only as the very first character.
  if (!/^\+?[\d\s\-./()]+$/.test(raw)) return { ok: false, error: PHONE_ERROR };
  const digits = raw.replace(/\D/g, "");
  let national: string;
  if (raw.startsWith("+")) {
    if (!digits.startsWith("36")) return { ok: false, error: PHONE_ERROR };
    national = digits.slice(2);
  } else if (digits.startsWith("06") || digits.startsWith("36")) {
    national = digits.slice(2);
  } else {
    return { ok: false, error: PHONE_ERROR };
  }
  if (!MOBILE.test(national) && !BUDAPEST.test(national) && !LANDLINE.test(national)) return { ok: false, error: PHONE_ERROR };
  return { ok: true, value: `+36${national}` };
}

// "+36301234567" -> "+36 30 123 4567"; "" for none. A stored value that is not
// a Hungarian number is returned unchanged.
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const national = /^\+36(\d+)$/.exec(e164)?.[1] ?? "";
  if (MOBILE.test(national)) return `+36 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
  if (BUDAPEST.test(national)) return `+36 1 ${national.slice(1, 4)} ${national.slice(4)}`;
  if (LANDLINE.test(national)) return `+36 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
  return e164;
}
