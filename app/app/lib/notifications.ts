// In-app notifications and web push: which kinds exist, who gets them, and
// their Hungarian text. Pure; storage and sending are in
// notifications.server.ts, encryption in push/webpush.ts.

import type { Actor } from "./auth/permissions";
import { LEVELS, type Level, type Mode } from "./interest";

// The kinds a user can switch off on the profile page. "test" (the profile's
// "Próba" button) is always on.
export const NOTIFICATION_KINDS = {
  new_signup: {
    label: "Új jelentkező",
    description: "Ha valaki jelentkezik a ligádba.",
  },
} as const;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;
export type StoredKind = NotificationKind | "test";

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && Object.hasOwn(NOTIFICATION_KINDS, value);
}

// The kinds that can reach this user, so the profile only offers those.
export function kindsFor(actor: Pick<Actor, "platformRole" | "leagues">): NotificationKind[] {
  return actor.platformRole === "superadmin" || actor.leagues.length > 0 ? ["new_signup"] : [];
}

// No row means on: a setting is stored only once someone changes it.
export function isEnabled(disabled: ReadonlySet<string>, kind: StoredKind): boolean {
  return kind === "test" || !disabled.has(kind);
}

export type Message = { title: string; body: string; url: string };

export type SignupRecipient = { userId: string; admin: boolean; leagueSlug: string | null };

// A new signup goes to the Szervezők of that city's league and to every
// Admin, once each. An Admin who is also the Szervező gets the Admin link.
export function signupRecipients(
  city: string,
  organizers: readonly { userId: string; city: string; leagueSlug: string }[],
  adminIds: readonly string[],
): SignupRecipient[] {
  const out = new Map<string, SignupRecipient>();
  for (const id of adminIds) out.set(id, { userId: id, admin: true, leagueSlug: null });
  for (const o of organizers)
    if (o.city === city && !out.has(o.userId)) out.set(o.userId, { userId: o.userId, admin: false, leagueSlug: o.leagueSlug });
  return [...out.values()];
}

export type SignupSummary = {
  mode: Mode;
  level: Level;
  cityName: string;
  // The city's signups so far, this one included (withdrawn ones not counted).
  pairs: number;
  solos: number;
};

// "Kezdő – most ismerkedünk…" -> "kezdő"
const levelWord = (level: Level) => LEVELS[level].split(" – ")[0].toLowerCase();

// No names or email addresses: a Szervező doesn't see the pair signups, and a
// lock screen is not a private place.
export function newSignupMessage(s: SignupSummary, to: SignupRecipient): Message {
  const who = s.mode === "pair" ? `Új pár jelentkezett, ${levelWord(s.level)} szint.` : `Új egyéni jelentkező (párt keres), ${levelWord(s.level)} szint.`;
  const url = to.admin || !to.leagueSlug
    ? "/admin/signups"
    : s.mode === "solo"
      ? `/admin/leagues/${to.leagueSlug}/solos`
      : `/admin/leagues/${to.leagueSlug}`;
  return {
    title: `Új jelentkező · ${s.cityName}`,
    body: `${who} Eddig ${s.pairs} pár és ${s.solos} egyéni jelentkező.`,
    url,
  };
}

export const TEST_MESSAGE: Message = {
  title: "Próba értesítés",
  body: "Ha ezt látod, működnek az értesítések ezen az eszközön.",
  url: "/notifications",
};

// What the service worker (public/sw.js) shows. `url` opens the
// notification through /notifications/<id>, which marks it read.
export type PushPayload = { title: string; body: string; url: string; tag: string };

export function pushPayload(id: number, m: Message): PushPayload {
  return { title: m.title, body: m.body, url: `/notifications/${id}`, tag: `n${id}` };
}

// Only paths on this site, so a stored link can't send anyone elsewhere.
export function safeTarget(url: string): string {
  return url.startsWith("/") && !url.startsWith("//") ? url : "/notifications";
}

// "most", "5 perce", "3 órája", "tegnap", "4 napja", then the date.
export function timeAgo(date: Date, now: Date, formatDate: (d: Date) => string): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "most";
  if (minutes < 60) return `${minutes} perce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} órája`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "tegnap";
  if (days < 7) return `${days} napja`;
  return formatDate(date);
}

// The browser push services we deliver to. The endpoint comes from the
// browser, and the server POSTs to it, so nothing else is accepted.
const PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge, Android
  ".push.services.mozilla.com", // Firefox
  ".push.apple.com", // Safari, iPhone
  ".notify.windows.com", // older Edge
];

export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((h) => (h.startsWith(".") ? url.hostname.endsWith(h) || url.hostname === h.slice(1) : url.hostname === h));
}

export type SubscriptionInput = { endpoint: string; p256dh: string; auth: string };

// PushSubscription.toJSON() as posted by the profile page: a P-256 public key
// (65 bytes) and a 16-byte auth secret, both base64url.
export function parseSubscription(form: FormData): SubscriptionInput | null {
  const [endpoint, p256dh, auth] = ["endpoint", "p256dh", "auth"].map((k) => form.get(k));
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (!isPushEndpoint(endpoint) || endpoint.length > 1000) return null;
  if (!/^[A-Za-z0-9_-]{87}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}
