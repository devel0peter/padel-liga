import { RESULT_EVENT_KINDS, resultState, type MatchOutcome, type MatchScore, type ResultEvent, type ResultEventKind, type ResultState, type Ruling, type Side } from "@padel-liga/rules";
import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { matchDecisions, matchEvents, users } from "~/db/schema";

// A match's result steps (#28) and rulings (#29) from D1: the state they add
// up to (packages/rules resultState) and their log lines. Read-only; the
// steps are written by results.server.ts. Scheduling steps are read by
// matches.server.ts.

export type StoredResultEvent = {
  id: number;
  pairId: number;
  userName: string | null;
  kind: ResultEventKind;
  score: MatchScore | null;
  note: string | null;
  at: Date;
};

export type StoredDecision = {
  id: number;
  kind: "auto_accepted" | "organizer";
  userName: string | null;
  outcome: MatchOutcome;
  reason: string | null;
  at: Date;
};

export type MatchResults = { state: ResultState; events: StoredResultEvent[]; decisions: StoredDecision[] };

const EMPTY: MatchResults = { state: { status: "none" }, events: [], decisions: [] };

const decider = alias(users, "decider");

/** The result of each match, by id; a match without steps has status "none". */
export async function resultsOf(list: readonly { id: number; pairA: number }[]): Promise<Map<number, MatchResults>> {
  const out = new Map<number, MatchResults>();
  const ids = list.map((m) => m.id);
  if (ids.length === 0) return out;
  const [events, decisions] = await Promise.all([
    db
      .select({
        id: matchEvents.id,
        matchId: matchEvents.matchId,
        pairId: matchEvents.pairId,
        userName: users.name,
        kind: matchEvents.kind,
        score: matchEvents.score,
        note: matchEvents.note,
        at: matchEvents.at,
      })
      .from(matchEvents)
      .leftJoin(users, eq(users.id, matchEvents.userId))
      .where(and(inArray(matchEvents.matchId, ids), inArray(matchEvents.kind, [...RESULT_EVENT_KINDS])))
      .orderBy(asc(matchEvents.id)),
    db
      .select({
        id: matchDecisions.id,
        matchId: matchDecisions.matchId,
        kind: matchDecisions.kind,
        userName: decider.name,
        outcome: matchDecisions.outcome,
        reason: matchDecisions.reason,
        at: matchDecisions.at,
      })
      .from(matchDecisions)
      .leftJoin(decider, eq(decider.id, matchDecisions.userId))
      .where(inArray(matchDecisions.matchId, ids))
      .orderBy(asc(matchDecisions.id)),
  ]);
  for (const m of list) {
    const own = events
      .filter((e) => e.matchId === m.id)
      .map(({ matchId: _, kind, ...e }) => ({ ...e, kind: kind as ResultEventKind }));
    const rulings = decisions.filter((d) => d.matchId === m.id).map(({ matchId: _, ...d }) => d);
    out.set(m.id, {
      state: resultState(
        own.map((e) => toResultEvent(e, m.pairA)),
        rulings.map(toRuling),
      ),
      events: own,
      decisions: rulings,
    });
  }
  return out;
}

export async function resultOf(match: { id: number; pairA: number }): Promise<MatchResults> {
  return (await resultsOf([match])).get(match.id) ?? EMPTY;
}

export const toResultEvent = (e: StoredResultEvent, pairA: number): ResultEvent => ({
  kind: e.kind,
  side: (e.pairId === pairA ? "a" : "b") as Side,
  at: e.at,
  score: e.score,
});

export const toRuling = (d: StoredDecision): Ruling => ({ kind: d.kind, at: d.at, outcome: d.outcome });
