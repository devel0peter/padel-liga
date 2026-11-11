import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { pairs, partnerSearches, users } from "~/db/schema";
import { auditEntry } from "~/lib/audit.server";

import type { User } from "./auth/session.server";
import { isSeeking } from "./partner-search";
import { memberOf } from "./league-members.server";
import { createPair, type PairLeague } from "./pairs.server";
import { LEVELS } from "./interest";
import { formatPhone } from "./phone";

// "Párt keresek" in D1 (D59). Párod sets it per league; Játékosok lists the
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
// `actorId`: the Admin switching it on the player's profile (#301); the
// entry then names the player.
export async function setPartnerSearch(
  user: Pick<User, "id" | "consentAt">,
  leagueId: number,
  seeking: boolean,
  list: PairLeague[],
  actorId = user.id,
): Promise<boolean> {
  if (!user.consentAt || !list.some((l) => l.id === leagueId)) return false;
  const own = actorId === user.id;
  await db.batch([
    db
      .insert(partnerSearches)
      .values({ leagueId, userId: user.id, seeking, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [partnerSearches.leagueId, partnerSearches.userId], set: { seeking, updatedAt: new Date() } }),
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
// "Párt keres" (#301; Párkeresők before).
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
