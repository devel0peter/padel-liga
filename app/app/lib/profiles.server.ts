import { currentElo } from "@padel-liga/rules";
import { and, asc, eq, inArray, isNotNull, lte, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { cities, eloChanges, groupPairs, groups, leagues, matches, pairs, seasonPhases, seasons, users } from "~/db/schema";

import { formatShortDate } from "./format";
import {
  eloSeries,
  groupHistory,
  matchViews,
  personView,
  shownElo,
  type EloChangeInput,
  type GroupHistoryRow,
  type GroupInput,
  type ProfileMatchInput,
  type ProfileMatchView,
  type ProfilePair,
  type ProfilePerson,
} from "./profiles";
import { averageElo } from "./season-entries";

// The public pair and player profiles (#36, spec sections 11, 14 and 17).
// A profile exists for a pair that has been in a published group of a league
// in a listed city (like the league page), and for a player of such a pair
// whose account is not deleted or anonymized: before the groups are published
// nobody's name is public. Results and ratings show once the league has
// started; before that, names and groups only. The queries select names,
// levels and ratings: never an email or phone.

const playerA = alias(users, "profile_player_a");
const playerB = alias(users, "profile_player_b");

const personCols = {
  aId: playerA.id,
  aName: playerA.name,
  aDeleted: playerA.deletedAt,
  aLevel: playerA.level,
  aElo: playerA.elo,
  bId: playerB.id,
  bName: playerB.name,
  bDeleted: playerB.deletedAt,
  bLevel: playerB.level,
  bElo: playerB.elo,
};

type MemberRow = {
  pairId: number;
  aId: string;
  aName: string | null;
  aDeleted: Date | null;
  bId: string;
  bName: string | null;
  bDeleted: Date | null;
};

const profilePair = (r: MemberRow): ProfilePair => ({
  id: r.pairId,
  players: [
    personView({ id: r.aId, name: r.aName, deletedAt: r.aDeleted }),
    personView({ id: r.bId, name: r.bName, deletedAt: r.bDeleted }),
  ],
});

/** The published groups, in listed cities, of the pairs `pairFilter` picks. */
async function publicGroups(pairFilter: SQL) {
  const theirGroups = db.select({ id: groupPairs.groupId }).from(groupPairs).where(pairFilter);
  return db
    .select({
      id: groups.id,
      seasonId: groups.seasonId,
      season: seasons.name,
      leagueId: seasons.leagueId,
      phase: groups.phase,
      number: groups.number,
      startsAt: seasonPhases.startsAt,
    })
    .from(groups)
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .innerJoin(cities, and(eq(cities.slug, leagues.city), eq(cities.listed, true)))
    .innerJoin(seasonPhases, and(eq(seasonPhases.seasonId, groups.seasonId), eq(seasonPhases.number, groups.phase)))
    .where(and(inArray(groups.id, theirGroups), isNotNull(groups.publishedAt)))
    .orderBy(asc(seasonPhases.startsAt), asc(groups.number));
}

type PublicGroup = Awaited<ReturnType<typeof publicGroups>>[number];

/** The leagues among `leagueIds` whose first phase has begun (spec 17). */
async function startedLeagues(leagueIds: number[], now: Date): Promise<Set<number>> {
  if (leagueIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ leagueId: seasons.leagueId })
    .from(seasonPhases)
    .innerJoin(seasons, eq(seasons.id, seasonPhases.seasonId))
    .where(and(inArray(seasons.leagueId, leagueIds), lte(seasonPhases.startsAt, now)));
  return new Set(rows.map((r) => r.leagueId));
}

/**
 * Everything the tables and match lists of `list` need: each group's pairs
 * with names and ratings, its matches, and its place among the phase's
 * published groups (the division).
 */
