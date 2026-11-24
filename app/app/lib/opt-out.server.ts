// "Nem folytatom" and "Mégis folytatom" on Ligáim (#395, D176): the D1 side
// of opt-out.ts. A player of a pair that plays the running round opts the
// pair out of the next one until the round's deadline; the one who did can
// take it back until then. The entry stays "approved": the running round's
// matches count as usual, and the round switch leaves the pair out as
// "nem folytatja" (round-switch.server.ts). Each change writes one Napló
// entry with the player as actor, and tells the partner in the app and by
// push, never by email.

import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { groupPairs, groups, leagues, pairs, seasonEntries, seasonPhases, users } from "~/db/schema";

import { auditIfChanged } from "./audit.server";
import { notifyPlayers } from "./notifications.server";
import { OPT_OUT_REFUSALS, optOutMessage, optOutRefusal, optOutState, optOutWindow, type OptOutEntry, type OptOutState } from "./opt-out";
import type { Season } from "./seasons";
import { getSeason } from "./seasons.server";

type Result = { ok: true } | { ok: false; error: string };

type Context = {
  pairId: number;
  league: string;
  // The partner, unless their account is deleted.
  partnerId: string | null;
  // The pair's entry that counts (approved), null without one.
  entry: OptOutEntry | null;
  // The rounds the pair has a published group in, not withdrawn from it.
  playing: number[];
};

// The player's active pair in the league, its entry in the season and the
// rounds it plays: two queries. Null without an active pair.
async function context(userId: string, leagueId: number, seasonId: number): Promise<Context | null> {
  const partner = sql<string>`case when ${pairs.playerA} = ${userId} then ${pairs.playerB} else ${pairs.playerA} end`;
  const [row] = await db
    .select({
      pairId: pairs.id,
      league: leagues.name,
      partnerId: partner,
      partnerDeleted: sql<number>`(select ${users.deletedAt} is not null from ${users} where ${users.id} = ${partner})`,
      status: seasonEntries.status,
      optOutPhase: seasonEntries.optOutPhase,
      optedOutBy: seasonEntries.optedOutBy,
    })
    .from(pairs)
    .innerJoin(leagues, eq(leagues.id, pairs.leagueId))
    .leftJoin(seasonEntries, and(eq(seasonEntries.pairId, pairs.id), eq(seasonEntries.seasonId, seasonId)))
    .where(and(eq(pairs.leagueId, leagueId), eq(pairs.status, "active"), or(eq(pairs.playerA, userId), eq(pairs.playerB, userId))))
    .limit(1);
  if (!row) return null;
  const playing = await db
    .select({ phase: groups.phase })
    .from(groupPairs)
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .where(and(eq(groupPairs.pairId, row.pairId), eq(groups.seasonId, seasonId), isNotNull(groups.publishedAt), isNull(groupPairs.withdrawnAt)));
  return {
    pairId: row.pairId,
    league: row.league,
    partnerId: row.partnerDeleted ? null : row.partnerId,
    entry: row.status === "approved" ? { optOutPhase: row.optOutPhase, optedOutBy: row.optedOutBy } : null,
    playing: playing.map((p) => p.phase),
  };
}

/**
 * What Ligáim's card shows about the next round for the player's pair in
 * this season (#395), or null: nothing to say (no running round to opt out
 * of, no opt-out) or no active pair with an entry that counts.
 */
export async function optOutCard(userId: string, leagueId: number, season: Season, now = new Date()): Promise<OptOutState | null> {
  const c = await context(userId, leagueId, season.id);
  if (!c?.entry) return null;
  return optOutState(optOutWindow(season.phases, c.playing, now), c.entry, userId, now, season.phases);
}

// The guard inside the write: the round's deadline hasn't passed, so a
// request that reaches D1 after it changes nothing.
const beforeDeadline = (seasonId: number, round: number, now: Date) =>
  sql`exists (select 1 from ${seasonPhases} where ${seasonPhases.seasonId} = ${seasonId} and ${seasonPhases.number} = ${round}
    and ${seasonPhases.deadline} >= ${Math.floor(now.getTime() / 1000)})`;

async function change(action: "opt_out" | "undo", user: { id: string }, leagueId: number, seasonId: number, now: Date): Promise<Result> {
  const season = await getSeason(seasonId);
  if (!season || season.leagueId !== leagueId) return { ok: false, error: "Nincs ilyen szezon." };
  const c = await context(user.id, leagueId, seasonId);
  if (!c) return { ok: false, error: OPT_OUT_REFUSALS.no_pair };
  const refusal = optOutRefusal(action, { phases: season.phases, playing: c.playing, entry: c.entry, me: user.id, now });
  if (refusal) return { ok: false, error: OPT_OUT_REFUSALS[refusal] };
  const window = optOutWindow(season.phases, c.playing, now)!;
  const entry = and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.pairId, c.pairId), eq(seasonEntries.status, "approved"));
  const [changed] = await db.batch([
    action === "opt_out"
      ? db
          .update(seasonEntries)
          .set({ optOutPhase: window.round, optedOutBy: user.id, optedOutAt: now, updatedAt: now })
          .where(and(entry, isNull(seasonEntries.optOutPhase), beforeDeadline(seasonId, window.round, now)))
          .returning({ id: seasonEntries.id })
      : db
          .update(seasonEntries)
          .set({ optOutPhase: null, optedOutBy: null, optedOutAt: null, updatedAt: now })
          .where(
            and(entry, eq(seasonEntries.optOutPhase, window.round), eq(seasonEntries.optedOutBy, user.id), beforeDeadline(seasonId, window.round, now)),
          )
          .returning({ id: seasonEntries.id }),
    auditIfChanged({
      actorId: user.id,
      action: action === "opt_out" ? "season_entry.opt_out" : "season_entry.opt_out_undo",
      target: `pair:${c.pairId}`,
      detail: `season:${seasonId} round:${window.round}`,
      leagueId,
    }),
  ]);
  if (changed.length === 0) {
    // Changed meanwhile (the partner, another tab, the deadline): say why now.
    const again = await context(user.id, leagueId, seasonId);
    const why = again && optOutRefusal(action, { phases: season.phases, playing: again.playing, entry: again.entry, me: user.id, now });
    return { ok: false, error: why ? OPT_OUT_REFUSALS[why] : "Valami közben változott. Frissítsd az oldalt." };
  }
  if (c.partnerId)
    await notifyPlayers("pair_opt_out", [
      { userId: c.partnerId, message: optOutMessage({ league: c.league, season: season.name, nextRound: window.nextRound }, action) },
    ]);
  return { ok: true };
}

/** "Nem folytatom": the pair leaves the season after the running round. */
export function optOut(user: { id: string }, leagueId: number, seasonId: number, now = new Date()): Promise<Result> {
  return change("opt_out", user, leagueId, seasonId, now);
}

/** "Mégis folytatom": only the player who opted out, until the deadline. */
export function undoOptOut(user: { id: string }, leagueId: number, seasonId: number, now = new Date()): Promise<Result> {
  return change("undo", user, leagueId, seasonId, now);
}
