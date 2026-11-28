import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { groupPairs, groups, pairs, partnerSearches, seasonEntries, seasonPhases, seasons, users } from "~/db/schema";
import { memberOf } from "./league-members.server";
import { committedPartner } from "./pairs.server";
import { formatPhone } from "./phone";
import { averageElo } from "./season-entries";

// Várakozók tab on Játékosok (#380, #381): pairs and singles in a league who
// are not in the current running round. Never includes email addresses.

export type WaitingPair = {
  pairId: number;
  players: [
    { id: string; name: string; level: string | null; phone: string },
    { id: string; name: string; level: string | null; phone: string },
  ];
  averageElo: number | null;
  joinsPhase: number | null;
  since: Date;
  isNew: boolean;
};

export type WaitingSingle = {
  id: string;
  name: string;
  level: string | null;
  phone: string;
  seeking: boolean;
  since: Date;
  isNew: boolean;
};

export type WaitingList = {
  runningRound: { seasonId: number; seasonName: string; phase: number } | null;
  latestSeasonId: number | null;
  nextRoundPairs: WaitingPair[];
  notEnteredPairs: WaitingPair[];
  seekingSingles: WaitingSingle[];
  otherSingles: WaitingSingle[];
  counts: {
    total: number;
    pairs: number;
    nextRound: number;
    notEntered: number;
    seeking: number;
    noPair: number;
  };
};

const SEVEN_DAYS_MS = 7 * 86_400_000;

