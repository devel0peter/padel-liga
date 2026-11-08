import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { pairs, partnerSearches, users } from "~/db/schema";
import { auditEntry } from "~/lib/audit.server";

import type { User } from "./auth/session.server";
import { isSeeking } from "./partner-search";
import { memberOf } from "./league-members.server";
import { createPair, type PairLeague } from "./pairs.server";
import { LEVELS } from "./interest";
import { formatPhone } from "./phone";

// "Párt keresek" in D1 (D59). Párod sets it per league; Párkeresők lists the
// league's registered players (D128) who look for a partner and have none in
// it. Off until the player switches it on (#333). Names, levels and, for the
// league's Szervező and the Admin, phone numbers (D126); never an email
// address.

const LEVEL_ORDER: string[] = Object.keys(LEVELS);
const levelRank = (level: string) => (LEVEL_ORDER.includes(level) ? LEVEL_ORDER.indexOf(level) : LEVEL_ORDER.length);

// Párod: per league where the player has no pair, whether the switch is on.
export async function partnerSearchState(user: Pick<User, "id">, list: PairLeague[]): Promise<Map<number, boolean>> {
  if (list.length === 0) return new Map();
  const stored = await db
    .select({ leagueId: partnerSearches.leagueId, seeking: partnerSearches.seeking })
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
  return new Map(list.map((l) => [l.id, isSeeking(stored.find((s) => s.leagueId === l.id)?.seeking)]));
}

// The switch. Only for a registered player, in a league they can have a pair in.
export async function setPartnerSearch(user: User, leagueId: number, seeking: boolean, list: PairLeague[]): Promise<boolean> {
  if (!user.consentAt || !list.some((l) => l.id === leagueId)) return false;
  await db.batch([
    db
      .insert(partnerSearches)
      .values({ leagueId, userId: user.id, seeking, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [partnerSearches.leagueId, partnerSearches.userId], set: { seeking, updatedAt: new Date() } }),
    auditEntry({ actorId: user.id, action: seeking ? "partner_search.on" : "partner_search.off", target: `league:${leagueId}`, leagueId }),
  ]);
  return true;
}

export type Seeker = {
  id: string;
  name: string;
  level: string;
  // Formatted, "" when none (D126: Párkeresők, organizers only).
  phone: string;
  // When they switched it on.
  since: Date;
};

// Párkeresők: registered players of the league (D128) without an active pair
// in it who switched "Párt keresek" on, by level, then longest waiting first.
export async function leagueSeekers(league: { id: number }): Promise<Seeker[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, level: users.level, phone: users.phone, since: partnerSearches.updatedAt })
    .from(users)
    .innerJoin(partnerSearches, and(eq(partnerSearches.userId, users.id), eq(partnerSearches.leagueId, league.id), eq(partnerSearches.seeking, true)))
    .where(
      and(
        isNotNull(users.consentAt),
        memberOf(league.id, users.id),
        sql`not exists (select 1 from ${pairs} where ${pairs.leagueId} = ${league.id} and ${pairs.status} = 'active'
          and (${pairs.playerA} = ${users.id} or ${pairs.playerB} = ${users.id}))`,
      ),
    );
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

// phone: formatted, "" when none (D126).
export type SearchPairPlayer = { id: string; name: string; email: string; level: string; phone: string };

// Összehozott párok (#297): the league's active pairs made from Regisztráltak
// (source "search", D113), newest first. A pair dissolved on Párok drops out;
// pairs made there before D113 are "manual" and not listed. The email is only
// for the caller's status lookup: never shown.
export async function searchPairs(leagueId: number): Promise<{ id: number; players: [SearchPairPlayer, SearchPairPlayer] }[]> {
  const playerA = alias(users, "search_player_a");
  const playerB = alias(users, "search_player_b");
  const rows = await db
    .select({
      id: pairs.id,
      aId: playerA.id,
      aName: playerA.name,
      aEmail: playerA.email,
      aLevel: playerA.level,
      aPhone: playerA.phone,
      bId: playerB.id,
      bName: playerB.name,
      bEmail: playerB.email,
      bLevel: playerB.level,
      bPhone: playerB.phone,
    })
    .from(pairs)
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(and(eq(pairs.leagueId, leagueId), eq(pairs.status, "active"), eq(pairs.source, "search")))
    .orderBy(desc(pairs.id));
  return rows.map((r) => ({
    id: r.id,
    players: [
      { id: r.aId, name: r.aName, email: r.aEmail, level: r.aLevel ?? "", phone: formatPhone(r.aPhone) },
      { id: r.bId, name: r.bName, email: r.bEmail, level: r.bLevel ?? "", phone: formatPhone(r.bPhone) },
    ],
  }));
}
