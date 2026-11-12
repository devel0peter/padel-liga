// Feedback (spec 19, D94; #239 storage, #240 form, #241 admin list): the
// types, the validation, the context worked out from the request, the rate
// limits and the admin list's filters. Pure; the database is in
// feedback.server.ts. Nothing here sends mail, push or a notification.

export const FEEDBACK_KINDS = ["bug", "idea", "other", "rating"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
// What the form offers; a rating only comes from the prompt.
export const FORM_KINDS = ["bug", "idea", "other"] as const satisfies readonly FeedbackKind[];
export type FormKind = (typeof FORM_KINDS)[number];

export const KIND_LABELS: Record<FeedbackKind, string> = {
  bug: "Hiba",
  idea: "Ötlet",
  other: "Egyéb",
  rating: "Értékelés",
};

export const MESSAGE_MAX = 2000;

export const isFeedbackKind = (value: unknown): value is FeedbackKind => FEEDBACK_KINDS.includes(value as FeedbackKind);
export const isFormKind = (value: unknown): value is FormKind => FORM_KINDS.includes(value as FormKind);

export type FeedbackInput = { kind: FeedbackKind; message: string; rating: number | null };

export const ERRORS = {
  kind: "Válaszd ki, miről szól.",
  empty: "Írd le pár szóban, mit szeretnél.",
  tooLong: `Legfeljebb ${MESSAGE_MAX} karakter lehet.`,
  rating: "1 és 5 csillag között válassz.",
  limit: "Most túl sok üzenet jött, próbáld újra egy kicsit később.",
} as const;

// Checks one message. The text is trimmed; a rating's comment may be empty,
// every other type needs a message. Only ratings carry a star number.
export function validateFeedback(raw: { kind: unknown; message: unknown; rating?: unknown }): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
  if (!isFeedbackKind(raw.kind)) return { ok: false, error: ERRORS.kind };
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  if (message.length > MESSAGE_MAX) return { ok: false, error: ERRORS.tooLong };
  if (raw.kind === "rating") {
    const rating = typeof raw.rating === "number" ? raw.rating : Number(raw.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: ERRORS.rating };
    return { ok: true, value: { kind: "rating", message, rating } };
  }
  if (!message) return { ok: false, error: ERRORS.empty };
  return { ok: true, value: { kind: raw.kind, message, rating: null } };
}

// --- Context ------------------------------------------------------------------

const PAGE_MAX = 200;
// A segment kept as it is: a word of the app's own paths (routes.ts) or a
// league slug. Anything else (a number, an account's UUID, a link token) is
// an id and becomes ":id", so the stored page never points at a person.
const PLAIN_SEGMENT = /^[a-z][a-z0-9_.-]{0,19}$/i;

// The page a message was sent from, as stored and shown: the path only, no
// query string or fragment, ids replaced. "" when it is missing or not one of
// our own paths.
export function pagePath(from: string | null | undefined): string {
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.startsWith("/\\")) return "";
  const path = from.split(/[?#]/, 1)[0]!;
  const segments = path.split("/").slice(1);
  const out = segments.map((s, i) => {
    if (s === "") return s;
    if (segments[i - 1] === "join") return ":token";
    return PLAIN_SEGMENT.test(s) ? s : ":id";
  });
  return `/${out.join("/")}`.slice(0, PAGE_MAX);
}

export type DeviceClass = "mobile" | "desktop";

export const DEVICE_LABELS: Record<DeviceClass, string> = { mobile: "mobil", desktop: "számítógép" };

// Mobile or desktop, from the User-Agent header. Tablets count as mobile.
export function deviceClass(userAgent: string | null | undefined): DeviceClass {
  return /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(userAgent ?? "") ? "mobile" : "desktop";
}

// The browser family only, never the full string (spec 19). Order matters:
// Edge, Opera, Samsung and the in-app browsers also say "Chrome" or
// "Safari".
const BROWSERS: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB/, "Facebook"],
  [/Instagram/, "Instagram"],
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser/, "Samsung Internet"],
  [/Firefox\/|FxiOS/, "Firefox"],
  [/Chrome\/|CriOS|Chromium/, "Chrome"],
  [/Safari\//, "Safari"],
];

export function browserFamily(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  return BROWSERS.find(([re]) => re.test(ua))?.[1] ?? "Egyéb";
}

// --- Rate limits ----------------------------------------------------------------

// Spec 19 (defaults, Peter may change them): an account 5 messages an hour
// and 20 a day; logged-out visitors together 30 an hour. Rolling windows,
// counted on stored rows, so no IP address is needed.
export type RateWindow = { seconds: number; max: number };
export const ACCOUNT_LIMITS: readonly RateWindow[] = [
  { seconds: 60 * 60, max: 5 },
  { seconds: 24 * 60 * 60, max: 20 },
];
export const VISITOR_LIMITS: readonly RateWindow[] = [{ seconds: 60 * 60, max: 30 }];

export const rateLimits = (userId: string | null): readonly RateWindow[] => (userId ? ACCOUNT_LIMITS : VISITOR_LIMITS);

// Whether one more message is allowed, given how many were stored in each
// window (same order as `windows`).
export function withinLimits(windows: readonly RateWindow[], counts: readonly number[]): boolean {
  return windows.every((w, i) => (counts[i] ?? 0) < w.max);
}
