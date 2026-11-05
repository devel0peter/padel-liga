import { currentElo, playedBy, ratedWinner, replayElo, STARTING_ELO, type EloChange, type RatedMatch } from "@padel-liga/rules";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { alias, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { eloChanges, jobRuns, matchDecisions, matches, matchSubstitutes, pairs, users } from "~/db/schema";
import { logError, logWarn } from "~/lib/log";

// Player Elo after every played match (#13, spec 11, D104). The ratings are
// a replay of every rated match (a played match that is final) from the
// players' starting values, in the order the matches first became final:
// an organizer's later ruling keeps the match in its place, so the ratings
// end up as if the new outcome had been there from the start. A walkover,
// both-inactive or unplayed match changes nothing; a pair withdrawn later
// keeps the changes of its final matches (D104). Only the difference to what
// is stored is written: users.elo and elo_changes.
//
// Called after every write that makes a match final (a confirmed result,
// the cron's auto-accept, an organizer's ruling) and before the groups draft
// reads the ratings (groups.server.ts). One replay is ELO_REPLAY_QUERIES; a
// failed one is logged and the next one puts everything right, since it
// replays from the start.

const pairA = alias(pairs, "elo_pair_a");
const pairB = alias(pairs, "elo_pair_b");

const ratedMatch = and(eq(matches.status, "final"), sql`json_extract(${matches.outcome}, '$.kind') = 'played'`);

// The approved substitute (#37, D109) of a player in the match, or null. An
// approval can't change once the match has a result (substitutes.ts), so the
// fingerprint below still covers it.
const substituteOf = (player: AnySQLiteColumn) =>
  sql<string | null>`(select ${matchSubstitutes.substituteId} from ${matchSubstitutes}
    where ${matchSubstitutes.matchId} = ${matches.id} and ${matchSubstitutes.absentId} = ${player} and ${matchSubstitutes.status} = 'approved')`;

// A player without a level can't enter (D18), so never in a rated match;
// should one be, they start as kezdő.
const FALLBACK_START = STARTING_ELO.kezdo;

// Everything that makes a match final bumps its revision, so this changes
// whenever a replay could come out differently.
async function fingerprint(): Promise<{ count: number; revisions: number }> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`, revisions: sql<number>`coalesce(sum(${matches.revision}), 0)` })
    .from(matches)
    .where(eq(matches.status, "final"));
  return { count: row?.count ?? 0, revisions: row?.revisions ?? 0 };
}

// When a match first became final: its first ruling (auto-accept, the
// organizer) or its confirmation, whichever came first; seconds.
async function ratedMatches(): Promise<{ match: RatedMatch; at: number }[]> {
  const rows = await db
    .select({
      id: matches.id,
      outcome: matches.outcome,
      a1: pairA.playerA,
      a2: pairA.playerB,
      b1: pairB.playerA,
      b2: pairB.playerB,
      sa1: substituteOf(pairA.playerA),
      sa2: substituteOf(pairA.playerB),
      sb1: substituteOf(pairB.playerA),
      sb2: substituteOf(pairB.playerB),
      ruledAt: sql<number | null>`(select min(${matchDecisions.at}) from ${matchDecisions} where ${matchDecisions.matchId} = ${matches.id})`,
      confirmedAt: sql<number | null>`(select min(e.at) from match_events e where e.match_id = ${matches.id} and e.kind = 'result_confirmed')`,
    })
    .from(matches)
    .innerJoin(pairA, eq(pairA.id, matches.pairA))
    .innerJoin(pairB, eq(pairB.id, matches.pairB))
    .where(ratedMatch);
  const list: { match: RatedMatch; at: number }[] = [];
  for (const r of rows) {
    const winner = ratedWinner(r.outcome);
    if (!winner) continue;
    const times = [r.ruledAt, r.confirmedAt].filter((t): t is number => t !== null);
    // The players who actually played: an approved substitute (#37) takes
    // the absent player's place, whose rating doesn't change (spec 11).
    const subs = new Map(
      [
        [r.a1, r.sa1],
        [r.a2, r.sa2],
        [r.b1, r.sb1],
        [r.b2, r.sb2],
      ].filter((e): e is [string, string] => e[1] !== null),
    );
    list.push({
      match: { id: r.id, a: playedBy([r.a1, r.a2], subs), b: playedBy([r.b1, r.b2], subs), winner },
      at: times.length > 0 ? Math.min(...times) : Infinity,
    });
  }
  return list.sort((x, y) => x.at - y.at || x.match.id - y.match.id);
}

const key = (matchId: number, userId: string) => `${matchId}:${userId}`;

// A statement that fails the batch (NOT NULL) when a match became final, or
// changed, after the replay read them: the replay then starts over.
const guard = (seen: { count: number; revisions: number }) =>
  db
    .insert(jobRuns)
    .values({
      key: "elo replay",
      doneAt: sql`(select case when count(*) = ${seen.count} and coalesce(sum(${matches.revision}), 0) = ${seen.revisions} then unixepoch() end
        from ${matches} where ${matches.status} = 'final')`,
    })
    .onConflictDoUpdate({ target: jobRuns.key, set: { doneAt: sql`excluded.done_at` } });

const stale = (e: unknown) => /NOT NULL constraint failed: job_runs\.done_at/i.test(`${e} ${(e as Error)?.cause ?? ""}`);

// 7 bound parameters a row; D1 takes 100 a statement.
const ROWS_PER_INSERT = 14;

/** One replay; false when a match became final meanwhile and nothing was written. */
async function replayOnce(now: Date): Promise<boolean> {
  const seen = await fingerprint();
  const rated = await ratedMatches();
  const players = await db
    .select({ id: users.id, level: users.level, elo: users.elo })
    .from(users)
    .where(
      or(
        isNotNull(users.elo),
        sql`exists (select 1 from ${matches} join ${pairs} on ${pairs.id} in (${matches.pairA}, ${matches.pairB})
          where ${ratedMatch} and ${users.id} in (${pairs.playerA}, ${pairs.playerB}))`,
        // A substitute who played a rated match (#37).
        sql`exists (select 1 from ${matchSubstitutes} join ${matches} on ${matches.id} = ${matchSubstitutes.matchId}
          where ${ratedMatch} and ${matchSubstitutes.status} = 'approved' and ${matchSubstitutes.substituteId} = ${users.id})`,
      ),
    );
  const stored = await db.select().from(eloChanges);

  const level = new Map(players.map((p) => [p.id, p.level]));
  const nowSeconds = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const at = new Map(rated.map((r) => [r.match.id, Number.isFinite(r.at) ? new Date(r.at * 1000) : nowSeconds]));
  const { changes, players: result } = replayElo(
    (id) => currentElo(null, level.get(id) ?? null) ?? FALLBACK_START,
    rated.map((r) => r.match),
  );

  const old = new Map(stored.map((s) => [key(s.matchId, s.userId), s]));
  const fresh = new Set(changes.map((c) => key(c.matchId, c.playerId)));
  const row = (c: EloChange) => ({
    matchId: c.matchId,
    userId: c.playerId,
    ratingBefore: c.before,
    ratingAfter: c.after,
    delta: c.delta,
    k: c.k,
    at: at.get(c.matchId)!,
  });
  const upserts = changes.map(row).filter((r) => {
    const s = old.get(key(r.matchId, r.userId));
    return (
      !s ||
      s.ratingBefore !== r.ratingBefore ||
      s.ratingAfter !== r.ratingAfter ||
      s.delta !== r.delta ||
      s.k !== r.k ||
      s.at.getTime() !== r.at.getTime()
    );
  });
  const removed = stored.filter((s) => !fresh.has(key(s.matchId, s.userId)));
  const ratings = players.filter((p) => (result.get(p.id)?.rating ?? null) !== p.elo);

  if (upserts.length === 0 && removed.length === 0 && ratings.length === 0) return true;
  const statements = [
    guard(seen),
    ...Array.from({ length: Math.ceil(upserts.length / ROWS_PER_INSERT) }, (_, i) =>
      db
        .insert(eloChanges)
        .values(upserts.slice(i * ROWS_PER_INSERT, (i + 1) * ROWS_PER_INSERT))
        .onConflictDoUpdate({
          target: [eloChanges.matchId, eloChanges.userId],
          set: {
            ratingBefore: sql`excluded.rating_before`,
            ratingAfter: sql`excluded.rating_after`,
            delta: sql`excluded.delta`,
            k: sql`excluded.k`,
            at: sql`excluded.at`,
          },
        }),
    ),
    ...removed.map((s) => db.delete(eloChanges).where(and(eq(eloChanges.matchId, s.matchId), eq(eloChanges.userId, s.userId)))),
    ...ratings.map((p) => db.update(users).set({ elo: result.get(p.id)?.rating ?? null }).where(eq(users.id, p.id))),
  ];
  try {
    await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
    return true;
  } catch (e) {
    if (stale(e)) return false;
    throw e;
  }
}

const ATTEMPTS = 3;

/** One replay's D1 queries (four reads and the write batch); a retry costs as much again. */
export const ELO_REPLAY_QUERIES = 5;

/**
 * Brings every player's Elo up to date with the final matches. Never
 * throws: the match it follows is already final, and a failure is logged and
 * mended by the next replay.
 */
export async function updateElo(now = new Date()): Promise<void> {
  try {
    for (let i = 0; i < ATTEMPTS; i++) if (await replayOnce(now)) return;
    logWarn("elo replay kept losing to new results", { attempts: ATTEMPTS });
  } catch (error) {
    logError("elo replay failed", { error });
  }
}
