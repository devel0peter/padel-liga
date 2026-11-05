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
  result_disputed: {
    label: "Vitatott eredmény",
    description: "Ha egy pár vitatja a ligád egy meccsének eredményét, és te döntesz róla.",
  },
  substitute_requested: {
    label: "Helyettes kérés",
    description: "Ha egy pár helyettest kér a ligád egy meccsére, és te hagyod jóvá.",
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
  | "match_declined"
  | "match_cancelled"
  // Reminders (#31): digest items, except "holnap meccs", which is instant.
  | "match_no_proposal"
  | "match_week_end"
  | "match_deadline_soon"
  | "match_tomorrow"
  // Results (#28): waiting for confirmation is instant (also by email); a
  // confirmed or auto-accepted result and an organizer's decision (#29) are
  // digest items.
  | "match_result"
  | "match_result_confirmed"
  | "match_decided"
  // A dispute (#178): the recording pair is told at once, in the app and by
  // push, not in the digest (D83). The organizers' kind is `result_disputed`.
  | "match_result_disputed"
  // A pair withdrawn mid-phase (#34): to its players and the group's other
  // pairs, in the app and by push only, never by email.
  | "pair_withdrawn"
  // Substitutes (#37, D109), in the app and by push only, never by email:
  // the asking pair on approval, rejection and revocation; the opponents on
  // approval and revocation. The organizers' kind is `substitute_requested`.
  | "substitute_approved"
  | "substitute_rejected"
  | "substitute_revoked";

// The kinds the daily digest email (#31) collects; push sends them one by one.
// The digest is built from this list alone, so a kind added here is in it.
export const DIGEST_KINDS: readonly PlayerKind[] = [
  "match_scheduled",
  "match_declined",
  "match_cancelled",
  "match_no_proposal",
  "match_week_end",
  "match_deadline_soon",
  "match_result_confirmed",
  "match_decided",
];
export type StoredKind = NotificationKind | PlayerKind | "test";

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && Object.hasOwn(NOTIFICATION_KINDS, value);
}

