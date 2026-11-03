import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { groupPairs, groups, leagues, pairs, seasonEntries, seasonPhases, users } from "~/db/schema";
import { listedCities } from "~/lib/cities.server";
import { notInRunningGroup, pairInRunningGroup } from "~/lib/groups.server";
import { audit } from "~/lib/leagues.server";
import { averageStartingElo, homeEntry, organizerEntryAction, type EntryStatus, type OrganizerEntryAction } from "~/lib/season-entries";
import { withdrawEntries } from "~/lib/season-entries.server";
import { homeSeasons } from "~/lib/seasons";
import { listSeasons } from "~/lib/seasons.server";

import type { User } from "./auth/session.server";
import { canDissolve, checkNewPair, DISSOLVE_REFUSED, NEW_PAIR_REFUSALS, type PairSource } from "./pairs";

// Pairs in D1. The rules are in pairs.ts. Players only see their pair
// (/pair); a Szervező changes pairs on the Párok page (#97). No email goes
// out for a pair change: the organizer tells the players.

export type PairLeague = { id: number; name: string };

type Result = { ok: true } | { ok: false; error: string };

// Where a player can be in a pair: every league in a listed city (players
// don't belong to a league yet; a city still being set up stays hidden).
export async function pairLeagues(): Promise<PairLeague[]> {
  const listed = (await listedCities()).map((c) => c.slug);
  if (listed.length === 0) return [];
  return db
    .select({ id: leagues.id, name: leagues.name })
    .from(leagues)
    .where(inArray(leagues.city, listed))
    .orderBy(asc(leagues.name));
}

// Either player in an active pair of the league.
export function activePairWith(leagueId: number, userIds: string[]) {
  return sql`exists (select 1 from ${pairs} where ${pairs.leagueId} = ${leagueId} and ${pairs.status} = 'active'
    and (${inArray(pairs.playerA, userIds)} or ${inArray(pairs.playerB, userIds)}))`;
}

export type PairOverview = {
  league: PairLeague;
  pair: { id: number; partnerName: string } | null;
};

// What /pair shows, per league: the active pair, if any.
export async function pairOverview(user: User, list: PairLeague[]): Promise<PairOverview[]> {
  if (list.length === 0) return [];
  const partner = alias(users, "partner");
  const active = await db
    .select({ id: pairs.id, leagueId: pairs.leagueId, partnerName: partner.name })
    .from(pairs)
    .innerJoin(partner, sql`${partner.id} = case when ${pairs.playerA} = ${user.id} then ${pairs.playerB} else ${pairs.playerA} end`)
    .where(
      and(
        inArray(
          pairs.leagueId,
          list.map((l) => l.id),
        ),
        eq(pairs.status, "active"),
        or(eq(pairs.playerA, user.id), eq(pairs.playerB, user.id)),
      ),
    );
  return list.map((league) => {
    const p = active.find((a) => a.leagueId === league.id);
    return { league, pair: p ? { id: p.id, partnerName: p.partnerName } : null };
  });
}

// --- The organizer's Párok page (#97) ----------------------------------------

export type LeaguePairRow = {
  id: number;
  // phone: whether they gave a number (the page never shows it).
  players: { id: string; name: string; level: string | null; phone: boolean }[];
  elo: number | null;
  source: PairSource;
  status: "active" | "dissolved";
  // In a published group whose round hasn't ended: can't be dissolved or changed.
  locked: boolean;
  // The entry in the league's current (or next) season, if any.
  entry: { seasonId: number; season: string; status: EntryStatus; joinsPhase: number | null } | null;
  // "Benevezés" or "Kivétel a szezonból" for an active pair (#154), or none.
  entryAction: OrganizerEntryAction | null;
  // The league's first home season (current or next), so "not entered" can
  // say which; null when there is none.
  season: string | null;
};

const playerA = alias(users, "pair_player_a");
const playerB = alias(users, "pair_player_b");

