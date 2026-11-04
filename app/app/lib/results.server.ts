import {
  autoAcceptAt,
  autoAcceptDue,
  disputeErrors,
  other,
  resultActions,
  resultState,
  validateScore,
  type MatchScore,
  type ResultEventKind,
  type ResultState,
  type Ruling,
  type Side,
} from "@padel-liga/rules";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { matchDecisions, matchEvents, matches, pairs } from "~/db/schema";
import { queueMatchEmails } from "~/lib/email/outbox.server";
import { matchResultConfirmedMessage, matchResultDisputedMessage, matchResultMessage, type Message } from "~/lib/notifications";
import { notifyPlayers, notifyResultDisputed } from "~/lib/notifications.server";

import { CHANGED, loadMatch, noWithdrawnPair, NOT_FOUND, sideOf, VOIDED, type MatchContext } from "./matches.server";
import { chunks, resultOf, resultsOf, toResultEvent, toRuling, type MatchResults } from "./result-log.server";
import { NOTE_MAX, scoreText } from "./results";
import { logError } from "~/lib/log";

// Recording a result, confirming or disputing it (#28), and the 48-hour
// auto-accept run by the cron. The rules are in packages/rules
// (results.ts, reporting.ts); the texts in results.ts. Every step goes into
// the match log (match_events; the auto-accept into match_decisions) and is
// mirrored on the match (status, outcome) for lists and the standings.

export type ResultInput =
  | { kind: "record"; score: MatchScore }
  | { kind: "confirm" }
  | { kind: "dispute"; score: MatchScore; note: string };

export type ResultStepResult = { ok: true; notice: string } | { ok: false; error: string };

const NOTHING_TO_DO = "Ezt most nem lehet. Frissítsd az oldalt.";

// The match's status and outcome columns for a result state.
export function mirror(state: ResultState): { status: "result_pending" | "disputed" | "final"; outcome: (typeof matches.$inferSelect)["outcome"] } {
  switch (state.status) {
    case "recorded":
      return { status: "result_pending", outcome: null };
    case "disputed":
      return { status: "disputed", outcome: null };
    case "final":
      return { status: "final", outcome: state.outcome };
    case "none":
      throw new Error("no result to mirror");
  }
}

// The insert's match_id, only while the match is still at `revision`:
// otherwise it comes out null, NOT NULL fails and the batch writes nothing
// (the same guard as the scheduling steps in matches.server.ts).
export const guardedMatchId = (matchId: number, revision: number) =>
  sql<number>`(select ${matches.id} from ${matches} where ${matches.id} = ${matchId} and ${matches.revision} = ${revision})`;

export const lostRace = (e: unknown) => /NOT NULL constraint failed: match_(events|decisions)\.match_id/i.test(`${e} ${(e as Error)?.cause ?? ""}`);

/**
 * One result step by a player of either pair (#28): checked against the
 * match format (#9) and the result's state, appended to the log and mirrored
 * on the match in one batch. If someone else's step got in first, nothing is
 * written. Then the pairs are told (spec 13).
 */
