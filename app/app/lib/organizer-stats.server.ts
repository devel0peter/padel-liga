import { addDays, budapestDay, type Day } from "@padel-liga/rules";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { clubs, groupPairs, groups, leagueMembers, matches, pairs, partnerSearches, seasonEntries, seasonPhases, seasons, users } from "~/db/schema";
import { memberOf } from "./league-members.server";

// Organizer statistics (#378) and per-club played match counts (#401).
// Numbers only: never includes player names, emails, or phone numbers.

export type ClubMatchRow = {
  clubId: number | null;
  clubName: string;
  byRound: Record<number, number>;
  total: number;
};

export type ClubMatchTable = {
  rounds: number[];
  rows: ClubMatchRow[];
  totalsByRound: Record<number, number>;
  grandTotal: number;
};

export function buildClubMatchTable(
  played: readonly { phase: number; clubId: number | null; clubName: string | null }[],
  rounds: number[],
): ClubMatchTable {
  const map = new Map<string, ClubMatchRow>();
  const totalsByRound: Record<number, number> = {};
  for (const r of rounds) totalsByRound[r] = 0;

  for (const m of played) {
    const key = m.clubId === null ? "none" : String(m.clubId);
    const existing =
      map.get(key) ??
      map
        .set(key, {
          clubId: m.clubId,
          clubName: m.clubName ?? "Nincs megadva",
          byRound: Object.fromEntries(rounds.map((r) => [r, 0])),
          total: 0,
        })
        .get(key)!;
    existing.byRound[m.phase] = (existing.byRound[m.phase] ?? 0) + 1;
    existing.total++;
    totalsByRound[m.phase] = (totalsByRound[m.phase] ?? 0) + 1;
  }

  const rows = [...map.values()].sort((a, b) => {
    if (a.clubId === null && b.clubId !== null) return 1;
    if (a.clubId !== null && b.clubId === null) return -1;
    return b.total - a.total || a.clubName.localeCompare(b.clubName, "hu");
  });

  return {
    rounds,
    rows,
    totalsByRound,
    grandTotal: played.length,
  };
}

// Played matches for a season (or single phase): recorded result that counts,
// excluding walkovers, unplayed matches, and matches of withdrawn pairs (#401).
export async function clubMatchCounts(seasonId: number, phase?: number): Promise<ClubMatchTable> {
  const [phaseRows, groupRows] = await Promise.all([
    db
      .select({ number: seasonPhases.number })
      .from(seasonPhases)
      .where(phase !== undefined ? and(eq(seasonPhases.seasonId, seasonId), eq(seasonPhases.number, phase)) : eq(seasonPhases.seasonId, seasonId))
      .orderBy(asc(seasonPhases.number)),
    db
      .select({ id: groups.id, phase: groups.phase })
      .from(groups)
      .where(phase !== undefined ? and(eq(groups.seasonId, seasonId), eq(groups.phase, phase)) : eq(groups.seasonId, seasonId)),
  ]);
  const rounds = phaseRows.map((p) => p.number);
  if (groupRows.length === 0) return buildClubMatchTable([], rounds);

  const gIds = groupRows.map((g) => g.id);
  const phaseByGroup = new Map(groupRows.map((g) => [g.id, g.phase]));

  const [withdrawnRows, matchRows] = await Promise.all([
    db
      .select({ groupId: groupPairs.groupId, pairId: groupPairs.pairId })
      .from(groupPairs)
      .where(and(inArray(groupPairs.groupId, gIds), isNotNull(groupPairs.withdrawnAt))),
    db
      .select({
        groupId: matches.groupId,
        pairA: matches.pairA,
        pairB: matches.pairB,
        status: matches.status,
        outcome: matches.outcome,
        clubId: matches.clubId,
        clubName: clubs.name,
      })
      .from(matches)
      .leftJoin(clubs, eq(clubs.id, matches.clubId))
      .where(inArray(matches.groupId, gIds)),
  ]);

  const withdrawn = new Set(withdrawnRows.map((w) => `${w.groupId}:${w.pairId}`));
  const played: { phase: number; clubId: number | null; clubName: string | null }[] = [];
  for (const m of matchRows) {
    if (withdrawn.has(`${m.groupId}:${m.pairA}`) || withdrawn.has(`${m.groupId}:${m.pairB}`)) continue;
    const isPlayed =
      (m.status === "final" && m.outcome?.kind === "played") ||
      m.status === "result_pending" ||
      m.status === "disputed";
    if (!isPlayed) continue;
    played.push({ phase: phaseByGroup.get(m.groupId)!, clubId: m.clubId, clubName: m.clubName });
  }
  return buildClubMatchTable(played, rounds);
}

