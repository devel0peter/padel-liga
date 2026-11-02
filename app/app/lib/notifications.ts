// In-app notifications and web push: which kinds exist, who gets them, and
// their Hungarian text. Pure; storage and sending are in
// notifications.server.ts, encryption in push/webpush.ts.

import type { Actor } from "./auth/permissions";
import type { MessageKind } from "./email/budget";
import { formatDeadline, formatShortDate } from "./format";
import { withArticle } from "./groups";
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
// Player notifications have no per-kind switch (#115), only the channels.
export type PlayerKind =
  | "season_entry_decision"
  | "groups_published"
  | "pair_intro"
  // Scheduling (#26, spec 13). Instant: also by email.
  | "match_proposal"
  | "match_agreed_time"
  // Daily-digest items (#31 builds the digest email from these): in the app
  // and by push only for now.
  | "match_scheduled"
  | "match_declined";

// The kinds the daily digest email (#31) collects; push sends them one by one.
export const DIGEST_KINDS: readonly PlayerKind[] = ["match_scheduled", "match_declined"];
export type StoredKind = NotificationKind | PlayerKind | "test";

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

// --- Channels (#115) --------------------------------------------------------
// Every user chooses on the profile whether notifications also come by email,
// by push, or both. Both are on by default: like a kind, a channel is stored
// (a notification_opt_outs row) only once it is switched off. The in-app list
// (/notifications) always gets every notification.

export const CHANNELS = {
  email: {
    label: "E-mail",
    description: "Levélben is megkapod az értesítéseket. A belépési kódot és a jelentkezésed visszaigazolását mindig elküldjük.",
  },
  push: {
    label: "Push értesítés",
    description: "A telefonod vagy a géped is szól, akkor is, ha nincs nyitva az oldal.",
  },
} as const;

export type Channel = keyof typeof CHANNELS;

// The opt-out row of a channel; no notification kind has a colon.
export const channelKey = (channel: Channel) => `channel:${channel}` as const;

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && Object.hasOwn(CHANNELS, value);
}

export function channelEnabled(disabled: ReadonlySet<string>, channel: Channel): boolean {
  return !disabled.has(channelKey(channel));
}

// Emails that go out whatever the email switch says: only login codes and
// signup confirmations (#115; Peter, 2026-10-29). Every other kind, a new one
// too, broadcasts and the signup-list emails included, is skipped for an
// address whose account switched email off. Addresses without an account
// can't switch, so they get everything as before.
export const EMAIL_ALWAYS: readonly MessageKind[] = ["login_code", "signup_confirmation"];

export function followsEmailSwitch(kind: MessageKind): boolean {
  return !EMAIL_ALWAYS.includes(kind);
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
  // Ticked "Szívesen szerveznék ligát".
  organize?: boolean;
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
    body: `${who}${s.organize ? " Szívesen szervezne ligát." : ""} Eddig ${s.pairs} pár és ${s.solos} egyéni jelentkező.`,
    url,
  };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// A Szervező decided on the pair's season entry (#23). No names (a lock
// screen is not a private place); the note is on the Párom page.
export function seasonEntryDecisionMessage(input: {
  league: string;
  season: string;
  approved: boolean;
  // Where an approved pair starts; null: the next season.
  joins: { phase: number; startsAt: Date } | null;
}): Message {
  const start = !input.approved
    ? null
    : input.joins === null
      ? "A következő szezontól játszotok."
      : `${capitalize(withArticle(input.joins.phase))} körtől játszotok (kezdés: ${formatShortDate(input.joins.startsAt)}).`;
  return {
    title: input.approved ? "Jóváhagyták a nevezéseteket" : "Nem fogadták el a nevezéseteket",
    body: [`${input.season}, ${input.league}.`, start].filter(Boolean).join(" "),
    url: "/pair",
  };
}

// The groups are published (#24): the group and the deadline. The opponents
// are on the home page and in the email.
export function groupsPublishedMessage(input: {
  league: string;
  season: string;
  phase: number;
  group: number;
  deadline: Date;
}): Message {
  return {
    title: `Itt a csoportod: ${input.group}. csoport`,
    body: `${input.phase}. kör, ${input.season}, ${input.league}. Határidő: ${formatDeadline(input.deadline)}.`,
    url: "/home",
  };
}

// A Szervező paired two solo signups (#115): for the one who has an account,
// so it reaches them with email off too. No names; Párom shows the partner.
export function pairIntroMessage(cityName: string): Message {
  return {
    title: "Párt találtunk neked",
    body: `A szervező párba tett egy másik egyéni jelentkezővel (${cityName}). A Párom oldalon látod, ki az.`,
    url: "/pair",
  };
}

// A Szervező paired two registered players who asked for a partner ("Párt
// keresek", D59). In the app and as a push only, no email: Párom shows the
// partner.
export function partnerFoundMessage(league: string): Message {
  return {
    title: "Párt találtunk neked",
    body: `A szervező párba tett valakivel (${league}). A Párom oldalon látod, ki az.`,
    url: "/pair",
  };
}

// --- Scheduling a match (#26, spec 13) ---------------------------------------
// No names (a lock screen is not a private place): the match page shows them.
// Each links to the match page, where the action is.

const matchUrl = (matchId: number) => `/matches/${matchId}`;

// To the other pair: a proposal or counter-proposal arrived (instant).
export function matchProposalMessage(input: { matchId: number; week: number; counter: boolean; slots: number }): Message {
  return {
    title: input.counter ? "Új időpontokat ajánlottak" : "Időpontokat ajánlottak",
    body: `Az ellenfeletek ${input.slots} időpontot ajánlott a ${input.week}. heti meccsetekre. Válassz egyet, vagy ajánlj másikat.`,
    url: matchUrl(input.matchId),
  };
}

// To the other pair: an agreed time waits for confirmation (instant).
export function matchAgreedTimeMessage(input: { matchId: number; slot: Date }): Message {
  return {
    title: "Erősítsd meg az időpontot",
    body: `Az ellenfeletek rögzítette a megbeszélt időpontot: ${formatDeadline(input.slot)}. Erősítsd meg, vagy jelezd, ha nem így beszéltétek.`,
    url: matchUrl(input.matchId),
  };
}

// To the pair that proposed or recorded: the match is scheduled (digest item).
export function matchScheduledMessage(input: { matchId: number; slot: Date; confirmed: boolean }): Message {
  return {
    title: "Lefixálva a meccsetek",
    body: `Az ellenfeletek ${input.confirmed ? "megerősítette a megbeszélt időpontot" : "elfogadta az időpontot"}: ${formatDeadline(input.slot)}.`,
    url: matchUrl(input.matchId),
  };
}

// To the pair that recorded an agreed time the other pair declined (digest item).
export function matchDeclinedMessage(input: { matchId: number; slot: Date }): Message {
  return {
    title: "Nem erősítették meg az időpontot",
    body: `Az ellenfeletek szerint nem ${formatDeadline(input.slot)} a meccs. Egyeztessetek újra.`,
    url: matchUrl(input.matchId),
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
