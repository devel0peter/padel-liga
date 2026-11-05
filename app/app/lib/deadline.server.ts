import { resolutionCutoff, resolveAtDeadline, type Side } from "@padel-liga/rules";
import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import { groups, leagues, matchDecisions, matches, noShowReports, pairs, seasons, users } from "~/db/schema";
import { auditEntry } from "~/lib/audit.server";
import { reminderEmailInserts } from "~/lib/email/outbox.server";
import { matchResolvedMessage, type Message } from "~/lib/notifications";
import { queuedNotifications } from "~/lib/notifications.server";
import type { RunBudget, Usage } from "~/lib/run-usage";

import { SIDES } from "./decisions.server";
import { eventsOf, noWithdrawnPair, toSchedulingEvent } from "./matches.server";
import { chunks } from "./result-log.server";
import { guardedMatchId } from "./results.server";
import { neutralOutcomeText, outcomeText } from "./results";
import { liveCounts, strikeInserts, strikeNotices } from "./strikes.server";

// The deadline resolution (spec 8, #11, D103): the cron step that, from
// 06:00 Budapest the morning after a phase's deadline, settles each match
// that has no result yet from its scheduling log (packages/rules
// resolveAtDeadline): a walkover, both losing, or unplayed. Like the 48-hour
// auto-accept it writes a ruling (match_decisions, kind "deadline") and makes
// the match final in one batch with its audit entry, the strikes of the
// inactive side (#294), and the players' notices (pushes queued, the 2nd
// strike's warning email queued for the run's delivery step), all guarded by
// the match's revision: a step taken meanwhile wins and the match waits for
// the next run. A match with a recorded or disputed result is left to the
// auto-accept and the organizer; a withdrawn pair's match doesn't count and
// is never resolved (no strike, spec 8), nor is one with a no-show report
// waiting for the organizer (#33): the next run after their decision (a
// rejection) resolves it as usual. The organizer can override any
// resolved match (D78); a strike stays until the organizer cancels it.

/** At most this many matches per run, in one D1 batch; the rest go on the next runs (every 10 minutes). */
export const DEADLINE_BATCH = 25;

// The lookups before the per-match batches: the matches, their logs, the
// pairs, the players, the counts, the opt-outs, and the two email checks.
const LOOKUPS = 8;

// The lookups and the one batch; a race costs one batch per match more.
export const DEADLINE_MIN: Usage = { queries: LOOKUPS + 1, calls: 0 };

type Due = {
  id: number;
  pairA: number;
  pairB: number;
  revision: number;
  deadline: Date;
  seasonId: number;
  leagueId: number;
  league: string;
  season: string;
};

/**
 * Resolves the matches due at `now` (at most `limit`, and as many as the
 * run's budget allows after `keep`); returns how many, and whether any are
 * left for the next run.
 */