// The league's active pairs that are in a published group before its round's
// deadline. Filtered by league, not by a list of ids (D1: at most 100 bound
// parameters per statement).
async function lockedPairs(leagueId: number, now: Date): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ id: groupPairs.pairId })
    .from(groupPairs)
    .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .innerJoin(seasonPhases, and(eq(seasonPhases.seasonId, groups.seasonId), eq(seasonPhases.number, groups.phase)))
    .where(
      and(
        eq(pairs.leagueId, leagueId),
        eq(pairs.status, "active"),
        // A pair withdrawn from its group (#34) plays there no more.
        isNull(groupPairs.withdrawnAt),
        isNotNull(groups.publishedAt),
        gte(seasonPhases.deadline, now),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

// Every pair of the league, active ones first, newest first.
export async function leaguePairs(leagueId: number, now = new Date()): Promise<LeaguePairRow[]> {
  const rows = await db
    .select({
      id: pairs.id,
      source: pairs.source,
      status: pairs.status,
      aId: pairs.playerA,
      aName: playerA.name,
      aLevel: playerA.level,
      aPhone: playerA.phone,
      bId: pairs.playerB,
      bName: playerB.name,
      bLevel: playerB.level,
      bPhone: playerB.phone,
    })
    .from(pairs)
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(eq(pairs.leagueId, leagueId))
    .orderBy(asc(pairs.status), desc(pairs.id));
  if (rows.length === 0) return [];
  const seasons = homeSeasons(await listSeasons(leagueId), now);
  const [locked, entries] = await Promise.all([
    lockedPairs(leagueId, now),
    seasons.length
      ? db
          .select({
            pairId: seasonEntries.pairId,
            seasonId: seasonEntries.seasonId,
            status: seasonEntries.status,
            joinsPhase: seasonEntries.joinsPhase,
          })
          .from(seasonEntries)
          .where(
            inArray(
              seasonEntries.seasonId,
              seasons.map((s) => s.id),
            ),
          )
      : Promise.resolve([]),
  ]);
  return rows.map((r) => {
    const entry = homeEntry(seasons, entries, r.id);
    return {
      id: r.id,
      players: [
        { id: r.aId, name: r.aName, level: r.aLevel, phone: !!r.aPhone },
        { id: r.bId, name: r.bName, level: r.bLevel, phone: !!r.bPhone },
      ],
      elo: averageStartingElo(r.aLevel, r.bLevel),
      source: r.source,
      status: r.status,
      locked: locked.has(r.id),
      entry,
      entryAction: r.status === "active" ? organizerEntryAction(seasons, entry, now) : null,
      season: seasons[0]?.name ?? null,
    };
  });
}

export type PairCandidate = { id: string; name: string; level: string | null };

// Registered players (first-login page done) without an active pair in the
// league, by name. Players don't belong to a league yet, so everyone counts.
export async function pairCandidates(leagueId: number): Promise<PairCandidate[]> {
  return db
    .select({ id: users.id, name: users.name, level: users.level })
    .from(users)
    .where(
      and(
        isNotNull(users.consentAt),
        sql`not exists (select 1 from ${pairs} where ${pairs.leagueId} = ${leagueId} and ${pairs.status} = 'active'
          and (${pairs.playerA} = ${users.id} or ${pairs.playerB} = ${users.id}))`,
      ),
    )
    .orderBy(asc(users.name), asc(users.id));
}

// Why `a` and `b` can't be a new pair, or null. `free`: the players who must
// not be in an active pair (both, unless one leaves their pair in the same
// step).
async function newPairRefusal(leagueId: number, a: string, b: string, free = [a, b]): Promise<string | null> {
  if (!a || !b || a === b) return NEW_PAIR_REFUSALS.same;
  const [registered, paired] = await db.batch([
    db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, [a, b]), isNotNull(users.consentAt))),
    db.select({ id: pairs.id }).from(pairs).where(activePairWith(leagueId, free)).limit(1),
  ]);
  const refusal = checkNewPair({ a, b, registered: registered.length === 2, paired: paired.length > 0 });
  return refusal ? NEW_PAIR_REFUSALS[refusal] : null;
}

// The active pair of exactly these two players in the league, if any.
async function activePairOf(leagueId: number, a: string, b: string): Promise<number | null> {
  const [row] = await db
    .select({ id: pairs.id })
    .from(pairs)
    .where(
      and(
        eq(pairs.leagueId, leagueId),
        eq(pairs.status, "active"),
        or(and(eq(pairs.playerA, a), eq(pairs.playerB, b)), and(eq(pairs.playerA, b), eq(pairs.playerB, a))),
      ),
    );
  return row?.id ?? null;
}

// The insert of a manual pair: only if neither player is in an active pair
// of the league by then (checked inside the statement, so two organizers at
// once can't put a player in two pairs). `also`: an extra condition.
function insertManualPair(leagueId: number, a: string, b: string, also = sql`1`) {
  return db.run(sql`insert into ${pairs} (league_id, player_a, player_b, source)
    select ${leagueId}, ${a}, ${b}, 'manual'
    where not ${activePairWith(leagueId, [a, b])} and ${also}`);
}

// "Pár létrehozása": two registered players without a pair in the league.
export async function createPair(actorId: string, leagueId: number, a: string, b: string): Promise<Result> {
  const refused = await newPairRefusal(leagueId, a, b);
  if (refused) return { ok: false, error: refused };
  await insertManualPair(leagueId, a, b);
  const id = await activePairOf(leagueId, a, b);
  // Someone was quicker with one of them.
  if (!id) return { ok: false, error: NEW_PAIR_REFUSALS.paired };
  await audit(actorId, "pair.create", `pair:${id}`, `league:${leagueId}; ${a} + ${b}`);
  return { ok: true };
}

