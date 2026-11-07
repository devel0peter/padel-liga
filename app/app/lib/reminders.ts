// Automatic reminders for people stuck before entering a season (#155, spec
// section 13). Pure (no I/O), so every situation, exclusion and the
// once-only and deadline rules are unit tested; the D1 side is
// reminders.server.ts, the texts are in email/templates.ts.
//
// Three situations, each reminded once (D once per pair and season):
//   B  started an account (first login), first-login page not done, 24 hours
//   C  registered, no pair in the league, "Párt keresek" off, 2 days
//   D  active pair, no entry in the season accepting entries, 2 days
// (A, an invited address on the interest list without an account, went with
// the list: #333, D129. Its old records stay in stuck_reminders.)
// Only for the leagues a person belongs to (D128), and only while the league
// has a season accepting entries (registration opened, last phase not
// started), since every reminder gives its dates. When its registration
// deadline is under 24 hours away, a reminder goes out after 24 hours instead
// of its full waiting time, never sooner (#191). A person gets at most one
// reminder per league season, whatever the situation (#191, by address): due
// in two, they get the earlier one's (B before C before D) and never the
// other that season; D then goes to the other player only.

import { isSeeking } from "./partner-search";
import { entryOpen } from "./season-entries";
import { homeSeasons, isWaiting, type Season } from "./seasons";

export const SITUATIONS = ["B", "C", "D"] as const;
export type Situation = (typeof SITUATIONS)[number];

