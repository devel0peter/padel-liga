import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { leagues, pairs, partnerSearches, users } from "~/db/schema";
import { auditEntry } from "~/lib/audit.server";

import type { User } from "./auth/session.server";
import { defaultSeekers, isSeeking } from "./partner-search";
import { createPair, type PairLeague } from "./pairs.server";
import { LEVELS } from "./interest";
import { formatPhone } from "./phone";
import { listSignups } from "./signups-admin.server";

// "Párt keresek" in D1 (D59). Párom sets it per league; Párkeresők lists the
// registered players who look for a partner and have none in the league.
// Names, levels and, for the league's Szervező and the Admin, phone numbers
// (D126); never an email address.

const LEVEL_ORDER: string[] = Object.keys(LEVELS);
const levelRank = (level: string) => (LEVEL_ORDER.includes(level) ? LEVEL_ORDER.indexOf(level) : LEVEL_ORDER.length);

// Lowercased emails of the finished accounts.
async function registeredEmails(): Promise<Set<string>> {
  const rows = await db.select({ email: users.email }).from(users).where(isNotNull(users.consentAt));
  return new Set(rows.map((r) => r.email.toLowerCase()));
}

// Párom: per league where the player has no pair, whether the switch is on.
export async function partnerSearchState(user: Pick<User, "id" | "email">, list: PairLeague[]): Promise<Map<number, boolean>> {
  if (list.length === 0) return new Map();
  const ids = list.map((l) => l.id);
  const [stored, cities, signups, registered] = await Promise.all([
    db
      .select({ leagueId: partnerSearches.leagueId, seeking: partnerSearches.seeking })
      .from(partnerSearches)
      .where(and(eq(partnerSearches.userId, user.id), inArray(partnerSearches.leagueId, ids))),
    db.select({ id: leagues.id, city: leagues.city }).from(leagues).where(inArray(leagues.id, ids)),
    listSignups(),
    registeredEmails(),
  ]);
  const email = user.email.toLowerCase();
  return new Map(
    cities.map((l) => [
      l.id,
      isSeeking(stored.find((s) => s.leagueId === l.id)?.seeking, defaultSeekers(signups, l.city, registered).has(email)),
    ]),
  );
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
  // Signed up alone on the interest list (the default is on for them).
  fromSignup: boolean;
  // The solo signup's note and home club, when there is one.
  note: string | null;
  homeClub: string | null;
  since: Date;
};

// Párkeresők: registered players without an active pair in the league who
// look for one, by level, then longest waiting first.
export async function leagueSeekers(league: { id: number; city: string }): Promise<Seeker[]> {
  const [accounts, stored, signups, registered] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email, level: users.level, phone: users.phone, createdAt: users.createdAt })
      .from(users)
      .where(
        and(
          isNotNull(users.consentAt),
          sql`not exists (select 1 from ${pairs} where ${pairs.leagueId} = ${league.id} and ${pairs.status} = 'active'
            and (${pairs.playerA} = ${users.id} or ${pairs.playerB} = ${users.id}))`,
        ),
      ),
    db.select().from(partnerSearches).where(eq(partnerSearches.leagueId, league.id)),
    listSignups(),
    registeredEmails(),
  ]);
  const solos = defaultSeekers(signups, league.city, registered);
  const byUser = new Map(stored.map((s) => [s.userId, s]));
  return accounts
    .flatMap((u) => {
      const solo = solos.get(u.email.toLowerCase());
      const row = byUser.get(u.id);
      if (!isSeeking(row?.seeking, !!solo)) return [];
      return [
        {
          id: u.id,
          name: u.name,
          level: u.level ?? "",
          phone: formatPhone(u.phone),
          fromSignup: !!solo,
          note: solo?.note ?? null,
          homeClub: solo?.homeClub ?? null,
          since: row?.updatedAt ?? solo?.createdAt ?? u.createdAt,
        },
      ];
    })
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
// for the caller's lookups (home club, status): never shown.
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