export async function resultStep(userId: string, matchId: number, input: ResultInput, now = new Date()): Promise<ResultStepResult> {
  const ctx = await loadMatch(matchId);
  if (!ctx) return { ok: false, error: NOT_FOUND };
  const side = sideOf(ctx, userId);
  if (!side) return { ok: false, error: NOT_FOUND };
  if (ctx.voided) return { ok: false, error: VOIDED };
  const before = await resultOf(ctx.match);
  const can = resultActions(before.state, side);

  let kind: ResultEventKind;
  let score: MatchScore | null = null;
  let note: string | null = null;
  let notice: string;
  switch (input.kind) {
    case "record": {
      if (!can.record) return { ok: false, error: NOTHING_TO_DO };
      const v = validateScore(input.score);
      if (!v.ok) return { ok: false, error: v.errors.map((e) => e.message).join(" ") };
      kind = "result_recorded";
      score = input.score;
      notice = before.state.status === "recorded" ? "Javítottuk. A másik pár megerősíti." : "Rögzítettük. A másik pár megerősíti.";
      break;
    }
    case "confirm":
      if (!can.confirm || before.state.status !== "recorded") return { ok: false, error: NOTHING_TO_DO };
      kind = "result_confirmed";
      notice = "Megerősítetted, az eredmény végleges.";
      break;
    case "dispute": {
      if (!can.dispute || before.state.status !== "recorded") return { ok: false, error: NOTHING_TO_DO };
      const errors = disputeErrors(before.state.score, input.score);
      if (errors.length > 0) return { ok: false, error: errors.join(" ") };
      const n = input.note.trim();
      if (n.length > NOTE_MAX) return { ok: false, error: `A megjegyzés legfeljebb ${NOTE_MAX} karakter legyen.` };
      kind = "result_disputed";
      score = input.score;
      note = n || null;
      notice = "Jeleztük a szervezőnek, ő dönt.";
      break;
    }
  }

  const pairId = side === "a" ? ctx.match.pairA : ctx.match.pairB;
  const after = resultState(
    [...before.events.map((e) => toResultEvent(e, ctx.match.pairA)), { kind, side, at: now, score }],
    before.decisions.map(toRuling),
  );
  const revision = ctx.match.revision;
  try {
    await db.batch([
      db.insert(matchEvents).values({ matchId: guardedMatchId(matchId, revision), pairId, userId, kind, score, note, at: now }),
      db
        .update(matches)
        .set({ revision: revision + 1, ...mirror(after) })
        .where(and(eq(matches.id, matchId), eq(matches.revision, revision))),
    ]);
  } catch (e) {
    if (lostRace(e)) return { ok: false, error: CHANGED };
    throw e;
  }

  await tellPairs(ctx, side, kind, after);
  return { ok: true, notice };
}

const playersOf = (ctx: MatchContext, side: Side) => (side === "a" ? ctx.pairs.a : ctx.pairs.b).players;

// spec 13: a result waiting for confirmation instantly to the other pair
// (email, push, the app); a confirmed result to both pairs in the app and by
// push (a digest item, #31). A dispute is told at once, in the app and by
// push only (#178, D83): to the recording pair and to the league's organizers.
async function tellPairs(ctx: MatchContext, side: Side, kind: ResultEventKind, after: ResultState): Promise<void> {
  const matchId = ctx.match.id;
  try {
    if (kind === "result_recorded" && after.status === "recorded") {
      const them = other(side);
      const score = scoreText(after.score, them);
      await queueMatchEmails(
        playersOf(ctx, them).map((p) => ({
          kind: "match_result" as const,
          toEmail: p.email,
          input: {
            to: p.name,
            opponents: playersOf(ctx, side)
              .map((q) => q.name)
              .join(" és "),
            matchId,
            week: ctx.match.week,
            deadline: ctx.match.deadline,
            venue: null,
            score,
            autoAcceptAt: autoAcceptAt(after)!,
          },
        })),
      );
      await notifyPlayers(
        "match_result",
        playersOf(ctx, them).map((p) => ({ userId: p.id, message: matchResultMessage({ matchId, score }) })),
      );
    }
    if (kind === "result_disputed" && after.status === "disputed") {
      await notifyPlayers(
        "match_result_disputed",
        playersOf(ctx, other(side)).map((p) => ({ userId: p.id, message: matchResultDisputedMessage({ matchId }) })),
      );
      await notifyResultDisputed({
        matchId,
        leagueId: ctx.leagueId,
        leagueSlug: ctx.leagueSlug,
        leagueName: ctx.league,
        week: ctx.match.week,
      });
    }
    if (kind === "result_confirmed" && after.status === "final" && after.outcome.kind === "played") {
      const score = after.outcome.score;
      await notifyPlayers(
        "match_result_confirmed",
        (["a", "b"] as const).flatMap((s) =>
          playersOf(ctx, s).map((p) => ({ userId: p.id, message: matchResultConfirmedMessage({ matchId, score: scoreText(score, s), auto: false }) })),
        ),
      );
    }
  } catch (error) {
    // The step is saved; a failed notice must not undo or hide it.
    logError("result notification failed", { matchId, error });
  }
}

