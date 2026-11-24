import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { pairs, partnerSearches, users } from "~/db/schema";
import { auditEntry } from "~/lib/audit.server";

import type { User } from "./auth/session.server";
import { finderEntries, searchState, type FinderEntry, type SearchState } from "./partner-search";
import { memberOf } from "./league-members.server";
import { pairLinkFor, pairLinkPath } from "./pair-links.server";
import { activePairWith, createPair, type PairLeague } from "./pairs.server";
import { LEVELS } from "./interest";
import { formatPhone } from "./phone";

// "Párt keresek" in D1 (D59). Párod sets it per league; Játékosok lists the
// league's registered players (D128) who look for a partner and have none in
// it. Off until the player switches it on (#333). Names, levels and, for the
// league's Szervező and the Admin, phone numbers (D126); never an email
// address. Párkereső (#398, D177): the league's listed seekers to its other
// players without a pair, phone and email only between two listed seekers
// (partnerFinder).

const LEVEL_ORDER: string[] = Object.keys(LEVELS);
const levelRank = (level: string) => (LEVEL_ORDER.includes(level) ? LEVEL_ORDER.indexOf(level) : LEVEL_ORDER.length);

// No active pair in the league for the player in `user` (a column).
const unpaired = (leagueId: number, user: typeof users.id) =>
  sql`not exists (select 1 from ${pairs} where ${pairs.leagueId} = ${leagueId} and ${pairs.status} = 'active'
    and (${pairs.playerA} = ${user} or ${pairs.playerB} = ${user}))`;

// Párod: per league where the player has no pair, whether the switch is on,
// and whether under the #398 wording (listed on Párkereső).
export async function partnerSearchState(user: Pick<User, "id">, list: PairLeague[]): Promise<Map<number, SearchState>> {
  if (list.length === 0) return new Map();
  const stored = await db
    .select({ leagueId: partnerSearches.leagueId, seeking: partnerSearches.seeking, listed: partnerSearches.listed })
    .from(partnerSearches)
    .where(
      and(
        eq(partnerSearches.userId, user.id),
        inArray(
          partnerSearches.leagueId,
          list.map((l) => l.id),
        ),
      ),
    );
  return new Map(list.map((l) => [l.id, searchState(stored.find((s) => s.leagueId === l.id))]));
}

// The switch. Only for a registered player, in a league they can have a pair in.
// `actorId`: the Admin switching it on the player's profile (#301); the
// entry then names the player. The player's own switch-on is under the #398
// wording, so it lists them on Párkereső; switching off unlists. An Admin's
// switch-on lists nobody: only the player agrees to show their phone and
// email to other players (D177).
export async function setPartnerSearch(
  user: Pick<User, "id" | "consentAt">,
  leagueId: number,
  seeking: boolean,
  list: PairLeague[],
  actorId = user.id,
): Promise<boolean> {
  if (!user.consentAt || !list.some((l) => l.id === leagueId)) return false;
  const own = actorId === user.id;
  const now = new Date();
  // An Admin's switch-on leaves `listed` as the player left it.
  const listed = own || !seeking ? { listed: own && seeking } : {};
  await db.batch([
    db
      .insert(partnerSearches)
      .values({ leagueId, userId: user.id, seeking, listed: own && seeking, updatedAt: now })
      .onConflictDoUpdate({ target: [partnerSearches.leagueId, partnerSearches.userId], set: { seeking, ...listed, updatedAt: now } }),
    auditEntry({
      actorId,
      action: seeking ? "partner_search.on" : "partner_search.off",
      target: own ? `league:${leagueId}` : `user:${user.id}`,
      detail: own ? null : `league:${leagueId}`,
      leagueId,
    }),
  ]);
  return true;
}

export type Seeker = {
  id: string;
  name: string;
  level: string;
  // Formatted, "" when none (D126: organizers only).
  phone: string;
  // When they switched it on.
  since: Date;
};

