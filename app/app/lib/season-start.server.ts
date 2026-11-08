// A league's first season starts by itself once it has the minimum number of
// entries (decision log, 2026-11-06, D124, #335). The rule (the start Monday)
// is packages/rules firstSeasonStart; this module fixes it in D1 and tells
// the entered players.

import { addDays, budapestTime, firstSeasonStart, phaseCalendar } from "@padel-liga/rules";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import { rowSelect } from "~/db/insert-select";
import { leagues, pairs, seasonEntries, seasonPhases, seasons, users } from "~/db/schema";
import { queueSeasonStart } from "~/lib/email/outbox.server";
import { logError, logInfo } from "~/lib/log";
import { seasonStartMessage } from "~/lib/notifications";
import { notifyPlayers } from "~/lib/notifications.server";

import { auditIfChanged } from "./audit.server";
import type { Season } from "./seasons";

// The statements that fix a waiting first season's start, for the D1 batch
// (one transaction) whose write may bring its entries to the league's
// minimum: an entry, or a lower minimum. The first one sets the start only
// if, at that point of the batch, the season still waits and its entries
// (counted there, so two entries at once can't both miss it or both fix it)
// reach the minimum; the phase rows follow only if it did. The start is the
// rule's for a minimum reached `now` (the moment of this write).
export function fixStartStatements(season: Pick<Season, "id" | "breaks">, now: Date) {
  const minimum = sql`(select ${leagues.minEntries} from ${leagues} where ${leagues.id} = ${seasons.leagueId})`;
  // Any count at the minimum gives the same day: the batch checks the count.
  const start = firstSeasonStart({ entries: 1, minimum: 1, at: now, breaks: season.breaks })!;
  const phases = phaseCalendar(start, season.breaks);
  const seconds = Math.floor(now.getTime() / 1000);
  // Registration in the old sense (the stuck reminders' rush, Kezdőlap)
  // ends the night before round 1; entries stay open as in any season.
  const closes = budapestTime(addDays(phases[0]!.start, -1), 23, 59);
  const fix = db
    .update(seasons)
    .set({ startFixedAt: now, firstPhaseStart: start, registrationClosesAt: closes, updatedAt: now })
    .where(
      and(
        eq(seasons.id, season.id),
        eq(seasons.startsAtMinimum, true),
        isNull(seasons.startFixedAt),
        sql`(select count(*) from ${seasonEntries} where ${seasonEntries.seasonId} = ${season.id} and ${seasonEntries.status} = 'approved') >= ${minimum}`,
      ),
    )
    .returning({ id: seasons.id });
  const phaseRows = phases.map((p) =>
    db.insert(seasonPhases).select(
      rowSelect(
        seasonPhases,
        {
          seasonId: sql`${season.id}`,
          number: sql`${p.number}`,
          startsAt: sql`${Math.floor(p.startsAt.getTime() / 1000)}`,
          deadline: sql`${Math.floor(p.deadline.getTime() / 1000)}`,
        },
        sql`where exists (select 1 from ${seasons} where ${seasons.id} = ${season.id} and ${seasons.startFixedAt} = ${seconds} and ${seasons.firstPhaseStart} = ${start})
          and not exists (select 1 from ${seasonPhases} where ${seasonPhases.seasonId} = ${season.id} and ${seasonPhases.number} = ${p.number})`,
      ),
    ),
  );
  return { fix, phases: phaseRows as BatchItem<"sqlite">[], startsAt: phases[0]!.startsAt };
}

// After a batch that fixed the start: one email per entered player and the
// notice in the app (and by push). Deleted accounts get nothing. A failure
// here is logged, never undoes the entry.
export async function announceSeasonStart(seasonId: number, startsAt: Date): Promise<void> {
  logInfo("season start fixed", { seasonId, startsAt: startsAt.toISOString() });
  try {
    const [season] = await db
      .select({ name: seasons.name, league: leagues.name })
      .from(seasons)
      .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
      .where(eq(seasons.id, seasonId));
    if (!season) return;
    const players = await db
      .selectDistinct({ id: users.id, email: users.email, name: users.name })
      .from(seasonEntries)
      .innerJoin(pairs, eq(pairs.id, seasonEntries.pairId))
      .innerJoin(users, or(eq(users.id, pairs.playerA), eq(users.id, pairs.playerB)))
      .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.status, "approved"), isNull(users.deletedAt)));
    const input = { league: season.league, season: season.name, start: startsAt };
    await queueSeasonStart(players.map((p) => ({ toEmail: p.email, input: { ...input, to: p.name || "Játékos" } })));
    // The pushes wait for the cron (queuePush, D150, as groups.server.ts),
    // so they leave the invocation's subrequests to the emails.
    const message = seasonStartMessage(input);
    await notifyPlayers(
      "season_start",
      players.map((p) => ({ userId: p.id, message })),
      undefined,
      true,
    );
  } catch (error) {
    logError("season start notice failed", { seasonId, error });
  }
}

// The league's first season while it waits for its minimum, if it does.
export async function waitingSeasonOf(leagueId: number): Promise<{ id: number; breaks: Season["breaks"] } | undefined> {
  const [row] = await db
    .select({ id: seasons.id, breaks: seasons.breaks })
    .from(seasons)
    .where(and(eq(seasons.leagueId, leagueId), eq(seasons.startsAtMinimum, true), isNull(seasons.startFixedAt)));
  return row;
}

// The organizer changes the minimum (D124): only while the league's first
// season waits, checked inside the update, and audited. A minimum the entries
// already reach fixes the start in the same batch, as an entry would.
export async function setMinEntries(
  actor: { id: string },
  leagueId: number,
  minEntries: number,
  now = new Date(),
): Promise<{ ok: true; started: boolean } | { ok: false; error: string }> {
  const waiting = await waitingSeasonOf(leagueId);
  if (!waiting) return { ok: false, error: MIN_ENTRIES_LOCKED };
  const { fix, phases, startsAt } = fixStartStatements(waiting, now);
  const [updated, , fixed] = await db.batch([
    db
      .update(leagues)
      .set({ minEntries })
      .where(
        and(
          eq(leagues.id, leagueId),
          sql`exists (select 1 from ${seasons} where ${seasons.id} = ${waiting.id} and ${seasons.startFixedAt} is null)`,
        ),
      )
      .returning({ id: leagues.id }),
    auditIfChanged({ actorId: actor.id, action: "league.min_entries", target: `league:${leagueId}`, detail: String(minEntries), leagueId }),
    fix,
    ...phases,
  ]);
  if (updated.length === 0) return { ok: false, error: MIN_ENTRIES_LOCKED };
  if (fixed.length > 0) await announceSeasonStart(waiting.id, startsAt);
  return { ok: true, started: fixed.length > 0 };
}

export const MIN_ENTRIES_LOCKED = "A minimum csak addig módosítható, amíg az első szezon a nevezésekre vár.";