async function groupDetails(list: PublicGroup[]) {
  if (list.length === 0) return { inputs: [] as GroupInput[], pairById: new Map<number, ProfilePair>(), matchRows: [] };
  const ids = list.map((g) => g.id);
  const seasonIds = [...new Set(list.map((g) => g.seasonId))];
  const [members, matchRows, phaseGroups] = await Promise.all([
    db
      .select({ groupId: groupPairs.groupId, withdrawnAt: groupPairs.withdrawnAt, pairId: pairs.id, ...personCols })
      .from(groupPairs)
      .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
      .innerJoin(playerA, eq(playerA.id, pairs.playerA))
      .innerJoin(playerB, eq(playerB.id, pairs.playerB))
      .where(inArray(groupPairs.groupId, ids)),
    db
      .select({
        id: matches.id,
        groupId: matches.groupId,
        a: matches.pairA,
        b: matches.pairB,
        week: matches.week,
        scheduledAt: matches.scheduledAt,
        status: matches.status,
        outcome: matches.outcome,
      })
      .from(matches)
      .where(inArray(matches.groupId, ids))
      .orderBy(asc(matches.id)),
    db
      .select({ seasonId: groups.seasonId, phase: groups.phase, number: groups.number })
      .from(groups)
      .where(and(inArray(groups.seasonId, seasonIds), isNotNull(groups.publishedAt))),
  ]);
  const pairById = new Map(members.map((m) => [m.pairId, profilePair(m)]));
  const inputs: GroupInput[] = list.map((g) => {
    const siblings = phaseGroups.filter((p) => p.seasonId === g.seasonId && p.phase === g.phase).map((p) => p.number);
    return {
      id: g.id,
      season: g.season,
      phase: g.phase,
      number: g.number,
      position: siblings.filter((n) => n <= g.number).length,
      groupCount: siblings.length,
      startsAt: g.startsAt,
      pairs: members
        .filter((m) => m.groupId === g.id)
        .map((m) => ({
          id: m.pairId,
          // The pair's current Elo: the table's last tiebreak, as on the league page.
          elo: averageElo({ elo: m.aElo, level: m.aLevel }, { elo: m.bElo, level: m.bLevel }) ?? 0,
          withdrawn: m.withdrawnAt !== null,
        })),
      matches: matchRows.filter((m) => m.groupId === g.id),
    };
  });
  return { inputs, pairById, matchRows };
}

/** The matches of `ownPairs` in `list`, as the profile's match views take them. */
function matchInputs(
  ownPairs: ReadonlySet<number>,
  list: PublicGroup[],
  details: Awaited<ReturnType<typeof groupDetails>>,
  started: ReadonlySet<number>,
): ProfileMatchInput[] {
  const byId = new Map(list.map((g) => [g.id, g]));
  const withdrawn = new Set(details.inputs.flatMap((g) => g.pairs.filter((p) => p.withdrawn).map((p) => `${g.id}:${p.id}`)));
  return details.matchRows.flatMap((m) => {
    const g = byId.get(m.groupId)!;
    if (!started.has(g.leagueId) || !(ownPairs.has(m.a) || ownPairs.has(m.b))) return [];
    return [
      {
        id: m.id,
        season: g.season,
        phase: g.phase,
        startsAt: g.startsAt,
        week: m.week,
        scheduledAt: m.scheduledAt,
        status: m.status,
        outcome: m.outcome,
        a: details.pairById.get(m.a)!,
        b: details.pairById.get(m.b)!,
        withdrawn: withdrawn.has(`${m.groupId}:${m.a}`) || withdrawn.has(`${m.groupId}:${m.b}`),
      },
    ];
  });
}

export type PairProfile = {
  pair: ProfilePair;
  league: { name: string; slug: string };
  /** Results are public: the league has started (spec 17). */
  started: boolean;
  groups: GroupHistoryRow[];
  matches: ProfileMatchView[];
};

/** A pair's public profile, or null: no such pair, or never in a published group of a listed city's league. */
export async function pairProfile(pairId: number, now = new Date()): Promise<PairProfile | null> {
  if (!Number.isSafeInteger(pairId) || pairId < 1) return null;
  const list = await publicGroups(eq(groupPairs.pairId, pairId));
  if (list.length === 0) return null;
  const leagueId = list[0]!.leagueId;
  const [details, started, [league]] = await Promise.all([
    groupDetails(list),
    startedLeagues([leagueId], now),
    db.select({ name: leagues.name, slug: leagues.slug }).from(leagues).where(eq(leagues.id, leagueId)),
  ]);
  const pair = details.pairById.get(pairId)!;
  const own = new Set([pairId]);
  return {
    pair,
    league: league!,
    started: started.has(leagueId),
    groups: groupHistory(pairId, details.inputs, now),
    matches: matchViews(own, matchInputs(own, list, details, started), formatShortDate),
  };
}

