import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import { groupPairs, groups, leagues, matchReminders, matches, pairs, seasonPhases, seasons, users } from "~/db/schema";
import { queueRoundExtended } from "~/lib/email/outbox.server";
import { logError, logInfo } from "~/lib/log";
import { roundExtendedMessage } from "~/lib/notifications";
import { notifyPlayers } from "~/lib/notifications.server";

import { auditIfChanged } from "./audit.server";
import { CHANGED, extendableRound, extensionDetail, NOT_EXTENDABLE, parseNewDeadline, planExtension } from "./round-extension";
import { getSeason } from "./seasons.server";

// The organizer extends the running round (#356, D151): the round's deadline
// (season_phases and every match of the round) moves to a later Sunday and
// every later round moves with it (packages/rules extendRound), in one D1
// batch with the audit entry (phase.extend). Nothing else about the matches
// changes, so the deadline resolution, the round switch, the reminders and
// every page read the new date from where they always read it. The
// "3 days before the deadline" reminder already sent for an unplayed match
// is forgotten, so it comes again before the new deadline. Then every player
// of the round (withdrawn pairs and deleted accounts left out) gets a notice
// in the app, a push (queued for the cron, D150) and one email (sent after
// the response, D150).

const sec = (d: Date) => Math.floor(d.getTime() / 1000);

type Result = { ok: true } | { ok: false; error: string };

/**
 * Extends round `phase` of season `seasonId` to the Sunday in `value` (a
 * "YYYY-MM-DD" from the form), as `actor`. Only the published round whose
 * deadline hasn't passed, and only to one of the offered Sundays; checked
 * again inside the batch, so a second extension from a stale page changes
 * nothing.
 */
export async function extendRunningRound(
  actor: { id: string },
  seasonId: number,
  phase: number,
  value: FormDataEntryValue | null,
  now = new Date(),
): Promise<Result> {
  const season = await getSeason(seasonId);
  if (!season) return { ok: false, error: NOT_EXTENDABLE };
  const published = await db
    .selectDistinct({ phase: groups.phase })
    .from(groups)
    .where(and(eq(groups.seasonId, seasonId), isNotNull(groups.publishedAt)));
  const round = extendableRound(
    season.phases,
    published.map((p) => p.phase),
    now,
  );
  if (!round || round.number !== phase) return { ok: false, error: NOT_EXTENDABLE };
  const parsed = parseNewDeadline(value, round.deadline);
  if (!parsed.ok) return parsed;
  const plan = planExtension(season, phase, parsed.day);
  const own = plan.phases.find((p) => p.number === phase)!;

  const roundMatches = db
    .select({ id: matches.id })
    .from(matches)
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase)));
  // The statements after the first run only if the round now has the new
  // deadline (this extension, or the same one a moment ago: they write the
  // same values).
  const ours = sql`exists (select 1 from ${seasonPhases} where ${seasonPhases.seasonId} = ${seasonId} and ${seasonPhases.number} = ${phase} and ${seasonPhases.deadline} = ${sec(own.deadline)})`;
  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    db
      .update(seasonPhases)
      .set({ deadline: own.deadline })
      .where(
        and(
          eq(seasonPhases.seasonId, seasonId),
          eq(seasonPhases.number, phase),
          // Unchanged since the checks above, and not passed.
          eq(seasonPhases.deadline, round.deadline),
          sql`${seasonPhases.deadline} >= ${sec(now)}`,
          sql`exists (select 1 from ${groups} where ${groups.seasonId} = ${seasonId} and ${groups.phase} = ${phase} and ${groups.publishedAt} is not null)`,
        ),
      )
      .returning({ number: seasonPhases.number }),
    auditIfChanged({
      actorId: actor.id,
      action: "phase.extend",
      target: `season:${seasonId}`,
      detail: extensionDetail(phase, round.deadline, parsed.day),
      leagueId: season.leagueId,
    }),
    db
      .update(matches)
      .set({ deadline: own.deadline })
      .where(and(inArray(matches.id, roundMatches), ours)),
    // "3 days before the deadline" again before the new one, for a match
    // still unplayed.
    db
      .delete(matchReminders)
      .where(
        and(
          eq(matchReminders.kind, "match_deadline_soon"),
          inArray(
            matchReminders.matchId,
            db
              .select({ id: matches.id })
              .from(matches)
              .innerJoin(groups, eq(groups.id, matches.groupId))
              .where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase), inArray(matches.status, ["open", "scheduled"]))),
          ),
          ours,
        ),
      ),
    ...plan.later.map((p) =>
      db
        .update(seasonPhases)
        .set({ startsAt: p.startsAt, deadline: p.deadline })
        .where(and(eq(seasonPhases.seasonId, seasonId), eq(seasonPhases.number, p.number), ours)),
    ),
  ];
  const [claimed] = (await db.batch(statements)) as [{ number: number }[], ...unknown[]];
  if (claimed.length === 0) return { ok: false, error: now > round.deadline ? NOT_EXTENDABLE : CHANGED };

  logInfo("round extended", { seasonId, phase, deadline: own.deadline.toISOString(), later: plan.later.length });
  await announceExtension(seasonId, phase, own.deadline, plan.later[0]?.startsAt ?? null);
  return { ok: true };
}

// Every player of the round: the pairs of its published groups, a pair
// withdrawn mid-phase (D87) and deleted accounts left out. A failure here is
// logged and never undoes the extension.
async function announceExtension(seasonId: number, phase: number, deadline: Date, nextStart: Date | null): Promise<void> {
  try {
    const [[season], players] = await Promise.all([
      db
        .select({ name: seasons.name, league: leagues.name })
        .from(seasons)
        .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
        .where(eq(seasons.id, seasonId)),
      db
        .selectDistinct({ id: users.id, email: users.email, name: users.name })
        .from(groupPairs)
        .innerJoin(groups, eq(groups.id, groupPairs.groupId))
        .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
        .innerJoin(users, or(eq(users.id, pairs.playerA), eq(users.id, pairs.playerB)))
        .where(
          and(
            eq(groups.seasonId, seasonId),
            eq(groups.phase, phase),
            isNotNull(groups.publishedAt),
            isNull(groupPairs.withdrawnAt),
            isNull(users.deletedAt),
          ),
        ),
    ]);
    if (!season) return;
    const input = { league: season.league, season: season.name, phase, deadline };
    await queueRoundExtended(players.map((p) => ({ toEmail: p.email, input: { ...input, to: p.name || "Játékos", nextStart } })));
    // The pushes wait for the cron (D150, D158), so they leave the
    // invocation's subrequests to the emails.
    const message = roundExtendedMessage(input);
    await notifyPlayers(
      "round_extended",
      players.map((p) => ({ userId: p.id, message })),
    );
  } catch (error) {
    logError("round extension notice failed", { seasonId, phase, error });
  }
}
