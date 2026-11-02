import {
  schedulingState,
  type SchedulingEvent,
  type SchedulingEventKind,
  type SchedulingState,
  type Side,
} from "@padel-liga/rules";
import { and, asc, count, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { clubs, groupPairs, groups, leagues, matchEvents, matches, pairs, seasonPhases, seasons, users } from "~/db/schema";
import { pairName } from "./groups";
import { formatPhone } from "./phone";

// A player's group and matches (#25) in D1. The rules are in
// packages/rules (scheduling.ts); the texts in matches.ts. Phone numbers leave this module only for the current phase's
// opponents (spec 3), email addresses never (they go to the outbox).

type Person = { id: string; name: string; email: string; phone: string | null };
type PairPlayers = { pairId: number; seed: number; players: [Person, Person] };

const playerA = alias(users, "player_a_user");
const playerB = alias(users, "player_b_user");

const pairPlayerColumns = {
  pairId: pairs.id,
  aId: playerA.id,
  aName: playerA.name,
  aEmail: playerA.email,
  aPhone: playerA.phone,
  bId: playerB.id,
  bName: playerB.name,
  bEmail: playerB.email,
  bPhone: playerB.phone,
};

type PairPlayerRow = { pairId: number; aId: string; aName: string; aEmail: string; aPhone: string | null; bId: string; bName: string; bEmail: string; bPhone: string | null };

const toPlayers = (r: PairPlayerRow): [Person, Person] => [
  { id: r.aId, name: r.aName || "Névtelen", email: r.aEmail, phone: r.aPhone },
  { id: r.bId, name: r.bName || "Névtelen", email: r.bEmail, phone: r.bPhone },
];

// The pairs of these groups with their players, by group, in seed order.
async function groupMembers(groupIds: number[]): Promise<Map<number, PairPlayers[]>> {
  const out = new Map<number, PairPlayers[]>();
  if (groupIds.length === 0) return out;
  const rows = await db
    .select({ groupId: groupPairs.groupId, seed: groupPairs.seed, ...pairPlayerColumns })
    .from(groupPairs)
    .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(inArray(groupPairs.groupId, groupIds))
    .orderBy(asc(groupPairs.groupId), asc(groupPairs.seed));
  for (const r of rows) {
    const list = out.get(r.groupId) ?? out.set(r.groupId, []).get(r.groupId)!;
    list.push({ pairId: r.pairId, seed: r.seed, players: toPlayers(r) });
  }
  return out;
}

type StoredEvent = {
  id: number;
  matchId: number;
  pairId: number;
  userId: string | null;
  userName: string | null;
  kind: SchedulingEventKind;
  slots: number[] | null;
  slot: Date | null;
  clubId: number | null;
  at: Date;
};

async function eventsOf(matchIds: number[]): Promise<Map<number, StoredEvent[]>> {
  const out = new Map<number, StoredEvent[]>();
  if (matchIds.length === 0) return out;
  const rows = await db
    .select({
      id: matchEvents.id,
      matchId: matchEvents.matchId,
      pairId: matchEvents.pairId,
      userId: matchEvents.userId,
      userName: users.name,
      kind: matchEvents.kind,
      slots: matchEvents.slots,
      slot: matchEvents.slot,
      clubId: matchEvents.clubId,
      at: matchEvents.at,
    })
    .from(matchEvents)
    .leftJoin(users, eq(users.id, matchEvents.userId))
    .where(inArray(matchEvents.matchId, matchIds))
    .orderBy(asc(matchEvents.id));
  for (const r of rows) (out.get(r.matchId) ?? out.set(r.matchId, []).get(r.matchId)!).push(r);
  return out;
}

const toSchedulingEvent = (e: StoredEvent, pairA: number): SchedulingEvent => ({
  kind: e.kind,
  side: e.pairId === pairA ? "a" : "b",
  at: e.at,
  slots: e.slots?.map((s) => new Date(s * 1000)) ?? null,
  slot: e.slot,
  clubId: e.clubId,
});

async function clubNames(ids: (number | null | undefined)[]): Promise<Map<number, string>> {
  const wanted = [...new Set(ids.filter((id): id is number => typeof id === "number"))];
  if (wanted.length === 0) return new Map();
  const rows = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(inArray(clubs.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// How many published groups the phase has, for the division (spec 4).
async function groupCount(seasonId: number, phase: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(groups)
    .where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase), isNotNull(groups.publishedAt)));
  return row?.n ?? 0;
}

// --- Kezdőlap (#25) -----------------------------------------------------------

export type Opponent = { name: string; phone: string };

export type HomeMatch = {
  id: number;
  week: number;
  // The other pair: names, and phones (only the current phase is listed here).
  opponents: string;
  contacts: Opponent[];
  side: Side;
  state: SchedulingState;
  venue: string | null;
};

export type HomeGroup = {
  groupId: number;
  league: string;
  season: string;
  phase: number;
  number: number;
  groupCount: number;
  phaseStartsAt: Date;
  deadline: Date;
  // Every pair of the group by seed, names only; `mine` marks the player's.
  pairs: { pairId: number; name: string; mine: boolean }[];
  matches: HomeMatch[];
};

/**
 * The player's groups in the current phase (published, deadline not passed),
 * one per league, with every match of their pair. Empty before the groups are
 * out and after the phase ends; past phases never show phone numbers.
 */
export async function currentGroups(userId: string, now = new Date()): Promise<HomeGroup[]> {
  const mine = await db
    .select({
      groupId: groups.id,
      pairId: pairs.id,
      number: groups.number,
      seasonId: groups.seasonId,
      phase: groups.phase,
      season: seasons.name,
      league: leagues.name,
      startsAt: seasonPhases.startsAt,
      deadline: seasonPhases.deadline,
    })
    .from(groupPairs)
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .innerJoin(seasonPhases, and(eq(seasonPhases.seasonId, groups.seasonId), eq(seasonPhases.number, groups.phase)))
    .where(and(isNotNull(groups.publishedAt), gte(seasonPhases.deadline, now), or(eq(pairs.playerA, userId), eq(pairs.playerB, userId))))
    .orderBy(asc(leagues.name));
  if (mine.length === 0) return [];

  const groupIds = mine.map((g) => g.groupId);
  const members = await groupMembers(groupIds);
  const matchRows = await db
    .select()
    .from(matches)
    .where(inArray(matches.groupId, groupIds))
    .orderBy(asc(matches.week), asc(matches.id));
  const events = await eventsOf(matchRows.map((m) => m.id));
  const states = new Map(
    matchRows.map((m) => [m.id, schedulingState((events.get(m.id) ?? []).map((e) => toSchedulingEvent(e, m.pairA)), now)]),
  );
  const venues = await clubNames(
    [...states.values()].map((s) => (s.status === "to_schedule" ? null : s.clubId)),
  );

  return Promise.all(
    mine.map(async (g) => {
      const pairsOf = members.get(g.groupId) ?? [];
      const byId = new Map(pairsOf.map((p) => [p.pairId, p]));
      const own = matchRows.filter((m) => m.groupId === g.groupId && (m.pairA === g.pairId || m.pairB === g.pairId));
      return {
        groupId: g.groupId,
        league: g.league,
        season: g.season,
        phase: g.phase,
        number: g.number,
        groupCount: await groupCount(g.seasonId, g.phase),
        phaseStartsAt: g.startsAt,
        deadline: g.deadline,
        pairs: pairsOf.map((p) => ({ pairId: p.pairId, name: pairName(p.players), mine: p.pairId === g.pairId })),
        matches: own.map((m) => {
          const side: Side = m.pairA === g.pairId ? "a" : "b";
          const them = byId.get(side === "a" ? m.pairB : m.pairA);
          const state = states.get(m.id)!;
          return {
            id: m.id,
            week: m.week,
            opponents: them ? pairName(them.players) : "",
            contacts: (them?.players ?? []).map((p) => ({ name: p.name, phone: formatPhone(p.phone) })),
            side,
            state,
            venue: state.status === "to_schedule" ? null : (venues.get(state.clubId ?? -1) ?? null),
          };
        }),
      };
    }),
  );
}
