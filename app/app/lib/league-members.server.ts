import { type AnyColumn, asc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "~/db/client.server";
import { rowSelect } from "~/db/insert-select";
import { leagueMembers, leagues, pairs } from "~/db/schema";
import { auditIfChanged } from "~/lib/audit.server";
import { listedCities } from "~/lib/cities.server";
import { listSeasons } from "~/lib/seasons.server";

import { joinableLeagues, type JoinableLeague, type JoinSource } from "./league-members";

// A league's players in D1 (D128, #331, replacing D93): the leagues an
// account joined (league_members) or has a pair in, whatever the pair's
// state (an entry always belongs to a pair of the league). Every reader that
// means "the league's players" uses memberOf: Párok's players without a pair
// (its counts, "Levél nekik", "Pár létrehozása", "Partner cseréje"), the
// stuck reminders, the substitute pick, Párkeresők and "Párt keresek",
// Kezdőlap and Párom. Admins and Szervezők follow the same rule.

export type ListedLeague = { id: number; name: string; slug: string; city: string };

// The leagues players can see and join: every league in a listed city (a
// city still being set up stays hidden).
export async function listedLeagues(): Promise<ListedLeague[]> {
  const listed = (await listedCities()).map((c) => c.slug);
  if (listed.length === 0) return [];
  return db
    .select({ id: leagues.id, name: leagues.name, slug: leagues.slug, city: leagues.city })
    .from(leagues)
    .where(inArray(leagues.city, listed))
    .orderBy(asc(leagues.name));
}

// SQL: the account in `user` (a column or a value) is one of the league's
// players: it joined, or it is in a pair of the league.
export function memberOf(leagueId: number | SQL, user: AnyColumn | SQL | string): SQL {
  return sql`(exists (select 1 from ${leagueMembers} where ${leagueMembers.leagueId} = ${leagueId} and ${leagueMembers.userId} = ${user})
    or exists (select 1 from ${pairs} where ${pairs.leagueId} = ${leagueId} and (${pairs.playerA} = ${user} or ${pairs.playerB} = ${user})))`;
}

// The ids of the leagues the account belongs to.
export async function memberLeagueIds(userId: string): Promise<Set<number>> {
  const [joined, paired] = await db.batch([
    db.select({ id: leagueMembers.leagueId }).from(leagueMembers).where(eq(leagueMembers.userId, userId)),
    db
      .selectDistinct({ id: pairs.leagueId })
      .from(pairs)
      .where(sql`${pairs.playerA} = ${userId} or ${pairs.playerB} = ${userId}`),
  ]);
  return new Set([...joined, ...paired].map((r) => r.id));
}

// The listed leagues the account belongs to: what Kezdőlap and Párom show.
export async function playerLeagues(userId: string): Promise<ListedLeague[]> {
  const [listed, mine] = await Promise.all([listedLeagues(), memberLeagueIds(userId)]);
  return listed.filter((l) => mine.has(l.id));
}

// Joins one league, audited (D91) with the account itself as the actor;
// false when it had joined before (no new entry then).
export async function joinLeague(userId: string, leagueId: number, source: JoinSource): Promise<boolean> {
  const [inserted] = await db.batch([
    db.insert(leagueMembers).values({ leagueId, userId, source }).onConflictDoNothing().returning({ id: leagueMembers.leagueId }),
    auditIfChanged({ actorId: userId, action: "league.join", target: `user:${userId}`, detail: `league:${leagueId}; ${source}`, leagueId }),
  ]);
  return inserted.length > 0;
}

// The landing page's register button (`?league=<slug>`): joins that league,
// if it is a listed one. Written as soon as the account logs in through it,
// before the first-login page is done (D128), so the stuck reminder B knows
// the league; every list of players still waits for the first-login page.
export async function joinFromRegisterButton(userId: string, slug: string | null): Promise<void> {
  if (!slug) return;
  const league = (await listedLeagues()).find((l) => l.slug === slug);
  if (league) await joinLeague(userId, league.id, "register");
}

// "Melyik ligában játszol?" (Kezdőlap): the leagues to offer an account that
// belongs to none, or [] when it belongs to one already.
export async function leagueChoices(userId: string, now = new Date()): Promise<JoinableLeague[]> {
  if ((await memberLeagueIds(userId)).size > 0) return [];
  return joinable(now);
}

async function joinable(now: Date): Promise<JoinableLeague[]> {
  const [listed, cities, seasons] = await Promise.all([listedLeagues(), listedCities(), listSeasons()]);
  const cityName = new Map(cities.map((c) => [c.slug, c.name]));
  return joinableLeagues(
    listed.map((l) => ({ id: l.id, city: l.city, cityName: cityName.get(l.city) ?? l.city, name: l.name })),
    seasons,
    now,
  );
}

// "Csatlakozom": only a league the card offers.
export async function chooseLeague(userId: string, leagueId: number, now = new Date()): Promise<boolean> {
  if (!(await joinable(now)).some((l) => l.id === leagueId)) return false;
  await joinLeague(userId, leagueId, "chosen");
  return true;
}

// For the batch that forms the pair of `a` and `b` (in this column order):
// both become members of the league by row, if the pair is there by then
// (`source` per player). Put them after the pair's audit entry, which reads
// changes() of the insert right before it.
export function pairMemberStatements(leagueId: number, a: string, b: string, source: (userId: string) => JoinSource) {
  const paired = sql`exists (select 1 from ${pairs} where ${pairs.leagueId} = ${leagueId} and ${pairs.status} = 'active'
    and ${pairs.playerA} = ${a} and ${pairs.playerB} = ${b})`;
  return [a, b].map((userId) =>
    db
      .insert(leagueMembers)
      .select(
        rowSelect(
          leagueMembers,
          { leagueId: sql`${leagueId}`, userId: sql`${userId}`, source: sql`${source(userId)}`, joinedAt: sql`unixepoch()` },
          sql`where ${paired}`,
        ),
      )
      .onConflictDoNothing(),
  );
}
