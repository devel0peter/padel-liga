import { addDays, budapestDay, budapestTime } from "@padel-liga/rules";
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { groupPairs, groups, jobRuns, leagueAdmins, leagueSignupEvents, leagues, notificationOptOuts, pairs, seasonPhases, seasons, users } from "~/db/schema";
import { queueNewSignupsDaily } from "~/lib/email/outbox.server";
import { memberOf } from "~/lib/league-members.server";
import { budapestHour } from "~/lib/match-reminders";
import { channelKey, NEW_SIGNUPS_DAILY_EMAIL_KEY, newSignupsDailyEmailEnabled } from "~/lib/notifications";
import type { RunBudget, Usage } from "~/lib/run-usage";

// Morning summary email for organizers on days their league had new sign-ups (#383).
// Runs once per Budapest day (at or after 07:00), one email per active league,
// guarded by job_runs so retries never mail the same day & league twice.

const MORNING_HOUR = 7;
export const NEW_SIGNUPS_DAILY_MIN: Usage = { queries: 8, calls: 0 };

const jobKey = (leagueId: number, day: string) => `new-signups-daily:${leagueId}:${day}`;

// Current waiting counts for a league: active pairs not in a published running
// group, and consented non-deleted league members without an active pair.
async function waitingTotals(leagueId: number, now: Date): Promise<{ pairs: number; singles: number }> {
  const [runningPairs, activePairs, singles] = await Promise.all([
    db
      .selectDistinct({ pairId: groupPairs.pairId })
      .from(groupPairs)
      .innerJoin(groups, eq(groups.id, groupPairs.groupId))
      .innerJoin(seasons, eq(seasons.id, groups.seasonId))
      .innerJoin(seasonPhases, and(eq(seasonPhases.seasonId, groups.seasonId), eq(seasonPhases.number, groups.phase)))
      .where(
        and(
          eq(seasons.leagueId, leagueId),
          isNotNull(groups.publishedAt),
          isNull(groupPairs.withdrawnAt),
          lte(seasonPhases.startsAt, now),
          gte(seasonPhases.deadline, now),
        ),
      ),
    db
      .select({ id: pairs.id })
      .from(pairs)
      .where(and(eq(pairs.leagueId, leagueId), eq(pairs.status, "active"))),
    db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          isNotNull(users.consentAt),
          isNull(users.deletedAt),
          memberOf(leagueId, users.id),
          sql`not exists (select 1 from ${pairs} where ${pairs.leagueId} = ${leagueId} and ${pairs.status} = 'active' and (${pairs.playerA} = ${users.id} or ${pairs.playerB} = ${users.id}))`,
        ),
      ),
  ]);
  const inRound = new Set(runningPairs.map((r) => r.pairId));
  return {
    pairs: activePairs.filter((p) => !inRound.has(p.id)).length,
    singles: singles.length,
  };
}

async function eligibleOrganizerEmails(leagueId: number): Promise<string[]> {
  const [organizers, admins] = await Promise.all([
    db
      .select({ id: users.id, email: users.email })
      .from(leagueAdmins)
      .innerJoin(users, eq(users.id, leagueAdmins.userId))
      .where(and(eq(leagueAdmins.leagueId, leagueId), isNull(users.deletedAt))),
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.platformRole, "superadmin"), isNull(users.deletedAt))),
  ]);
  const byId = new Map<string, string>();
  for (const r of [...admins, ...organizers]) byId.set(r.id, r.email);
  const ids = [...byId.keys()];
  if (ids.length === 0) return [];
  const optOuts = await db
    .select({ userId: notificationOptOuts.userId, kind: notificationOptOuts.kind })
    .from(notificationOptOuts)
    .where(and(inArray(notificationOptOuts.userId, ids), inArray(notificationOptOuts.kind, [channelKey("email"), NEW_SIGNUPS_DAILY_EMAIL_KEY])));
  const disabled = new Map<string, Set<string>>();
  for (const r of optOuts) (disabled.get(r.userId) ?? disabled.set(r.userId, new Set()).get(r.userId)!).add(r.kind);
  return ids.filter((id) => newSignupsDailyEmailEnabled(disabled.get(id) ?? new Set())).map((id) => byId.get(id)!);
}