// The kinds that can reach this user, so the profile only offers those.
export function kindsFor(actor: Pick<Actor, "platformRole" | "leagues">): NotificationKind[] {
  return actor.platformRole === "superadmin" || actor.leagues.length > 0 ? ["new_signup", "result_disputed", "substitute_requested"] : [];
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

// The pair's season entry counts (#153): one of them clicked "Nevezünk", or
// the organizer entered them from Párok (#154); or the organizer took them
// out of the season (#154). No names (a lock screen is not a private place).
export function seasonEntryMessage(
  input: {
    league: string;
    season: string;
    // Where the pair starts; null: the next season. Not used for "removed".
    joins: { phase: number; startsAt: Date } | null;
  },
  event: "entered" | "entered_by_organizer" | "removed" = "entered",
): Message {
  const where = `${input.season}, ${input.league}.`;
  if (event === "removed")
    return { title: "A szervező kivett titeket a szezonból", body: `${where} Ha kérdésetek van, írjatok neki.`, url: "/pair" };
  const start =
    input.joins === null
      ? "A következő szezontól játszotok."
      : `${capitalize(withArticle(input.joins.phase))} körtől játszotok (kezdés: ${formatShortDate(input.joins.startsAt)}).`;
  return {
    title: event === "entered" ? "Beneveztetek" : "A szervező benevezett titeket",
    body: `${where} ${start}`,
    url: "/pair",
  };
}

// A pair withdrawn mid-phase (#34). To its own players, with the
// organizer's reason; to the group's other pairs, no names (a lock screen is
// not a private place) and no reason (it may be about someone's health).
export function pairWithdrawnMessage(
  input: { league: string; season: string; phase: number; group: number; reason: string },
  to: "pair" | "group",
): Message {
  const where = `${input.group}. csoport, ${input.phase}. kör, ${input.season}, ${input.league}.`;
  if (to === "pair")
    return {
      title: "A szervező visszaléptetett titeket a körből",
      body: `${where} A meccseitek nem számítanak, és a szezonból is kikerültetek. Ha újra játszanátok, szóljatok a szervezőnek. Indok: ${input.reason}`,
      url: "/pair",
    };
  return {
    title: "Visszalépett egy pár a csoportodból",
    body: `${where} A meccseik kikerültek a tabellából, a lejátszottak is. A csoport nélkülük folytatja.`,
    url: "/home",
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
// keresek", D59; Párok, #260). In the app and as a push; the email is
// pairCreated. Párom shows the partner.
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

// To the other pair: the scheduled slot was cancelled (#27, digest item). A
// late cancellation says the cancelling pair proposes next (spec 6.6).
export function matchCancelledMessage(input: { matchId: number; slot: Date; late: boolean }): Message {
  return {
    title: "Lemondták a meccset",
    body: input.late
      ? `Az ellenfeletek 24 órán belül lemondta a ${formatDeadline(input.slot)} időpontot. Nekik kell új időpontokat ajánlaniuk.`
      : `Az ellenfeletek lemondta a ${formatDeadline(input.slot)} időpontot. Egyeztessetek újra.`,
    url: matchUrl(input.matchId),
  };
}

// --- Results (#28) and organizer decisions (#29, spec 13) --------------------
// No names; the score from the recipient's side ("ti" first).

// To the other pair: a result waits for confirmation (instant).
export function matchResultMessage(input: { matchId: number; score: string }): Message {
  return {
    title: "Erősítsd meg az eredményt",
    body: `Az ellenfeletek rögzítette az eredményt: ${input.score}. Erősítsd meg, vagy jelezd, ha nem így volt. 48 óra múlva magától elfogadjuk.`,
    url: matchUrl(input.matchId),
  };
}

// To both pairs: the result counts (digest item).
export function matchResultConfirmedMessage(input: { matchId: number; score: string; auto: boolean }): Message {
  return {
    title: "Végleges az eredmény",
    body: input.auto ? `48 óra után magától elfogadtuk az eredményt: ${input.score}.` : `Megerősítették az eredményt: ${input.score}.`,
    url: matchUrl(input.matchId),
  };
}

// To the pair that recorded the result: the other pair disputes it (instant,
// #178). No names and no score: the match page has both versions.
export function matchResultDisputedMessage(input: { matchId: number }): Message {
  return {
    title: "Vitatják az eredményt",
    body: "Az ellenfeletek nem ért egyet a rögzített eredménnyel. A szervező dönt, szólunk, ha megvan.",
    url: matchUrl(input.matchId),
  };
}

// A dispute goes to the league's Szervezők and to every Admin, once each
// (#178). All of them open the league's decision page. The player who
// disputed is left out even if they organize: no notice about their own step (#221).
export function disputeRecipients(organizerIds: readonly string[], adminIds: readonly string[], disputedBy: string): string[] {
  return [...new Set([...adminIds, ...organizerIds])].filter((id) => id !== disputedBy);
}

// To the organizers and Admins (app and push, never email). No names: the
// decision page shows both versions.
export function resultDisputedMessage(input: { matchId: number; leagueSlug: string; leagueName: string; week: number }): Message {
  return {
    title: `Vitatott eredmény · ${input.leagueName}`,
    body: `A ${input.week}. heti meccsek egyikének eredményét vitatják. A döntés rád vár.`,
    url: `/admin/leagues/${input.leagueSlug}/matches/${input.matchId}/decide`,
  };
}

// --- Substitutes (#37, D109) ------------------------------------------------

// To the league's Szervezők and the Admins (app and push, never email), the
// asking player left out. No names: the list shows them.
export function substituteRequestedMessage(input: { leagueSlug: string; leagueName: string; week: number }): Message {
  return {
    title: `Helyettes kérés · ${input.leagueName}`,
    body: `Egy pár helyettest kér a ${input.week}. heti meccsére. A jóváhagyás rád vár.`,
    url: `/admin/leagues/${input.leagueSlug}/substitutes`,
  };
}

export type SubstituteNotice = { matchId: number; substitute: string; absent: string };

// The organizer's answer to the asking pair. The reason is on the match page only.
export function substituteDecidedMessage(input: SubstituteNotice & { approved: boolean }): Message {
  return input.approved
    ? {
        title: "Jóváhagyták a helyettest",
        body: `${input.substitute} játszhat ${input.absent} helyett. Az ellenfeleitek is látják.`,
        url: matchUrl(input.matchId),
      }
    : {
        title: "Nem hagyták jóvá a helyettest",
        body: `${input.substitute} nem játszhat ${input.absent} helyett. A részleteket a meccs oldalán látod.`,
        url: matchUrl(input.matchId),
      };
}

// To the opponents once a substitute is approved.
export function substituteAnnouncedMessage(input: SubstituteNotice): Message {
  return {
    title: "Helyettes az ellenfeleteknél",
    body: `${input.absent} helyett ${input.substitute} játszik a meccseteken.`,
    url: matchUrl(input.matchId),
  };
}

// An approval revoked before the match: to both pairs.
export function substituteRevokedMessage(input: SubstituteNotice & { ours: boolean }): Message {
  return {
    title: "Visszavonták a helyettest",
    body: input.ours
      ? `${input.substitute} mégsem játszhat ${input.absent} helyett. A részleteket a meccs oldalán látod.`
      : `${input.absent} helyett mégsem ${input.substitute} játszik a meccseteken.`,
    url: matchUrl(input.matchId),
  };
}

// To both pairs: the organizer decided or overrode the outcome (digest item).
// The reason is on the match page only.
export function matchDecidedMessage(input: { matchId: number; outcome: string }): Message {
  return {
    title: "A szervező döntött a meccsetekről",
    body: `${input.outcome}. Az indoklást a meccs oldalán látod.`,
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