// --- Auto-accept (#28, spec 7) ---------------------------------------------------

// At most this many results per cron run, so a run stays well inside a
// Workers Free invocation's D1 queries (one batch each, plus a few lookups);
// the rest go on the next run.
export const AUTO_ACCEPT_BATCH = 10;

/**
 * Accepts every result that has waited 48 hours without an answer (spec 7),
 * from the cron: a ruling in match_decisions (no user), the match
 * final, and both pairs told in the app and by push (a digest item). A result
 * answered meanwhile is left alone (the revision guard), and so is a match
 * of a pair withdrawn mid-phase (#34), which doesn't count. Returns how many.
 */
export async function autoAcceptResults(now = new Date(), limit = AUTO_ACCEPT_BATCH): Promise<number> {
  const pending = await db
    .select({ id: matches.id, pairA: matches.pairA, pairB: matches.pairB, revision: matches.revision })
    .from(matches)
    .where(and(eq(matches.status, "result_pending"), noWithdrawnPair))
    .orderBy(asc(matches.id));
  if (pending.length === 0) return 0;
  const results = await resultsOf(pending, db.select({ id: matches.id }).from(matches).where(eq(matches.status, "result_pending")));
  const due = pending
    .map((m) => ({ ...m, results: results.get(m.id)! }))
    .filter((m) => m.results && autoAcceptDue(m.results.state, now))
    .slice(0, limit);

  const accepted: (typeof due)[number][] = [];
  for (const m of due) {
    if (m.results.state.status !== "recorded") continue;
    const ruling: Ruling = { kind: "auto_accepted", at: now, outcome: { kind: "played", score: m.results.state.score } };
    try {
      await db.batch([
        db.insert(matchDecisions).values({ matchId: guardedMatchId(m.id, m.revision), kind: "auto_accepted", userId: null, outcome: ruling.outcome, at: now }),
        db
          .update(matches)
          .set({ revision: m.revision + 1, status: "final", outcome: ruling.outcome })
          .where(and(eq(matches.id, m.id), eq(matches.revision, m.revision))),
      ]);
      accepted.push(m);
    } catch (e) {
      if (!lostRace(e)) throw e;
    }
  }
  if (accepted.length > 0) await tellAutoAccepted(accepted, now);
  return accepted.length;
}

// The items carry the run's scheduled time, like every item the cron makes
// (#188, #222).
async function tellAutoAccepted(list: { id: number; pairA: number; pairB: number; results: MatchResults }[], now: Date): Promise<void> {
  try {
    const parts = await Promise.all(
      chunks(list.flatMap((m) => [m.pairA, m.pairB])).map((ids) =>
        db.select({ id: pairs.id, playerA: pairs.playerA, playerB: pairs.playerB }).from(pairs).where(inArray(pairs.id, ids)),
      ),
    );
    const rows = parts.flat();
    const players = new Map(rows.map((r) => [r.id, [r.playerA, r.playerB]]));
    const messages: { userId: string; message: Message }[] = [];
    for (const m of list) {
      if (m.results.state.status !== "recorded") continue;
      const score = m.results.state.score;
      for (const [side, pairId] of [
        ["a", m.pairA],
        ["b", m.pairB],
      ] as const)
        for (const userId of players.get(pairId) ?? [])
          messages.push({ userId, message: matchResultConfirmedMessage({ matchId: m.id, score: scoreText(score, side), auto: true }) });
    }
    // From the cron: the pushes wait for its push step (#183).
    await notifyPlayers("match_result_confirmed", messages, now, true);
  } catch (error) {
    logError("auto-accept notification failed", { error });
  }
}
