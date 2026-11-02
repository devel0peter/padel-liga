// Automatic reminders for people stuck before entering a season (#155, spec
// section 13). Pure (no I/O), so every situation, exclusion and the
// once-only and deadline rules are unit tested; the D1 side is
// reminders.server.ts, the texts are in email/templates.ts.
//
// Four situations, each reminded once (D once per pair and season):
//   A  on the interest list, got the registration invite, no account, 2 days
//   B  started an account (first login), first-login page not done, 24 hours
//   C  registered, no pair in the league, "Párt keresek" off, 2 days
//   D  active pair, no entry in the season accepting entries, 2 days
// Only while the league has a season accepting entries (registration opened,
// last phase not started), since every reminder gives its dates. When its
// registration deadline is under 24 hours away, a reminder whose waiting
// time hasn't passed goes out right away. A person due in two situations
// gets only the earlier one's (A before B before C before D).

import { isSeeking } from "./partner-search";
import { entryOpen } from "./season-entries";
import { homeSeasons, type Season } from "./seasons";

export const SITUATIONS = ["A", "B", "C", "D"] as const;
export type Situation = (typeof SITUATIONS)[number];

// How the switch page names them.
export const SITUATION_LABELS: Record<Situation, string> = {
  A: "Meghívót kapott, nem regisztrált",
  B: "Félbehagyta a regisztrációt",
  C: "Regisztrált, nincs párja",
  D: "Van párja, nem nevezett",
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// How long someone is in a situation before the reminder.
export const WAIT_MS: Record<Situation, number> = { A: 2 * DAY, B: DAY, C: 2 * DAY, D: 2 * DAY };
// Under this before the registration deadline, the reminder doesn't wait.
export const DEADLINE_RUSH_MS = DAY;

export type ReminderLeague = { id: number; city: string; name: string };

export type ReminderSignup = {
  id: number;
  mode: "pair" | "solo";
  city: string;
  status: string;
  name1: string;
  email1: string;
  name2: string | null;
  email2: string | null;
  pairedWith: number | null;
  invitedAt: Date | null;
  invited2At: Date | null;
};

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
  signups: readonly ReminderSignup[];
  accounts: readonly ReminderAccount[];
  pairs: readonly ReminderPair[];
  // Every season entry, whatever its status: an entry pending approval or
  // rejected isn't reminded either.
  entries: readonly { seasonId: number; pairId: number }[];
  partnerSearches: readonly { leagueId: number; userId: string; seeking: boolean; updatedAt: Date }[];
  // Unsubscribed, bounced or complained addresses, lowercase.
  suppressed: ReadonlySet<string>;
  // Keys of the reminders already sent (reminderKey).
  sent: ReadonlySet<string>;
};

