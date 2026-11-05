import { pairsLeaving, STRIKE_LIMIT, strikeCounts, strikeNotice, type StrikeSource } from "@padel-liga/rules";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import { auditLog, groupPairs, groups, leagues, pairs, seasons, strikes, users } from "~/db/schema";
import { auditIfChanged } from "~/lib/audit.server";
import { queueStrikeWarnings } from "~/lib/email/outbox.server";
import { logError } from "~/lib/log";
import { strikeMessage, type Message } from "~/lib/notifications";
import { notifyPlayers } from "~/lib/notifications.server";

import { chunks } from "./result-log.server";
import { CANCEL_REASON_MAX } from "./strikes";

// Strikes ("fekete pont", spec 8, #294, D103): giving them (the deadline
// resolution, deadline.server.ts; a confirmed no-show, #33), counting them per
// player and season (packages/rules strikes.ts), the organizer's cancel with
// a reason, and the pairs a 3rd strike sends off at the round switch (#35).
// Never on a public page: the counts are for the player and the organizer.

export type StrikeGrant = {
  seasonId: number;
  pairId: number;
  // The pair's two players: a substitute (#37) never gets one (spec 8).
  players: readonly string[];
  matchId: number | null;
  source: StrikeSource;
  at: Date;
};

// The inserts of a grant, for the caller's batch. A player gets at most one
// strike per match and source (the unique index): a re-run adds nothing.
export function strikeInserts(grants: readonly StrikeGrant[]): BatchItem<"sqlite">[] {
  return chunks(strikeRows(grants), 10).map((part) => db.insert(strikes).values(part).onConflictDoNothing());
}

const strikeRows = (grants: readonly StrikeGrant[]) =>
  grants.flatMap((g) => g.players.map((userId) => ({ seasonId: g.seasonId, userId, pairId: g.pairId, matchId: g.matchId, source: g.source, at: g.at })));

/** The live (not cancelled) strike counts of these players in these seasons, by `${seasonId}:${userId}`. One query per 90 players. */
export async function liveCounts(userIds: readonly string[], seasonIds: readonly number[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const users = [...new Set(userIds)];
  const seasonsWanted = [...new Set(seasonIds)];
  if (users.length === 0 || seasonsWanted.length === 0) return out;
  const parts = await Promise.all(
    chunks(users).map((ids) =>
      db
        .select({ userId: strikes.userId, seasonId: strikes.seasonId, cancelledAt: strikes.cancelledAt })
        .from(strikes)
        .where(and(inArray(strikes.userId, ids), inArray(strikes.seasonId, seasonsWanted))),
    ),
  );
  const rows = parts.flat().map((r) => ({ userId: r.userId, seasonId: r.seasonId, cancelled: r.cancelledAt !== null }));
  for (const seasonId of seasonsWanted) for (const [userId, n] of strikeCounts(rows, seasonId)) out.set(`${seasonId}:${userId}`, n);
  return out;
}

// `pairCount`: the highest count in the player's pair after the strike, so
// both players hear that the pair leaves when either has 3 (spec 13).
export type StrikeNoticeInput = { userId: string; email: string; name: string; count: number; pairCount: number; source: StrikeSource; matchId: number | null };

// What each player is told after a strike that brought them to `count`
// (spec 13): the in-app notice and push with the count; the 2nd also the
// warning email, unless the pair leaves already (packages/rules strikeNotice).
export function strikeNotices(list: readonly StrikeNoticeInput[], season: (userId: string) => { league: string; season: string }) {
  const messages: { userId: string; message: Message }[] = [];
  const warnings: { toEmail: string; input: { to: string; league: string; season: string } }[] = [];
  for (const p of list) {
    const notice = strikeNotice(p.count, p.pairCount);
    if (!notice) continue;
    messages.push({
      userId: p.userId,
      message: strikeMessage({ count: p.count, leaving: notice === "leaving", source: p.source, matchId: p.matchId }),
    });
    if (notice === "warning") warnings.push({ toEmail: p.email, input: { to: p.name, ...season(p.userId) } });
  }
  return { messages, warnings };
}

/**
 * Gives a strike to both players of a pair (spec 8) from a request: for #33,
 * an organizer-confirmed no-show. Stored, then each player is told (in the
 * app and by push; the 2nd strike also by the warning email, sent at once).
 * Only a player whose strike was stored now is told: the same grant again
 * (a retried request) stores and sends nothing. Returns the players' new
 * counts. The deadline resolution gives its strikes in its own batch
 * (deadline.server.ts).
 */
export async function giveStrikes(grant: StrikeGrant): Promise<Map<string, number>> {
  if (grant.players.length === 0) return new Map();
  const stored = new Set(
    (await db.insert(strikes).values(strikeRows([grant])).onConflictDoNothing().returning({ userId: strikes.userId })).map((r) => r.userId),
  );
  const counts = await liveCounts(grant.players, [grant.seasonId]);
  const out = new Map(grant.players.map((id) => [id, counts.get(`${grant.seasonId}:${id}`) ?? 0]));
  if (stored.size === 0) return out;
  const pairCount = Math.max(...out.values());
  try {
    const [people, [names]] = await Promise.all([
      db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(inArray(users.id, [...stored])),
      db
        .select({ league: leagues.name, season: seasons.name })
        .from(seasons)
        .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
        .where(eq(seasons.id, grant.seasonId)),
    ]);
    const { messages, warnings } = strikeNotices(
      people.map((p) => ({ userId: p.id, email: p.email, name: p.name ?? "", count: out.get(p.id) ?? 0, pairCount, source: grant.source, matchId: grant.matchId })),
      () => ({ league: names?.league ?? "", season: names?.season ?? "" }),
    );
    await notifyPlayers("strike", messages);
    await queueStrikeWarnings(warnings, true);
  } catch (error) {
    // The strike is saved; a failed notice must not undo or hide it.
    logError("strike notification failed", { pairId: grant.pairId, error });
  }
  return out;
}

// --- The round switch (#35) ---------------------------------------------------

/**
 * The pairs of a published phase that leave the league at the round switch
 * (spec 8, 10): a player of the pair has 3 or more live strikes this season.
 * Withdrawn pairs are gone already and left out. Removal is #35's step,
 * after promotion and relegation; a cancelled strike takes the pair off the
 * list again.
 */
export async function pairsLeavingAfterPhase(seasonId: number, phase: number): Promise<{ pairId: number; groupId: number; players: [string, string] }[]> {
  const rows = await db
    .select({ pairId: pairs.id, groupId: groups.id, a: pairs.playerA, b: pairs.playerB })
    .from(groupPairs)
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
    .where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase), isNotNull(groups.publishedAt), isNull(groupPairs.withdrawnAt)));
  if (rows.length === 0) return [];
  const counts = await liveCounts(
    rows.flatMap((r) => [r.a, r.b]),
    [seasonId],
  );
  const bySeason = new Map([...counts].map(([key, n]) => [key.slice(key.indexOf(":") + 1), n]));
  return pairsLeaving(
    rows.map((r) => ({ pairId: r.pairId, groupId: r.groupId, players: [r.a, r.b] as [string, string] })),
    bySeason,
  );
}