type StoredPair = { status: "active" | "dissolved"; playerA: string; playerB: string };

async function pairInLeague(leagueId: number, pairId: number): Promise<StoredPair | undefined> {
  const [row] = await db
    .select({ status: pairs.status, playerA: pairs.playerA, playerB: pairs.playerB })
    .from(pairs)
    .where(and(eq(pairs.id, pairId), eq(pairs.leagueId, leagueId)));
  return row;
}

const GONE = "Ez a pár már nem aktív.";

export const NEW_PARTNER_REFUSED = "Válassz új partnert.";

// The dissolve itself: the update, then the withdrawal of the entries it
// hasn't played in yet (D19), in one batch with whatever follows. The
// running-group check is repeated in the update, so a group published in the
// meantime wins; the withdrawal only runs once the pair is dissolved.
// `also`: an extra condition for the update.
export function dissolveStatements(actorId: string, pairId: number, now: Date, also = sql`1`) {
  return [
    db
      .update(pairs)
      .set({ status: "dissolved", dissolvedAt: now, dissolvedBy: actorId })
      .where(and(eq(pairs.id, pairId), eq(pairs.status, "active"), notInRunningGroup(pairId, now), also))
      .returning({ id: pairs.id }),
    withdrawEntries(pairId, now),
  ] as const;
}

// Why a dissolve in a batch changed nothing, from the state now.
async function whyNotDissolved(leagueId: number, pairId: number, now: Date): Promise<string> {
  const pair = await pairInLeague(leagueId, pairId);
  if (!pair || pair.status !== "active") return GONE;
  return (await pairInRunningGroup(pairId, now)) ? DISSOLVE_REFUSED : NEW_PAIR_REFUSALS.paired;
}

// "Felbontás": not while the pair plays in a running round.
export async function dissolvePair(actorId: string, leagueId: number, pairId: number, now = new Date()): Promise<Result> {
  const pair = await pairInLeague(leagueId, pairId);
  if (!pair || pair.status !== "active") return { ok: false, error: GONE };
  if (!canDissolve(pair, await pairInRunningGroup(pairId, now))) return { ok: false, error: DISSOLVE_REFUSED };
  const [dissolved] = await db.batch(dissolveStatements(actorId, pairId, now));
  if (dissolved.length === 0) return { ok: false, error: await whyNotDissolved(leagueId, pairId, now) };
  await audit(actorId, "pair.dissolve", `pair:${pairId}`, `league:${leagueId}`);
  return { ok: true };
}

// "Partner cseréje": dissolves the pair and pairs `keep` (one of its players)
// with `partner`, in one batch: both happen or neither.
export async function changePartner(
  actorId: string,
  leagueId: number,
  pairId: number,
  keep: string,
  partner: string,
  now = new Date(),
): Promise<Result> {
  const pair = await pairInLeague(leagueId, pairId);
  if (!pair || pair.status !== "active" || (keep !== pair.playerA && keep !== pair.playerB)) return { ok: false, error: GONE };
  const leaving = keep === pair.playerA ? pair.playerB : pair.playerA;
  if (partner === keep || partner === leaving) return { ok: false, error: NEW_PARTNER_REFUSED };
  if (!canDissolve(pair, await pairInRunningGroup(pairId, now))) return { ok: false, error: DISSOLVE_REFUSED };
  // `keep` leaves this pair in the same step: only the new partner must be free.
  const refused = await newPairRefusal(leagueId, keep, partner, [partner]);
  if (refused) return { ok: false, error: refused };
  // One batch (a transaction in D1). The old pair only goes if the new
  // partner is still free. The new pair keeps `keep` in the same column, so
  // if the old pair is still active its unique index (one active pair per
  // player and column) fails the insert, and the whole batch rolls back.
  // A raw db.run() can't go in a D1 batch, hence the builder.
  const values = keep === pair.playerA ? { playerA: keep, playerB: partner } : { playerA: partner, playerB: keep };
  try {
    await db.batch([
      ...dissolveStatements(actorId, pairId, now, sql`not ${activePairWith(leagueId, [partner])}`),
      db.insert(pairs).values({ leagueId, ...values, source: "manual" }),
    ]);
  } catch (e) {
    if (!/UNIQUE/i.test(String(e))) throw e;
    return { ok: false, error: await whyNotDissolved(leagueId, pairId, now) };
  }
  const id = await activePairOf(leagueId, keep, partner);
  await audit(actorId, "pair.change", `pair:${id ?? "?"}`, `league:${leagueId}; from pair:${pairId}; ${leaving} -> ${partner}`);
  return { ok: true };
}
