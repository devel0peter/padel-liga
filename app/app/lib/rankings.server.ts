import { DIVISION_NAMES, currentElo, divisionOf, pairElo } from "@padel-liga/rules";
import { and, count, desc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { cities, eloChanges, groupPairs, groups, pairs, seasonPhases, seasons, users } from "~/db/schema";

import { getLeague } from "./leagues.server";
import { teamLabeler } from "./names";
import { rankRows, type RankInput, type RankRow } from "./rankings";

// The Ranglista (D137): a league's players and pairs by Élő-pont, for
// logged-in players only (the route checks the login). Like the profiles
// (D112): only pairs that have been in one of the league's published groups,
// and their players whose account is not deleted; ratings only once the
// league has started (spec 17). Names and ratings only: no email or phone.

export type RankingsPage = {
  league: { name: string; slug: string };
  /** Ratings show: the league's first phase has begun. */
  started: boolean;
  players: RankRow[];
  pairs: RankRow[];
};

const playerA = alias(users, "rank_player_a");
const playerB = alias(users, "rank_player_b");

export async function rankingsPage(slug: string, viewerId: string, now = new Date()): Promise<RankingsPage | null> {
  const league = await getLeague(slug);
  if (!league) return null;
  const [city] = await db.select({ listed: cities.listed }).from(cities).where(eq(cities.slug, league.city));
  if (!city?.listed) return null;
  const head = { league: { name: league.name, slug: league.slug } };

  const leagueSeasons = db.select({ id: seasons.id }).from(seasons).where(eq(seasons.leagueId, league.id));
  const [begun] = await db
    .select({ n: count() })
    .from(seasonPhases)
    .where(and(inArray(seasonPhases.seasonId, leagueSeasons), lte(seasonPhases.startsAt, now)));
  if (!begun?.n) return { ...head, started: false, players: [], pairs: [] };

  // The league's pairs that have been in a published group.
  const placed = db
    .selectDistinct({ id: groupPairs.pairId })
    .from(groupPairs)
    .innerJoin(groups, and(eq(groups.id, groupPairs.groupId), isNotNull(groups.publishedAt)))
    .where(inArray(groups.seasonId, leagueSeasons));
  const rows = await db
    .select({
      pairId: pairs.id,
      status: pairs.status,
      aId: playerA.id,
      aName: playerA.name,
      aSurname: playerA.surname,
      aFirstName: playerA.firstName,
      aElo: playerA.elo,
      aLevel: playerA.level,
      aDeleted: playerA.deletedAt,
      bId: playerB.id,
      bName: playerB.name,
      bSurname: playerB.surname,
      bFirstName: playerB.firstName,
      bElo: playerB.elo,
      bLevel: playerB.level,
      bDeleted: playerB.deletedAt,
    })
    .from(pairs)
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(and(eq(pairs.leagueId, league.id), inArray(pairs.id, placed)));

  // Each player once, from any of their pairs; a deleted account is left out.
  const people = new Map<string, { name: string; rating: number }>();
  for (const r of rows)
    for (const [id, name, elo, level, deleted] of [
      [r.aId, r.aName, r.aElo, r.aLevel, r.aDeleted],
      [r.bId, r.bName, r.bElo, r.bLevel, r.bDeleted],
    ] as const) {
      const rating = currentElo(elo, level);
      if (!deleted && rating !== null && !people.has(id)) people.set(id, { name: name || "Névtelen", rating });
    }
  const rated = people.size
    ? await db
        .select({ userId: eloChanges.userId, n: count() })
        .from(eloChanges)
        .where(inArray(eloChanges.userId, [...people.keys()]))
        .groupBy(eloChanges.userId)
    : [];
  const matchCount = new Map(rated.map((r) => [r.userId, r.n]));
  // The viewer's last change, for "Élő-pontod" (#422).
  const [last] = await db
    .select({ delta: eloChanges.delta })
    .from(eloChanges)
    .where(eq(eloChanges.userId, viewerId))
    .orderBy(desc(eloChanges.at))
    .limit(1);

  // Pairs that still play together, both accounts still there, by team
  // label (#419); the list is one screen for the clash rule.
  const listed = rows.filter(
    (r) => r.status === "active" && !r.aDeleted && !r.bDeleted && currentElo(r.aElo, r.aLevel) !== null && currentElo(r.bElo, r.bLevel) !== null,
  );
  const playersOf = (r: (typeof rows)[number]) => [
    { id: r.aId, name: r.aName || "Névtelen", surname: r.aSurname, firstName: r.aFirstName },
    { id: r.bId, name: r.bName || "Névtelen", surname: r.bSurname, firstName: r.bFirstName },
  ];
  const label = teamLabeler(listed.flatMap(playersOf));
  const division = await divisionsOf(rows.map((r) => r.pairId), league.id);
  // Each player's active pair: its label and division (the Ranglista's desktop columns, #422).
  const pairOf = new Map<string, { label: string; division: string | null }>();
  for (const r of listed) {
    const shown = { label: label(playersOf(r)), division: division.get(r.pairId) ?? null };
    pairOf.set(r.aId, shown);
    pairOf.set(r.bId, shown);
  }
  const players: RankInput[] = [...people].map(([id, p]) => ({
    key: id,
    name: p.name,
    rating: p.rating,
    href: `/players/${id}`,
    mine: id === viewerId,
    matches: matchCount.get(id) ?? 0,
    pair: pairOf.get(id)?.label ?? null,
    division: pairOf.get(id)?.division ?? null,
    // Rounded, as the Élő-pont shows (spec 11).
    delta: id === viewerId && last ? Math.round(last.delta) : null,
  }));
  const pairRows: RankInput[] = listed.flatMap((r) => {
    const a = currentElo(r.aElo, r.aLevel);
    const b = currentElo(r.bElo, r.bLevel);
    if (a === null || b === null) return [];
    return [
      {
        key: String(r.pairId),
        name: label(playersOf(r)),
        rating: pairElo(a, b),
        href: `/pairs/${r.pairId}`,
        mine: r.aId === viewerId || r.bId === viewerId,
        matches: null,
        division: division.get(r.pairId) ?? null,
      },
    ];
  });

  return { ...head, started: true, players: rankRows(players), pairs: rankRows(pairRows) };
}

/**
 * The division of each pair's newest published group in the league's
 * seasons (#422), "Bronz": the group's place among its round's published
 * groups, as the shell's chip has it (shell.server.ts). A pair withdrawn from
 * its group has none there.
 */
async function divisionsOf(pairIds: readonly number[], leagueId: number): Promise<Map<number, string>> {
  if (pairIds.length === 0) return new Map();
  const leagueSeasons = db.select({ id: seasons.id }).from(seasons).where(eq(seasons.leagueId, leagueId));
  const published = await db
    .select({ id: groups.id, seasonId: groups.seasonId, phase: groups.phase, number: groups.number })
    .from(groups)
    .where(and(inArray(groups.seasonId, leagueSeasons), isNotNull(groups.publishedAt)));
  const placed = await db
    .select({ pairId: groupPairs.pairId, groupId: groupPairs.groupId })
    .from(groupPairs)
    .where(and(inArray(groupPairs.pairId, [...pairIds]), isNull(groupPairs.withdrawnAt)));
  const byId = new Map(published.map((g) => [g.id, g]));
  const out = new Map<number, string>();
  const newest = new Map<number, (typeof published)[number]>();
  for (const p of placed) {
    const g = byId.get(p.groupId);
    if (!g) continue;
    const seen = newest.get(p.pairId);
    if (!seen || g.seasonId > seen.seasonId || (g.seasonId === seen.seasonId && g.phase > seen.phase)) newest.set(p.pairId, g);
  }
  for (const [pairId, g] of newest) {
    const round = published.filter((x) => x.seasonId === g.seasonId && x.phase === g.phase);
    const position = round.filter((x) => x.number <= g.number).length;
    out.set(pairId, DIVISION_NAMES[divisionOf(position, round.length)]);
  }
  return out;
}