// --- Reading -----------------------------------------------------------------

/**
 * A player's own live strikes per season they have any in, newest season
 * first, and whether their pair leaves at the end of the phase (Kezdőlap
 * card): a player of their pair in the season's newest published phase they
 * play has 3 (maybe the partner alone, after a partner change: spec 8, 13),
 * and always when the player has 3 themselves.
 * A season where only the partner has strikes is listed with 0 when the pair
 * leaves. Three queries.
 */
export async function myStrikes(userId: string): Promise<{ seasonId: number; count: number; leaving: boolean }[]> {
  const [rows, mine] = await Promise.all([
    db
      .select({ seasonId: strikes.seasonId, count: sql<number>`count(*)` })
      .from(strikes)
      .where(and(eq(strikes.userId, userId), isNull(strikes.cancelledAt)))
      .groupBy(strikes.seasonId),
    db
      .select({ seasonId: groups.seasonId, phase: groups.phase, a: pairs.playerA, b: pairs.playerB })
      .from(groupPairs)
      .innerJoin(groups, eq(groups.id, groupPairs.groupId))
      .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
      .where(and(or(eq(pairs.playerA, userId), eq(pairs.playerB, userId)), isNotNull(groups.publishedAt), isNull(groupPairs.withdrawnAt))),
  ]);
  const own = new Map(rows.map((r) => [r.seasonId, Number(r.count)]));
  const newest = new Map<number, number>();
  for (const r of mine) newest.set(r.seasonId, Math.max(newest.get(r.seasonId) ?? 0, r.phase));
  const current = mine.filter((r) => r.phase === newest.get(r.seasonId)).map((r) => ({ seasonId: r.seasonId, partner: r.a === userId ? r.b : r.a }));
  const partners = await liveCounts(
    current.map((r) => r.partner),
    current.map((r) => r.seasonId),
  );
  // The player's own 3rd always counts, in a group or not (a withdrawn pair, D87).
  const leaving = new Set([
    ...[...own].filter(([, n]) => n >= STRIKE_LIMIT).map(([seasonId]) => seasonId),
    ...current.filter((r) => (partners.get(`${r.seasonId}:${r.partner}`) ?? 0) >= STRIKE_LIMIT).map((r) => r.seasonId),
  ]);
  return [...new Set([...own.keys(), ...leaving])]
    .sort((x, y) => y - x)
    .map((seasonId) => ({ seasonId, count: own.get(seasonId) ?? 0, leaving: leaving.has(seasonId) }));
}