export type ReminderRecipient = {
  email: string;
  name: string;
  userId: string | null;
  // A: the partner of the pair signup, when they already registered.
  // C: the partner the signup names, when they haven't registered.
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

// What makes a reminder once-only: A per address, B and C per account, D per
// pair and season.
export function reminderKey(situation: Situation, id: string | number, seasonId?: number): string {
  return situation === "D" ? `D:${id}:${seasonId}` : `${situation}:${id}`;
}

// The season of the league that accepts entries now, the earliest if more do.
export function entrySeason(seasons: readonly Season[], leagueId: number, now: Date): Season | null {
  return homeSeasons(seasons, now).find((s) => s.leagueId === leagueId && entryOpen(s, now)) ?? null;
}

// Due: in the situation since `since` for its waiting time, or the deadline
// is under 24 hours away (and hasn't passed).
export function isDue(situation: Situation, since: Date, season: Pick<Season, "registrationClosesAt">, now: Date): boolean {
  if (now.getTime() - since.getTime() >= WAIT_MS[situation]) return true;
  const left = season.registrationClosesAt.getTime() - now.getTime();
  return left > 0 && left < DEADLINE_RUSH_MS;
}

// The next phase that hasn't started: "the next round" in the reminders.
export function nextPhase(season: Pick<Season, "phases">, now: Date): Season["phases"][number] | null {
  return [...season.phases].sort((a, b) => a.number - b.number).find((p) => p.startsAt > now) ?? null;
}

const latest = (...dates: (Date | null | undefined)[]) =>
  new Date(Math.max(...dates.filter((d): d is Date => !!d).map((d) => d.getTime())));

// Every reminder due now in the given leagues (the ones with the switch on),
// not sent before, each person in at most one. Pass all leagues to count
// what the switch would send.
export function dueReminders(input: ReminderInput, leagueIds: readonly number[]): Reminder[] {
  const { now } = input;
  const enabled = input.leagues.filter((l) => leagueIds.includes(l.id));
  const seasonOf = new Map<number, Season>();
  for (const l of enabled) {
    const s = entrySeason(input.seasons, l.id, now);
    if (s) seasonOf.set(l.id, s);
  }
  if (seasonOf.size === 0) return [];

  const accountByEmail = new Map(input.accounts.map((a) => [a.email, a]));
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));
  const registered = (email: string | null) => !!email && !!accountByEmail.get(email.toLowerCase())?.consentAt;
  const live = input.signups.filter((s) => s.status !== "withdrawn");
  const leaguesInCity = (city: string) => enabled.filter((l) => l.city === city && seasonOf.has(l.id));
  // An account's leagues: those of its signups' cities, or, without a
  // signup, every league (open sign-up happens on a league city's page).
  // Signups only in cities without a league: none. A withdrawn signup still
  // says where: the account counts over the signup (signup-progress.ts).
  const accountLeagues = (email: string): ReminderLeague[] => {
    const own = input.signups.filter((s) => s.email1.toLowerCase() === email || s.email2?.toLowerCase() === email);
    if (own.length === 0) return enabled.filter((l) => seasonOf.has(l.id));
    const cities = new Set(own.map((s) => s.city));
    return enabled.filter((l) => cities.has(l.city) && seasonOf.has(l.id));
  };
  const mailable = (email: string, account?: ReminderAccount) =>
    !input.suppressed.has(email) && !account?.admin && !account?.emailOff;

  const out: Reminder[] = [];
  const taken = new Set<string>();
  const add = (r: Reminder) => {
    if (input.sent.has(r.key) || r.recipients.some((p) => taken.has(p.email))) return;
    for (const p of r.recipients) taken.add(p.email);
    out.push(r);
  };

  // A: invited addresses without an account, by their earliest invite.
  const invited = new Map<string, { at: Date; name: string; city: string; partner: string | null }>();
  for (const s of live) {
    const sides: [string | null, string | null, Date | null, string | null, string | null][] = [
      [s.email1, s.name1, s.invitedAt, s.email2, s.name2],
      [s.mode === "pair" ? s.email2 : null, s.name2, s.invited2At, s.email1, s.name1],
    ];
    for (const [email, name, at, partnerEmail, partnerName] of sides) {
      if (!email || !at) continue;
      const key = email.toLowerCase();
      const partner = s.mode === "pair" && partnerName && registered(partnerEmail) ? partnerName : null;
      const seen = invited.get(key);
      if (!seen || at < seen.at)
        invited.set(key, { at, name: name ?? "", city: s.city, partner: partner ?? seen?.partner ?? null });
      else if (partner && !seen.partner) seen.partner = partner;
    }
  }
  for (const [email, p] of [...invited].sort(([a], [b]) => a.localeCompare(b))) {
    if (accountByEmail.has(email) || !mailable(email)) continue;
    const league = leaguesInCity(p.city)[0];
    const season = league && seasonOf.get(league.id);
    if (!league || !season || !isDue("A", p.at, season, now)) continue;
    add({
      situation: "A",
      key: reminderKey("A", email),
      leagueId: league.id,
      season,
      recipients: [{ email, name: p.name, userId: null, partner: p.partner }],
    });
  }

  // B: accounts that never finished the first-login page.
  for (const a of input.accounts) {
    if (a.consentAt || !mailable(a.email, a)) continue;
    const league = accountLeagues(a.email)[0];
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

  // C: registered players without a pair in one of their leagues.
  const active = input.pairs.filter((p) => p.status === "active");
  const inPair = (userId: string, leagueId: number) =>
    active.some((p) => p.leagueId === leagueId && (p.playerA === userId || p.playerB === userId));
  const waitingSolo = (email: string, city: string) => {
    const byId = new Map(input.signups.map((s) => [s.id, s]));
    return live.some((s) => {
      if (s.mode !== "solo" || s.city !== city || s.email1.toLowerCase() !== email) return false;
      const partner = s.pairedWith == null ? null : byId.get(s.pairedWith);
      return s.pairedWith == null || !partner || registered(partner.email1);
    });
  };
  for (const a of input.accounts) {
    if (!a.consentAt || !mailable(a.email, a)) continue;
    for (const league of accountLeagues(a.email)) {
      if (inPair(a.id, league.id)) continue;
      const stored = input.partnerSearches.find((s) => s.leagueId === league.id && s.userId === a.id);
      if (isSeeking(stored?.seeking, waitingSolo(a.email, league.city))) continue;
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
        recipients: [{ email: a.email, name: a.name, userId: a.id, partner: unregisteredPartner(live, a.email, registered) }],
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

// The partner a pair signup names who hasn't registered yet (C), by name.
function unregisteredPartner(
  signups: readonly ReminderSignup[],
  email: string,
  registered: (email: string | null) => boolean,
): string | null {
  for (const s of signups) {
    if (s.mode !== "pair") continue;
    if (s.email1.toLowerCase() === email && s.name2 && !registered(s.email2)) return s.name2;
    if (s.email2?.toLowerCase() === email && !registered(s.email1)) return s.name1;
  }
  return null;
}

// How many people each reminder reaches.
export function countBySituation(reminders: readonly Reminder[]): Record<Situation, number> {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const r of reminders) counts[r.situation] += r.recipients.length;
  return counts;
}