export async function resolveDeadlines(
  now: Date,
  budget?: { run: RunBudget; keep: Usage },
  limit = DEADLINE_BATCH,
): Promise<{ resolved: number; left: boolean }> {
  const room = () => !budget || budget.run.fits({ queries: budget.keep.queries + 1, calls: budget.keep.calls });
  if (budget && !budget.run.fits({ queries: budget.keep.queries + DEADLINE_MIN.queries, calls: budget.keep.calls })) return { resolved: 0, left: true };
  const due: Due[] = await db
    .select({
      id: matches.id,
      pairA: matches.pairA,
      pairB: matches.pairB,
      revision: matches.revision,
      deadline: matches.deadline,
      seasonId: seasons.id,
      leagueId: leagues.id,
      league: leagues.name,
      season: seasons.name,
    })
    .from(matches)
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .where(
      and(
        inArray(matches.status, ["open", "scheduled"]),
        lt(matches.deadline, resolutionCutoff(now)),
        isNotNull(groups.publishedAt),
        noWithdrawnPair,
        // A no-show report waiting for the organizer (#33): theirs to decide.
        noOpenNoShow,
      ),
    )
    .orderBy(asc(matches.id))
    .limit(limit + 1);
  if (due.length === 0) return { resolved: 0, left: false };
  const list = due.slice(0, limit);
  const more = due.length > limit;

  const [events, players] = await Promise.all([eventsOf(list.map((m) => m.id)), playersOf(list.flatMap((m) => [m.pairA, m.pairB]))]);
  const plans = list.map((m) => {
    const r = resolveAtDeadline(
      (events.get(m.id) ?? []).map((e) => toSchedulingEvent(e, m.pairA)),
      m.deadline,
    );
    return { m, outcome: r.outcome, inactive: r.inactive };
  });
  const struck = plans.flatMap((p) => p.inactive.map((s) => players.get(side(p.m, s))?.map((u) => ({ ...u, seasonId: p.m.seasonId })) ?? []).flat());
  // The counts before this run; each strike below adds one in order.
  const counts = await liveCounts(
    struck.map((u) => u.id),
    struck.map((u) => u.seasonId),
  );

  const batches: BatchItem<"sqlite">[][] = [];
  const notices: { kind: "match_decided" | "strike"; messages: { userId: string; message: Message }[] }[][] = [];
  const emails: Parameters<typeof reminderEmailInserts>[0] = [];
  // Per match, the players (by `${seasonId}:${userId}`) it gives a strike.
  const struckKeys: string[][] = [];
  for (const plan of plans) {
    const { m, outcome, inactive } = plan;
    const messages: { userId: string; message: Message }[] = [];
    for (const s of ["a", "b"] as const)
      for (const u of players.get(side(m, s)) ?? []) messages.push({ userId: u.id, message: matchResolvedMessage({ matchId: m.id, outcome: outcomeText(outcome, s) }) });
    const given = inactive.flatMap((s) =>
      (players.get(side(m, s)) ?? []).map((u) => {
        const key = `${m.seasonId}:${u.id}`;
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return { ...u, key, count, pairId: side(m, s) };
      }),
    );
    struckKeys.push(given.map((u) => u.key));
    // The pair leaves when either of its players has 3 (spec 13): both are told.
    const pairCount = (pairId: number) => Math.max(...given.filter((u) => u.pairId === pairId).map((u) => u.count));
    const { messages: strikeMessages, warnings } = strikeNotices(
      given.map((u) => ({ userId: u.id, email: u.email, name: u.name, count: u.count, pairCount: pairCount(u.pairId), source: "deadline" as const, matchId: m.id })),
      () => ({ league: m.league, season: m.season }),
    );
    notices.push([
      { kind: "match_decided", messages },
      { kind: "strike", messages: strikeMessages },
    ]);
    emails.push(warnings.map((w) => ({ kind: "strike_warning" as const, toEmail: w.toEmail, input: w.input })));
    batches.push([
        db.insert(matchDecisions).values({ matchId: guardedMatchId(m.id, m.revision), kind: "deadline", userId: null, outcome, at: now }),
        db
          .update(matches)
          .set({ revision: m.revision + 1, status: "final", outcome })
          .where(and(eq(matches.id, m.id), eq(matches.revision, m.revision))),
        // The system's decision: no actor, no names (A/B).
        auditEntry({ actorId: null, action: "match.deadline", target: `match:${m.id}`, detail: neutralOutcomeText(outcome, SIDES), at: now, leagueId: m.leagueId }),
        ...strikeInserts(
          [...new Set(given.map((u) => u.pairId))].map((pairId) => ({
            seasonId: m.seasonId,
            pairId,
            players: given.filter((u) => u.pairId === pairId).map((u) => u.id),
            matchId: m.id,
            source: "deadline" as const,
            at: now,
          })),
        ),
    ]);
  }
  const [noticeInserts, emailInserts] = await Promise.all([queuedNotifications(["match_decided", "strike"], notices, now), reminderEmailInserts(emails)]);

  const each = batches.map((b, i) => [...b, ...noticeInserts[i]!, ...emailInserts[i]!] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  // All of them in one batch (one query): after the deadline nobody can take
  // a scheduling step, so a race is rare (a late result being recorded).
  try {
    await db.batch(each.flat() as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    return { resolved: each.length, left: more };
  } catch (e) {
    if (!lostDecision(e)) throw e;
  }
  // One of them lost its race and the batch wrote nothing: one batch per
  // match, as far as the run allows; the one that lost waits for the next run.
  // The counts in the notices of the later matches took the lost match's
  // strikes in: a later match that strikes one of its players waits too, and
  // the next run counts again (so nobody hears "2. fekete pont" twice).
  let resolved = 0;
  let waiting = false;
  const stale = new Set<string>();
  for (const [i, statements] of each.entries()) {
    const keys = struckKeys[i]!;
    if (keys.some((k) => stale.has(k))) {
      for (const k of keys) stale.add(k);
      waiting = true;
      continue;
    }
    if (!room()) return { resolved, left: true };
    try {
      await db.batch(statements);
      resolved++;
    } catch (e) {
      if (!lostDecision(e)) throw e;
      for (const k of keys) stale.add(k);
    }
  }
  return { resolved, left: more || waiting };
}

const noOpenNoShow = sql`not exists (select 1 from ${noShowReports} where ${noShowReports.matchId} = ${matches.id} and ${noShowReports.status} = 'open')`;

// The revision guard of the ruling's insert (results.server.ts guardedMatchId).
const lostDecision = (e: unknown) => /NOT NULL constraint failed: match_decisions\.match_id/i.test(`${e} ${(e as Error)?.cause ?? ""}`);

const side = (m: { pairA: number; pairB: number }, s: Side) => (s === "a" ? m.pairA : m.pairB);

type Player = { id: string; email: string; name: string };

// The two players of each pair, by pair id.
async function playersOf(pairIds: number[]): Promise<Map<number, Player[]>> {
  const out = new Map<number, Player[]>();
  const ids = [...new Set(pairIds)];
  if (ids.length === 0) return out;
  const rows = (
    await Promise.all(
      chunks(ids).map((part) => db.select({ id: pairs.id, a: pairs.playerA, b: pairs.playerB }).from(pairs).where(inArray(pairs.id, part))),
    )
  ).flat();
  const people = new Map(
    (
      await Promise.all(
        chunks(rows.flatMap((r) => [r.a, r.b])).map((part) =>
          db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(inArray(users.id, part)),
        ),
      )
    )
      .flat()
      .map((u) => [u.id, { id: u.id, email: u.email, name: u.name ?? "" }]),
  );
  for (const r of rows) out.set(r.id, [r.a, r.b].map((id) => people.get(id)).filter((p): p is Player => !!p));
  return out;
}