export type PlayerProfile = {
  player: ProfilePerson;
  /** Ratings and results are public: one of the player's leagues has started (spec 17). */
  started: boolean;
  /** The current rating, rounded; null before the league starts. */
  elo: number | null;
  /** The rating before the first rated match and after each one, oldest first. */
  eloHistory: number[];
  /** The player's pairs with a public profile, newest group first, with that group. */
  pairs: { pair: ProfilePair; league: string; latest: GroupHistoryRow }[];
  matches: ProfileMatchView[];
};

/** A player's public profile, or null: no such account, a deleted or anonymized one, or no published group yet. */
export async function playerProfile(userId: string, now = new Date()): Promise<PlayerProfile | null> {
  const [user] = await db
    .select({ id: users.id, name: users.name, level: users.level, elo: users.elo, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || user.deletedAt) return null;
  const theirPairs = db
    .select({ id: pairs.id })
    .from(pairs)
    .where(or(eq(pairs.playerA, userId), eq(pairs.playerB, userId)));
  const list = await publicGroups(inArray(groupPairs.pairId, theirPairs));
  if (list.length === 0) return null;
  const leagueIds = [...new Set(list.map((g) => g.leagueId))];
  const [details, started, leagueNames, changes] = await Promise.all([
    groupDetails(list),
    startedLeagues(leagueIds, now),
    db.select({ id: leagues.id, name: leagues.name }).from(leagues).where(inArray(leagues.id, leagueIds)),
    db
      .select({ matchId: eloChanges.matchId, before: eloChanges.ratingBefore, after: eloChanges.ratingAfter, delta: eloChanges.delta, at: eloChanges.at })
      .from(eloChanges)
      .where(eq(eloChanges.userId, userId)),
  ]);
  const own = new Set(
    [...details.pairById.values()].filter((p) => p.players.some((pl) => pl.id === userId)).map((p) => p.id),
  );
  const isStarted = started.size > 0;
  const rating = currentElo(user.elo, user.level);

  // Each pair once, with its newest group, the newest first.
  const pairsShown = [...own]
    .map((pairId) => {
      const theirs = details.inputs.filter((g) => g.pairs.some((p) => p.id === pairId));
      const latest = theirs.reduce((x, y) => (y.startsAt > x.startsAt ? y : x));
      const leagueId = list.find((g) => g.id === latest.id)!.leagueId;
      return {
        at: latest.startsAt.getTime(),
        pair: details.pairById.get(pairId)!,
        league: leagueNames.find((l) => l.id === leagueId)?.name ?? "",
        latest: groupHistory(pairId, [latest], now)[0]!,
      };
    })
    .sort((x, y) => y.at - x.at)
    .map(({ at: _, ...p }) => p);

  const eloByMatch = new Map<number, EloChangeInput>(changes.map((c) => [c.matchId, c]));
  return {
    player: personView(user),
    started: isStarted,
    elo: isStarted && rating !== null ? shownElo(rating) : null,
    eloHistory: isStarted ? eloSeries(changes).map(shownElo) : [],
    pairs: pairsShown,
    matches: matchViews(own, matchInputs(own, list, details, started), formatShortDate, eloByMatch),
  };
}

/** Which of `pairIds` have a public profile (a published group in a listed city's league). */
export async function publicPairIds(pairIds: number[]): Promise<Set<number>> {
  if (pairIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ pairId: groupPairs.pairId })
    .from(groupPairs)
    .innerJoin(groups, and(eq(groups.id, groupPairs.groupId), isNotNull(groups.publishedAt)))
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .innerJoin(cities, and(eq(cities.slug, leagues.city), eq(cities.listed, true)))
    .where(inArray(groupPairs.pairId, pairIds));
  return new Set(rows.map((r) => r.pairId));
}

/** Whether the player has a public profile: the link on their own pages shows only then. */
export async function hasPublicProfile(userId: string): Promise<boolean> {
  const theirs = await db
    .select({ id: pairs.id })
    .from(pairs)
    .where(or(eq(pairs.playerA, userId), eq(pairs.playerB, userId)));
  return (await publicPairIds(theirs.map((p) => p.id))).size > 0;
}
