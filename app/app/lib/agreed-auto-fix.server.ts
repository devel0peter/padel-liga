import { schedulingState, unloggedAutoFix, type AutoFix } from "@padel-liga/rules";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { groups, matchEvents, matches, pairs, seasons } from "~/db/schema";
import { auditEntry } from "~/lib/audit.server";
import { logError } from "~/lib/log";
import type { RunBudget, Usage } from "~/lib/run-usage";
import { matchScheduledMessage, type Message } from "~/lib/notifications";
import { notifyPlayers } from "~/lib/notifications.server";

import { autoFixEvent, autoFixRow, eventsOf, noWithdrawnPair, toSchedulingEvent } from "./matches.server";
import { formatSlot } from "./matches";

// An agreed time the other pair doesn't answer becomes fixed by itself
// (D148, packages/rules scheduling.ts agreedFixAt). Every reader already
// works it out from the log; this cron step writes it down, as the 48-hour
// result auto-accept does (results.server.ts): the log line
// ("agreed_auto_fixed", no player), the match's status, time and club
// mirrored, an audit entry for the system, and both pairs told in the app
// and by push. A player's step on the match before the cron got there writes
// the same line itself (matches.server.ts matchStep).

// At most this many matches per run (one batch each, plus a few lookups),
// like AUTO_ACCEPT_BATCH; the rest go on the next run.
export const AUTO_FIX_BATCH = 10;
// The notices at the end: the players, then the notifications.
const NOTICE_QUERIES = 2;

const IDS_PER_QUERY = 90;

/**
 * Writes every agreed time that became fixed by itself by `now` (up to
 * `limit`); returns how many and whether any was left for the next run.
 * `budget`: the cron's run, keeping `keep` for the steps after this one; the
 * lookups and each match go only while they fit.
 */
export async function autoFixAgreedTimes(
  now = new Date(),
  budget?: { run: RunBudget; keep: Usage },
  limit = AUTO_FIX_BATCH,
): Promise<{ fixed: number; left: boolean }> {
  const room = (queries: number) => !budget || budget.run.fits({ queries: budget.keep.queries + queries, calls: budget.keep.calls });
  if (!room(1)) return { fixed: 0, left: true };
  // An open match whose log has an agreed time: the only ones that can be
  // waiting for their line. A result moves the match on (status), and a
  // withdrawn pair's match doesn't count (#34).
  const open = await db
    .select({ id: matches.id, pairA: matches.pairA, pairB: matches.pairB, revision: matches.revision })
    .from(matches)
    .where(
      and(
        eq(matches.status, "open"),
        noWithdrawnPair,
        sql`exists (select 1 from ${matchEvents} where ${matchEvents.matchId} = ${matches.id} and ${matchEvents.kind} = 'agreed_time')`,
      ),
    )
    .orderBy(asc(matches.id));
  if (open.length === 0) return { fixed: 0, left: false };
  let left = false;
  const due: { m: (typeof open)[number]; fix: AutoFix; after: ReturnType<typeof schedulingState> }[] = [];
  for (let i = 0; i < open.length && due.length < limit; i += IDS_PER_QUERY) {
    if (!room(1 + NOTICE_QUERIES + 1)) {
      left = true;
      break;
    }
    const chunk = open.slice(i, i + IDS_PER_QUERY);
    const events = await eventsOf(chunk.map((m) => m.id));
    for (const m of chunk) {
      const logged = (events.get(m.id) ?? []).map((e) => toSchedulingEvent(e, m.pairA));
      const fix = unloggedAutoFix(logged, now);
      if (!fix) continue;
      if (due.length < limit) due.push({ m, fix, after: schedulingState([...logged, autoFixEvent(fix)], now) });
      else left = true;
    }
  }

  const fixed: typeof due = [];
  for (const d of due) {
    const { m, fix, after } = d;
    if (after.status !== "scheduled") continue;
    // One batch, and room for the notices after the last.
    if (!room(1 + NOTICE_QUERIES)) {
      left = true;
      break;
    }
    try {
      await db.batch([
        // Only while the match is still at the revision read above: otherwise
        // match_id comes out null, NOT NULL fails and nothing is written.
        db
          .insert(matchEvents)
          .values(autoFixRow({ match: m }, fix, sql<number>`(select ${matches.id} from ${matches} where ${matches.id} = ${m.id} and ${matches.revision} = ${m.revision})`)),
        db
          .update(matches)
          .set({ revision: m.revision + 1, status: "scheduled", scheduledAt: after.slot, clubId: after.clubId })
          .where(and(eq(matches.id, m.id), eq(matches.revision, m.revision))),
        // The system's step (#225): no actor, shown as "Rendszer".
        auditEntry({
          actorId: null,
          action: "match.agreed_auto_fix",
          target: `match:${m.id}`,
          detail: formatSlot(fix.slot),
          at: now,
          leagueId: sql`(select ${seasons.leagueId} from ${matches} join ${groups} on ${groups.id} = ${matches.groupId}
            join ${seasons} on ${seasons.id} = ${groups.seasonId} where ${matches.id} = ${m.id})`,
        }),
      ]);
      fixed.push(d);
    } catch (e) {
      // A player's step got in first; the next run looks again.
      if (!/NOT NULL constraint failed: match_events\.match_id/i.test(`${e} ${(e as Error)?.cause ?? ""}`)) throw e;
    }
  }
  if (fixed.length > 0) await tellFixed(fixed, now);
  return { fixed: fixed.length, left };
}

// Both pairs, in the app and by push (a digest item, like the auto-accept);
// the pushes wait for the cron's push step (#183), at the run's time.
async function tellFixed(list: { m: { id: number; pairA: number; pairB: number }; fix: AutoFix }[], now: Date): Promise<void> {
  try {
    const ids = [...new Set(list.flatMap(({ m }) => [m.pairA, m.pairB]))];
    const rows = await db.select({ id: pairs.id, playerA: pairs.playerA, playerB: pairs.playerB }).from(pairs).where(inArray(pairs.id, ids));
    const players = new Map(rows.map((r) => [r.id, [r.playerA, r.playerB]]));
    const messages: { userId: string; message: Message }[] = [];
    for (const { m, fix } of list)
      for (const pairId of [m.pairA, m.pairB])
        for (const userId of players.get(pairId) ?? [])
          messages.push({ userId, message: matchScheduledMessage({ matchId: m.id, slot: fix.slot, confirmed: false, auto: true }) });
    await notifyPlayers("match_scheduled", messages, now, true);
  } catch (error) {
    logError("agreed auto-fix notification failed", { error });
  }
}