export async function leagueWaitingList(leagueId: number, now = new Date()): Promise<WaitingList> {
  const newCutoff = now.getTime() - SEVEN_DAYS_MS;
  const playerA = alias(users, "wp_a");
  const playerB = alias(users, "wp_b");

  const [seasonRows, activePairRows, singleRows] = await Promise.all([
    db.select({ id: seasons.id, name: seasons.name }).from(seasons).where(eq(seasons.leagueId, leagueId)).orderBy(desc(seasons.id)),
    db
      .select({
        pairId: pairs.id,
        createdAt: pairs.createdAt,
        aId: playerA.id,
        aName: playerA.name,
        aLevel: playerA.level,
        aElo: playerA.elo,
        aPhone: playerA.phone,
        bId: playerB.id,
        bName: playerB.name,
        bLevel: playerB.level,
        bElo: playerB.elo,
        bPhone: playerB.phone,
      })
      .from(pairs)
      .innerJoin(playerA, eq(playerA.id, pairs.playerA))
      .innerJoin(playerB, eq(playerB.id, pairs.playerB))
      .where(and(eq(pairs.leagueId, leagueId), eq(pairs.status, "active")))
      .orderBy(desc(pairs.createdAt)),
    db
      .select({
        id: users.id,
        name: users.name,
        level: users.level,
        phone: users.phone,
        createdAt: users.createdAt,
        seeking: partnerSearches.seeking,
        seekingSince: partnerSearches.updatedAt,
      })
      .from(users)
      .leftJoin(partnerSearches, and(eq(partnerSearches.userId, users.id), eq(partnerSearches.leagueId, leagueId)))
      .where(
        and(
          isNotNull(users.consentAt),
          isNull(users.deletedAt),
          memberOf(leagueId, users.id),
          sql`not exists (select 1 from ${pairs} where ${pairs.leagueId} = ${leagueId} and ${pairs.status} = 'active' and (${pairs.playerA} = ${users.id} or ${pairs.playerB} = ${users.id}))`,
          sql`not ${committedPartner(leagueId, sql`${users.id}`)}`,
        ),
      )
      .orderBy(desc(users.createdAt)),
  ]);

  const latestSeason = seasonRows[0] ?? null;
  let runningRound: WaitingList["runningRound"] = null;
  const inCurrentRound = new Set<number>();

  if (latestSeason) {
    const runningPhases = await db
      .select({ number: seasonPhases.number })
      .from(seasonPhases)
      .where(and(eq(seasonPhases.seasonId, latestSeason.id), lte(seasonPhases.startsAt, now), gte(seasonPhases.deadline, now)))
      .limit(1);
    const phase = runningPhases[0]?.number;
    if (phase !== undefined) {
      const gp = await db
        .selectDistinct({ pairId: groupPairs.pairId })
        .from(groupPairs)
        .innerJoin(groups, eq(groups.id, groupPairs.groupId))
        .where(and(eq(groups.seasonId, latestSeason.id), eq(groups.phase, phase), isNotNull(groups.publishedAt)));
      if (gp.length > 0) {
        runningRound = { seasonId: latestSeason.id, seasonName: latestSeason.name, phase };
        for (const r of gp) inCurrentRound.add(r.pairId);
      }
    }
  }

  const entries = latestSeason
    ? await db
        .select({
          pairId: seasonEntries.pairId,
          status: seasonEntries.status,
          joinsPhase: seasonEntries.joinsPhase,
          createdAt: seasonEntries.createdAt,
          decidedAt: seasonEntries.decidedAt,
        })
        .from(seasonEntries)
        .where(eq(seasonEntries.seasonId, latestSeason.id))
    : [];
  const entryByPair = new Map(entries.map((e) => [e.pairId, e]));

  const nextRoundPairs: WaitingPair[] = [];
  const notEnteredPairs: WaitingPair[] = [];

  for (const p of activePairRows) {
    if (inCurrentRound.has(p.pairId)) continue;
    const entry = entryByPair.get(p.pairId);
    if (entry?.status === "rejected") continue;
    const base = {
      pairId: p.pairId,
      players: [
        { id: p.aId, name: p.aName, level: p.aLevel, phone: formatPhone(p.aPhone) },
        { id: p.bId, name: p.bName, level: p.bLevel, phone: formatPhone(p.bPhone) },
      ] as WaitingPair["players"],
      averageElo: averageElo({ level: p.aLevel, elo: p.aElo }, { level: p.bLevel, elo: p.bElo }),
    };

    if (entry?.status === "approved") {
      // Only show in "A következő körben kezdenek" while a round runs (#380 req 7)
      if (runningRound && (entry.joinsPhase === null || entry.joinsPhase > runningRound.phase)) {
        const since = entry.decidedAt ?? entry.createdAt;
        nextRoundPairs.push({
          ...base,
          joinsPhase: entry.joinsPhase,
          since,
          isNew: since.getTime() >= newCutoff,
        });
      }
    } else {
      // No entry or withdrawn entry -> "Nem neveztek"
      notEnteredPairs.push({
        ...base,
        joinsPhase: null,
        since: p.createdAt,
        isNew: p.createdAt.getTime() >= newCutoff,
      });
    }
  }

  nextRoundPairs.sort((a, b) => b.since.getTime() - a.since.getTime());
  notEnteredPairs.sort((a, b) => b.since.getTime() - a.since.getTime());

  const seekingSingles: WaitingSingle[] = [];
  const otherSingles: WaitingSingle[] = [];
  for (const s of singleRows) {
    const seeking = !!s.seeking;
    const since = seeking && s.seekingSince ? s.seekingSince : s.createdAt;
    const item: WaitingSingle = {
      id: s.id,
      name: s.name || "Névtelen",
      level: s.level,
      phone: formatPhone(s.phone),
      seeking,
      since,
      isNew: s.createdAt.getTime() >= newCutoff,
    };
    if (seeking) seekingSingles.push(item);
    else otherSingles.push(item);
  }
  seekingSingles.sort((a, b) => b.since.getTime() - a.since.getTime());
  otherSingles.sort((a, b) => b.since.getTime() - a.since.getTime());

  const pairsCount = nextRoundPairs.length + notEnteredPairs.length;
  const total = pairsCount + seekingSingles.length + otherSingles.length;

  return {
    runningRound,
    latestSeasonId: latestSeason?.id ?? null,
    nextRoundPairs,
    notEnteredPairs,
    seekingSingles,
    otherSingles,
    counts: {
      total,
      pairs: pairsCount,
      nextRound: nextRoundPairs.length,
      notEntered: notEnteredPairs.length,
      seeking: seekingSingles.length,
      noPair: otherSingles.length,
    },
  };
}