export async function queueNewSignupsDailyEmails(now: Date, budget?: { run: RunBudget; keep: Usage }): Promise<string | null> {
  if (budapestHour(now) < MORNING_HOUR) return null;
  const fits = (queries: number) => !budget || budget.run.fits({ queries: budget.keep.queries + queries, calls: budget.keep.calls });
  if (!fits(2)) return "new signups daily email: no room in this run; left for the next one";

  const today = budapestDay(now);
  const yesterday = addDays(today, -1);
  const start = budapestTime(yesterday, 0, 0);
  const end = budapestTime(today, 0, 0);

  const events = await db
    .select({
      leagueId: leagueSignupEvents.leagueId,
      kind: leagueSignupEvents.kind,
      joinsPhase: leagueSignupEvents.joinsPhase,
    })
    .from(leagueSignupEvents)
    .where(and(gte(leagueSignupEvents.createdAt, start), lt(leagueSignupEvents.createdAt, end)));
  if (events.length === 0) return null;

  const byLeague = new Map<number, typeof events>();
  for (const e of events) (byLeague.get(e.leagueId) ?? byLeague.set(e.leagueId, []).get(e.leagueId)!).push(e);
  const leagueIds = [...byLeague.keys()];

  const keys = leagueIds.map((id) => jobKey(id, yesterday));
  const [doneRows, leagueRows] = await Promise.all([
    db.select({ key: jobRuns.key }).from(jobRuns).where(inArray(jobRuns.key, keys)),
    db.select({ id: leagues.id, name: leagues.name, slug: leagues.slug }).from(leagues).where(inArray(leagues.id, leagueIds)),
  ]);
  const done = new Set(doneRows.map((r) => r.key));
  const leagueById = new Map(leagueRows.map((l) => [l.id, l]));

  let queued = 0;
  for (const leagueId of leagueIds) {
    const key = jobKey(leagueId, yesterday);
    if (done.has(key)) continue;
    if (!fits(NEW_SIGNUPS_DAILY_MIN.queries)) return `new signups daily email: queued ${queued}; more left for the next run`;
    const league = leagueById.get(leagueId);
    if (!league) continue;

    // Claim the day/league first so retries never double-send.
    const claimed = await db.insert(jobRuns).values({ key, doneAt: now }).onConflictDoNothing().returning({ key: jobRuns.key });
    if (claimed.length === 0) continue;

    const list = byLeague.get(leagueId)!;
    const phaseCounts = new Map<number | null, number>();
    let playerJoined = 0;
    let pairFormed = 0;
    let partnerSearch = 0;
    for (const e of list) {
      if (e.kind === "player_joined") playerJoined++;
      else if (e.kind === "pair_formed") pairFormed++;
      else if (e.kind === "partner_search") partnerSearch++;
      else if (e.kind === "pair_entered") phaseCounts.set(e.joinsPhase, (phaseCounts.get(e.joinsPhase) ?? 0) + 1);
    }
    const pairEnteredByPhase = [...phaseCounts.entries()]
      .sort(([a], [b]) => (a ?? 99) - (b ?? 99))
      .map(([phase, count]) => ({ phase, count }));

    const [recipients, waiting] = await Promise.all([eligibleOrganizerEmails(leagueId), waitingTotals(leagueId, now)]);
    if (recipients.length > 0) {
      queued += await queueNewSignupsDaily(
        recipients,
        {
          leagueName: league.name,
          leagueSlug: league.slug,
          counts: { playerJoined, pairFormed, pairEnteredByPhase, partnerSearch },
          waiting,
        },
        leagueId,
      );
    }
  }
  return queued > 0 ? `queued ${queued} daily sign-up summaries` : null;
}
