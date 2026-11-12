import { type DeadlineDecision, projectDeadline } from "@padel-liga/rules";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "~/db/client.server";
import { matches, noShowReports } from "~/db/schema";

import { type GroupPair, phaseGroups } from "./groups.server";
import { eventsOf, toSchedulingEvent } from "./matches.server";
import { chunks } from "./result-log.server";
import { liveCounts } from "./strikes.server";

// "Ha most lenne a határidő" (#362, D162): what the deadline resolution
// (deadline.server.ts) would do with a published phase's matches if it ran
// now, with the activity recorded so far, and the strikes it would give.
// The same pure rule as the real run (packages/rules deadlineDecision,
// applyStrikes, through projectDeadline). Read only: it stores, sends and
// audits nothing.

export type PhaseProjection = {
  // The counting matches (not a withdrawn pair's), by id, with the decision.
  matches: { id: number; groupId: number; pairA: number; pairB: number; decision: DeadlineDecision }[];
  // The phase's pairs by id (withdrawn ones too), for the names.
  pairs: Map<number, GroupPair>;
  // Each counting pair's player: live strikes this season now and after the projection.
  strikes: Map<string, { now: number; after: number }>;
  // Players the projection would bring to their 2nd strike (the warning email).
  warned: { pairId: number; userId: string }[];
  // Pairs with a player at 3 or more after the projection: they would leave at the round switch.
  leaving: number[];
};

/**
 * The deadline projection of a season's published phase, or null when the
 * phase has no published groups. Bounded reads: the groups (2), the matches,
 * the open matches' logs, the waiting no-show reports and the strike counts
 * (each in chunks of 90 ids), never a query per match.
 */
export async function phaseProjection(seasonId: number, phase: number): Promise<PhaseProjection | null> {
  const stored = await phaseGroups(seasonId, phase);
  if (stored.length === 0 || stored.some((g) => !g.publishedAt)) return null;
  const rows = (
    await Promise.all(
      chunks(stored.map((g) => g.id)).map((ids) =>
        db
          .select({ id: matches.id, groupId: matches.groupId, pairA: matches.pairA, pairB: matches.pairB, status: matches.status, deadline: matches.deadline })
          .from(matches)
          .where(inArray(matches.groupId, ids)),
      ),
    )
  ).flat();
  const withdrawn = new Set(stored.flatMap((g) => g.pairs.filter((p) => p.withdrawn).map((p) => p.pairId)));
  const counted = rows.filter((m) => !withdrawn.has(m.pairA) && !withdrawn.has(m.pairB));
  const open = counted.filter((m) => m.status === "open" || m.status === "scheduled").map((m) => m.id);
  const pairs = stored.flatMap((g) => g.pairs.filter((p) => !p.withdrawn));
  const [logs, reported, counts] = await Promise.all([
    Promise.all(chunks(open).map(eventsOf)),
    Promise.all(
      chunks(open).map((ids) =>
        db
          .selectDistinct({ matchId: noShowReports.matchId })
          .from(noShowReports)
          .where(and(eq(noShowReports.status, "open"), inArray(noShowReports.matchId, ids))),
      ),
    ),
    liveCounts(
      pairs.flatMap((p) => p.players.map((u) => u.id)),
      [seasonId],
    ),
  ]);
  const events = new Map(logs.flatMap((m) => [...m]));
  const noShow = new Set(reported.flat().map((r) => r.matchId));
  const projection = projectDeadline(
    counted.map((m) => ({
      id: m.id,
      pairA: m.pairA,
      pairB: m.pairB,
      status: m.status,
      withdrawn: false,
      openNoShow: noShow.has(m.id),
      events: (events.get(m.id) ?? []).map((e) => toSchedulingEvent(e, m.pairA)),
      deadline: m.deadline,
    })),
    pairs.map((p) => ({ id: p.pairId, players: p.players.map((u) => u.id) })),
    new Map(pairs.flatMap((p) => p.players.map((u) => [u.id, counts.get(`${seasonId}:${u.id}`) ?? 0] as const))),
  );
  return {
    matches: counted
      .sort((x, y) => x.id - y.id)
      .map((m) => ({ id: m.id, groupId: m.groupId, pairA: m.pairA, pairB: m.pairB, decision: projection.decisions.get(m.id)! })),
    pairs: new Map(stored.flatMap((g) => g.pairs.map((p) => [p.pairId, p]))),
    strikes: projection.strikes,
    warned: projection.warned,
    leaving: projection.leaving,
  };
}
