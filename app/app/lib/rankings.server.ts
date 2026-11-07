import { currentElo, pairElo } from "@padel-liga/rules";
import { and, count, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { cities, eloChanges, groupPairs, groups, pairs, seasonPhases, seasons, users } from "~/db/schema";

import { getLeague } from "./leagues.server";
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
      aElo: playerA.elo,
      aLevel: playerA.level,
      aDeleted: playerA.deletedAt,
      bId: playerB.id,
      bName: playerB.name,
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
  const players: RankInput[] = [...people].map(([id, p]) => ({
    key: id,
    name: p.name,
    rating: p.rating,
    href: `/players/${id}`,
    mine: id === viewerId,
    matches: matchCount.get(id) ?? 0,
  }));

  // Pairs that still play together, both accounts still there.
  const pairRows: RankInput[] = rows.flatMap((r) => {
    const a = currentElo(r.aElo, r.aLevel);
    const b = currentElo(r.bElo, r.bLevel);
    if (r.status !== "active" || r.aDeleted || r.bDeleted || a === null || b === null) return [];
    return [
      {
        key: String(r.pairId),
        name: `${r.aName || "Névtelen"} – ${r.bName || "Névtelen"}`,
        rating: pairElo(a, b),
        href: `/pairs/${r.pairId}`,
        mine: r.aId === viewerId || r.bId === viewerId,
        matches: null,
      },
    ];
  });

  return { ...head, started: true, players: rankRows(players), pairs: rankRows(pairRows) };
}