export type LeagueStrike = {
  id: number;
  seasonId: number;
  season: string;
  userId: string;
  name: string;
  pairId: number | null;
  matchId: number | null;
  source: StrikeSource;
  at: Date;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
};

const canceller = sql`(select name from users c where c.id = ${strikes.cancelledBy})`;

/** Every strike of the league's seasons, newest first, for its organizer (Párok). Names only, never an email or phone. */
export async function leagueStrikes(leagueId: number): Promise<LeagueStrike[]> {
  const rows = await db
    .select({
      id: strikes.id,
      seasonId: strikes.seasonId,
      season: seasons.name,
      userId: strikes.userId,
      name: users.name,
      pairId: strikes.pairId,
      matchId: strikes.matchId,
      source: strikes.source,
      at: strikes.at,
      cancelledAt: strikes.cancelledAt,
      cancelledBy: sql<string | null>`${canceller}`,
      cancelReason: strikes.cancelReason,
    })
    .from(strikes)
    .innerJoin(seasons, eq(seasons.id, strikes.seasonId))
    .innerJoin(users, eq(users.id, strikes.userId))
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(strikes.at), desc(strikes.id));
  return rows.map((r) => ({ ...r, name: r.name || "Törölt játékos" }));
}

/** Live strike counts per player and season, for the Párok list. */
export function countsBySeason(list: readonly LeagueStrike[]): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  const rows = list.map((s) => ({ userId: s.userId, seasonId: s.seasonId, cancelled: s.cancelledAt !== null }));
  for (const seasonId of new Set(list.map((s) => s.seasonId))) out.set(seasonId, strikeCounts(rows, seasonId));
  return out;
}

// --- Cancelling (spec 8, D91) ---------------------------------------------------

export type CancelResult = { ok: true; notice: string } | { ok: false; error: string };

/**
 * The organizer cancels a strike of their league with a required reason
 * (illness, a club cancelling the court): the row is marked, the audit entry
 * has the reason, and every count leaves it out from now on (a pair flagged
 * by its 3rd strike is no longer). The player isn't told: the count on their
 * page changes.
 */
export async function cancelStrike(actorId: string, leagueId: number, strikeId: number, reason: string, now = new Date()): Promise<CancelResult> {
  const why = reason.trim();
  if (why === "") return { ok: false, error: "Írd meg, miért törlöd a fekete pontot." };
  if (why.length > CANCEL_REASON_MAX) return { ok: false, error: `Az indok legfeljebb ${CANCEL_REASON_MAX} karakter legyen.` };
  const inLeague = sql`${strikes.seasonId} in (select ${seasons.id} from ${seasons} where ${seasons.leagueId} = ${leagueId})`;
  const [changed] = await db.batch([
    db
      .update(strikes)
      .set({ cancelledAt: now, cancelledBy: actorId, cancelReason: why })
      .where(and(eq(strikes.id, strikeId), isNull(strikes.cancelledAt), inLeague))
      .returning({ id: strikes.id }),
    auditIfChanged({ actorId, action: "strike.cancel", target: `strike:${strikeId}`, detail: why, leagueId }),
  ]);
  if (changed.length === 0) return { ok: false, error: "Ez a fekete pont már törölve van, vagy nincs ilyen." };
  return { ok: true, notice: "Töröltük a fekete pontot." };
}

// Anonymizing an account (account-deletion.server.ts): the reasons of the
// player's cancelled strikes may name an illness, in the strike rows and in
// their audit entries. Statements for the deletion's batch, run only while
// `guard` holds (the account was anonymized in the same batch).
export function clearStrikeReasons(userId: string, guard: SQL) {
  return [
    db
      .update(auditLog)
      .set({ detail: null })
      .where(
        and(eq(auditLog.action, "strike.cancel"), sql`${auditLog.target} in (select 'strike:' || ${strikes.id} from ${strikes} where ${strikes.userId} = ${userId})`, guard),
      ),
    db
      .update(strikes)
      .set({ cancelReason: null })
      .where(and(eq(strikes.userId, userId), isNotNull(strikes.cancelReason), guard)),
  ];
}