export type SeasonStats = {
  rounds: { phase: number; played: number; total: number; published: boolean }[];
  signups: {
    noPair: number;
    seeking: number;
    entered: number;
    notEntered: number;
  };
  weeklySignups: { weekStart: Day; count: number }[];
  clubs: ClubMatchTable;
};

export async function seasonStats(leagueId: number, seasonId: number): Promise<SeasonStats> {
  const [phaseRows, groupRows, leagueUsers, activePairs, entries, seekers, clubTable] = await Promise.all([
    db.select({ number: seasonPhases.number }).from(seasonPhases).where(eq(seasonPhases.seasonId, seasonId)).orderBy(asc(seasonPhases.number)),
    db.select({ id: groups.id, phase: groups.phase, publishedAt: groups.publishedAt }).from(groups).where(eq(groups.seasonId, seasonId)),
    db
      .select({ id: users.id, createdAt: users.createdAt })
      .from(users)
      .where(and(isNotNull(users.consentAt), isNull(users.deletedAt), memberOf(leagueId, users.id))),
    db.select({ id: pairs.id, playerA: pairs.playerA, playerB: pairs.playerB }).from(pairs).where(and(eq(pairs.leagueId, leagueId), eq(pairs.status, "active"))),
    db.select({ pairId: seasonEntries.pairId, status: seasonEntries.status }).from(seasonEntries).where(eq(seasonEntries.seasonId, seasonId)),
    db
      .select({ userId: partnerSearches.userId })
      .from(partnerSearches)
      .where(and(eq(partnerSearches.leagueId, leagueId), eq(partnerSearches.seeking, true))),
    clubMatchCounts(seasonId),
  ]);

  const gIds = groupRows.map((g) => g.id);
  const [withdrawnRows, matchRows] = gIds.length
    ? await Promise.all([
        db
          .select({ groupId: groupPairs.groupId, pairId: groupPairs.pairId })
          .from(groupPairs)
          .where(and(inArray(groupPairs.groupId, gIds), isNotNull(groupPairs.withdrawnAt))),
        db
          .select({ groupId: matches.groupId, pairA: matches.pairA, pairB: matches.pairB, status: matches.status })
          .from(matches)
          .where(inArray(matches.groupId, gIds)),
      ])
    : [[], []];

  const withdrawn = new Set(withdrawnRows.map((w) => `${w.groupId}:${w.pairId}`));
  const rounds = phaseRows.map((p) => {
    const pGroups = groupRows.filter((g) => g.phase === p.number);
    const pGroupIds = new Set(pGroups.map((g) => g.id));
    const counting = matchRows.filter((m) => pGroupIds.has(m.groupId) && !withdrawn.has(`${m.groupId}:${m.pairA}`) && !withdrawn.has(`${m.groupId}:${m.pairB}`));
    return {
      phase: p.number,
      played: counting.filter((m) => m.status === "final").length,
      total: counting.length,
      published: pGroups.some((g) => g.publishedAt !== null),
    };
  });

  // Sign-up counts matching Játékosok filters (#378)
  const pairedUsers = new Set<string>();
  const approvedPairs = new Set(entries.filter((e) => e.status === "approved").map((e) => e.pairId));
  const enteredUsers = new Set<string>();
  const notEnteredUsers = new Set<string>();
  for (const p of activePairs) {
    pairedUsers.add(p.playerA);
    pairedUsers.add(p.playerB);
    if (approvedPairs.has(p.id)) {
      enteredUsers.add(p.playerA);
      enteredUsers.add(p.playerB);
    } else {
      notEnteredUsers.add(p.playerA);
      notEnteredUsers.add(p.playerB);
    }
  }
  const seekerSet = new Set(seekers.map((s) => s.userId));
  let noPair = 0;
  let seeking = 0;
  let entered = 0;
  let notEntered = 0;
  for (const u of leagueUsers) {
    if (!pairedUsers.has(u.id)) {
      noPair++;
      if (seekerSet.has(u.id)) seeking++;
    } else if (enteredUsers.has(u.id)) {
      entered++;
    } else if (notEnteredUsers.has(u.id)) {
      notEntered++;
    }
  }

  // Weekly sign-ups (Monday-based Budapest weeks)
  const weekCounts = new Map<Day, number>();
  for (const u of leagueUsers) {
    const day = budapestDay(u.createdAt);
    const d = new Date(`${day}T12:00:00Z`);
    const offset = (d.getUTCDay() + 6) % 7; // Monday = 0
    const monday = addDays(day, -offset);
    weekCounts.set(monday, (weekCounts.get(monday) ?? 0) + 1);
  }
  const weeklySignups = [...weekCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, count]) => ({ weekStart, count }));

  return {
    rounds,
    signups: { noPair, seeking, entered, notEntered },
    weeklySignups,
    clubs: clubTable,
  };
}