// The league's registered players (D128) without an active pair in it who
// switched "Párt keresek" on, by level, then longest waiting first: Játékosok's
// "Párt keres" (#301; Párkeresők before). Listed or not (D177): the organizer
// sees every seeker.
export async function leagueSeekers(league: { id: number }): Promise<Seeker[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, level: users.level, phone: users.phone, since: partnerSearches.updatedAt })
    .from(users)
    .innerJoin(partnerSearches, and(eq(partnerSearches.userId, users.id), eq(partnerSearches.leagueId, league.id), eq(partnerSearches.seeking, true)))
    .where(and(isNotNull(users.consentAt), memberOf(league.id, users.id), unpaired(league.id, users.id)));
  return rows
    .map((u) => ({ id: u.id, name: u.name, level: u.level ?? "", phone: formatPhone(u.phone), since: u.since }))
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.since.getTime() - b.since.getTime() || a.name.localeCompare(b.name, "hu"));
}

// "Párba teszem" for two seekers: the active pair at once (as "Pár
// létrehozása" on Párok, audited, but source "search": D113, #297), and a
// message in the app and an email for both (#260).
export async function pairSeekers(
  actorId: string,
  league: { id: number; name: string },
  a: string,
  b: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // createPair tells both players, in the app and by email (#260).
  return createPair(actorId, league.id, a, b, "search");
}

export type PartnerFinder =
  | { kind: "paired" }
  | {
      kind: "single";
      /** For the switch-on button, which posts to Profil's action. */
      leagueId: number;
      /** The viewer's own switch; only `listed` makes them a seeker the others see (D177). */
      search: SearchState;
      /** The other listed seekers, newest first; with phone and email only when `search.listed`. */
      seekers: FinderEntry[];
      /** The path of the viewer's own pair link (D55), the same as on Kezdőlap. */
      link: string;
    };

/**
 * Párkereső (#398, D177) in one league for the player: null when they aren't
 * a registered player of it (D128). With a pair, only that. Without one, the
 * league's listed seekers: its registered players without an active pair who
 * switched "Párt keresek" on under the #398 wording. Phone and email are read
 * only when the viewer is a listed seeker too: contact is mutual, and never
 * leaves the server otherwise.
 */
export async function partnerFinder(user: Pick<User, "id" | "consentAt">, leagueId: number, now = new Date()): Promise<PartnerFinder | null> {
  if (!user.consentAt) return null;
  const [member, paired, stored] = await db.batch([
    db.select({ id: users.id }).from(users).where(and(eq(users.id, user.id), memberOf(leagueId, users.id))),
    db.select({ id: pairs.id }).from(pairs).where(activePairWith(leagueId, [user.id])).limit(1),
    db
      .select({ seeking: partnerSearches.seeking, listed: partnerSearches.listed })
      .from(partnerSearches)
      .where(and(eq(partnerSearches.leagueId, leagueId), eq(partnerSearches.userId, user.id))),
  ]);
  if (member.length === 0) return null;
  if (paired.length > 0) return { kind: "paired" };
  const search = searchState(stored[0]);
  const listedSeekers = and(
    eq(partnerSearches.userId, users.id),
    eq(partnerSearches.leagueId, leagueId),
    eq(partnerSearches.seeking, true),
    eq(partnerSearches.listed, true),
  );
  const who = and(isNotNull(users.consentAt), isNull(users.deletedAt), memberOf(leagueId, users.id), unpaired(leagueId, users.id));
  const base = { id: users.id, name: users.name, level: users.level, elo: users.elo, since: partnerSearches.updatedAt };
  // Contact data is selected only for a listed viewer.
  const rows = search.listed
    ? (await db.select({ ...base, phone: users.phone, email: users.email }).from(users).innerJoin(partnerSearches, listedSeekers).where(who)).map(
        (r) => ({ ...r, phone: r.phone ? formatPhone(r.phone) : null }),
      )
    : await db.select(base).from(users).innerJoin(partnerSearches, listedSeekers).where(who);
  return {
    kind: "single",
    leagueId,
    search,
    seekers: finderEntries(rows, { id: user.id, listed: search.listed }, now),
    link: pairLinkPath(await pairLinkFor(user.id, leagueId)),
  };
}