// How the switch page names them.
export const SITUATION_LABELS: Record<Situation, string> = {
  B: "Félbehagyta a regisztrációt",
  C: "Regisztrált, nincs párja",
  D: "Van párja, nem nevezett",
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// How long someone is in a situation before the reminder.
export const WAIT_MS: Record<Situation, number> = { B: DAY, C: 2 * DAY, D: 2 * DAY };
// Under this before the registration deadline, the reminder waits only
// MIN_WAIT_MS.
export const DEADLINE_RUSH_MS = DAY;
// No reminder sooner than this after getting stuck (#191).
export const MIN_WAIT_MS = DAY;

export type ReminderLeague = { id: number; city: string; name: string };

export type ReminderAccount = {
  id: string;
  // Lowercase.
  email: string;
  name: string;
  consentAt: Date | null;
  createdAt: Date;
  admin: boolean;
  // Switched email off on the profile (#115).
  emailOff: boolean;
};

export type ReminderPair = {
  id: number;
  leagueId: number;
  playerA: string;
  playerB: string;
  status: "active" | "dissolved";
  createdAt: Date;
  dissolvedAt: Date | null;
};

export type ReminderInput = {
  now: Date;
  // The leagues players can play in (listed cities), with their seasons.
  leagues: readonly ReminderLeague[];
  seasons: readonly Season[];
  accounts: readonly ReminderAccount[];
  // The league_members rows (D128); a pair of the league counts too.
  members: readonly { leagueId: number; userId: string }[];
  pairs: readonly ReminderPair[];
  // Every season entry, whatever its status: an entry pending approval or
  // rejected isn't reminded either.
  entries: readonly { seasonId: number; pairId: number }[];
  partnerSearches: readonly { leagueId: number; userId: string; seeking: boolean; updatedAt: Date }[];
  // Unsubscribed, bounced or complained addresses, lowercase.
  suppressed: ReadonlySet<string>;
  // Keys of the reminders already sent (reminderKey).
  sent: ReadonlySet<string>;
  // Who got a reminder in which season (personKey), any situation (#191).
  reminded: ReadonlySet<string>;
};

export type ReminderRecipient = {
  email: string;
  name: string;
  userId: string;
  // D: the other player of the pair.
  partner: string | null;
};

export type Reminder = {
  situation: Situation;
  key: string;
  leagueId: number;
  season: Season;
  recipients: ReminderRecipient[];
};

// What makes a reminder once-only: B and C per account, D per pair and
// season.
export function reminderKey(situation: Situation, id: string | number, seasonId?: number): string {
  return situation === "D" ? `D:${id}:${seasonId}` : `${situation}:${id}`;
}

// What makes a person reminded for the season (#191): the season and the
// address, lowercase.
export function personKey(seasonId: number, email: string): string {
  return `${seasonId}:${email.toLowerCase()}`;
}

// The season of the league that accepts entries now, the earliest if more do.
// A first season waiting for its minimum entries (D124) has no deadline or
// round to name, so it sends no reminder.
export function entrySeason(seasons: readonly Season[], leagueId: number, now: Date): Season | null {
  return homeSeasons(seasons, now).find((s) => s.leagueId === leagueId && !isWaiting(s) && entryOpen(s, now)) ?? null;
}

// Due: in the situation since `since` for its waiting time, or for 24 hours
// when the deadline is under 24 hours away (and hasn't passed).
export function isDue(situation: Situation, since: Date, season: Pick<Season, "registrationClosesAt">, now: Date): boolean {
  const stuck = now.getTime() - since.getTime();
  if (stuck >= WAIT_MS[situation]) return true;
  if (!season.registrationClosesAt) return false;
  const left = season.registrationClosesAt.getTime() - now.getTime();
  return stuck >= MIN_WAIT_MS && left > 0 && left < DEADLINE_RUSH_MS;
}

// The next phase that hasn't started: "the next round" in the reminders.
export function nextPhase(season: Pick<Season, "phases">, now: Date): Season["phases"][number] | null {
  return [...season.phases].sort((a, b) => a.number - b.number).find((p) => p.startsAt > now) ?? null;
}

const latest = (...dates: (Date | null | undefined)[]) =>
  new Date(Math.max(...dates.filter((d): d is Date => !!d).map((d) => d.getTime())));

// Every reminder due now in the given leagues (the ones with the switch on),
// not sent before, each person in at most one, and only people not reminded
// in that season yet. Pass all leagues to count what the switch would send.
export function dueReminders(input: ReminderInput, leagueIds: readonly number[]): Reminder[] {
  const { now } = input;
  const enabled = input.leagues.filter((l) => leagueIds.includes(l.id));
  const seasonOf = new Map<number, Season>();
  for (const l of enabled) {
    const s = entrySeason(input.seasons, l.id, now);
    if (s) seasonOf.set(l.id, s);
  }
  if (seasonOf.size === 0) return [];

  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  // An account's leagues (D128, league-members.server.ts): those it joined
  // (the register button joins at login, before the first-login page, so B
  // knows it) or has a pair in. In none: no reminder.
  const memberOf = new Set([
    ...input.members.map((m) => `${m.leagueId}:${m.userId}`),
    ...input.pairs.flatMap((p) => [`${p.leagueId}:${p.playerA}`, `${p.leagueId}:${p.playerB}`]),
  ]);
  const accountLeagues = (id: string): ReminderLeague[] =>
    enabled.filter((l) => memberOf.has(`${l.id}:${id}`) && seasonOf.has(l.id));
  const mailable = (email: string, account?: ReminderAccount) =>
    !input.suppressed.has(email) && !account?.admin && !account?.emailOff;

  const out: Reminder[] = [];
  const taken = new Set<string>();
  const add = (r: Reminder) => {
    const recipients = r.recipients.filter((p) => !input.reminded.has(personKey(r.season.id, p.email)));
    if (input.sent.has(r.key) || recipients.length === 0 || recipients.some((p) => taken.has(p.email))) return;
    for (const p of recipients) taken.add(p.email);
    out.push({ ...r, recipients });
  };

  // B: accounts that never finished the first-login page.
  for (const a of input.accounts) {
    if (a.consentAt || !mailable(a.email, a)) continue;
    const league = accountLeagues(a.id)[0];
    const season = league && seasonOf.get(league.id);
    if (!league || !season || !isDue("B", a.createdAt, season, now)) continue;
    add({
      situation: "B",
      key: reminderKey("B", a.id),
      leagueId: league.id,
      season,
      recipients: [{ email: a.email, name: a.name, userId: a.id, partner: null }],
    });
  }

  // C: registered players without a pair in one of their leagues, "Párt
  // keresek" off (its default since #333).
  const active = input.pairs.filter((p) => p.status === "active");
  const inPair = (userId: string, leagueId: number) =>
    active.some((p) => p.leagueId === leagueId && (p.playerA === userId || p.playerB === userId));
  for (const a of input.accounts) {
    if (!a.consentAt || !mailable(a.email, a)) continue;
    for (const league of accountLeagues(a.id)) {
      if (inPair(a.id, league.id)) continue;
      const stored = input.partnerSearches.find((s) => s.leagueId === league.id && s.userId === a.id);
      if (isSeeking(stored?.seeking)) continue;
      const dissolved = input.pairs
        .filter((p) => p.leagueId === league.id && (p.playerA === a.id || p.playerB === a.id))
        .map((p) => p.dissolvedAt);
      const since = latest(a.consentAt, ...dissolved, stored && !stored.seeking ? stored.updatedAt : null);
      const season = seasonOf.get(league.id)!;
      if (!isDue("C", since, season, now)) continue;
      add({
        situation: "C",
        key: reminderKey("C", a.id),
        leagueId: league.id,
        season,
        recipients: [{ email: a.email, name: a.name, userId: a.id, partner: null }],
      });
      break;
    }
  }

  // D: active pairs without an entry in the season accepting entries.
  for (const p of active) {
    const season = seasonOf.get(p.leagueId);
    if (!season || input.entries.some((e) => e.seasonId === season.id && e.pairId === p.id)) continue;
    if (!isDue("D", latest(p.createdAt, season.registrationOpensAt), season, now)) continue;
    const a = accountById.get(p.playerA);
    const b = accountById.get(p.playerB);
    if (!a || !b) continue;
    const recipients = [
      [a, b],
      [b, a],
    ]
      .filter(([to]) => mailable(to.email, to))
      .map(([to, other]) => ({ email: to.email, name: to.name, userId: to.id, partner: other.name }));
    if (recipients.length === 0) continue;
    add({ situation: "D", key: reminderKey("D", p.id, season.id), leagueId: p.leagueId, season, recipients });
  }

  return out;
}

// How many people each reminder reaches.
export function countBySituation(reminders: readonly Reminder[]): Record<Situation, number> {
  const counts = { B: 0, C: 0, D: 0 };
  for (const r of reminders) counts[r.situation] += r.recipients.length;
  return counts;
}
