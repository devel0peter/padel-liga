import { and, asc, gte, lte, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { pushStatsDaily, users } from "~/db/schema";

import { channelKey } from "./notifications";
import { budapestDay, type Period } from "./traffic";

// How many players have push on: the Admin's Forgalom page shows today's
// count and one row per day (push_stats_daily), written by the cron so a
// later nudge toward push shows in the trend. Counts only, no names.

export type PushStats = { players: number; pushUsers: number; devices: number };
export type PushDay = PushStats & { day: string };

// Players: consented, not deleted, not Admin or Szervező (their own use is
// left out, as on the rest of the page). Push users: players with at least
// one subscribed device who didn't switch the push channel off.
const PLAYERS = sql`select u.id from users u
  where u.deleted_at is null and u.consent_at is not null and u.platform_role = 'player'
    and not exists (select 1 from league_admins la where la.user_id = u.id)`;
const PUSH_ON = sql`ps.user_id in (${PLAYERS})
  and not exists (select 1 from notification_opt_outs o where o.user_id = ps.user_id and o.kind = ${channelKey("push")})`;
const PUSH_USERS = sql<number>`(select count(distinct ps.user_id) from push_subscriptions ps where ${PUSH_ON})`;
const DEVICES = sql<number>`(select count(*) from push_subscriptions ps where ${PUSH_ON})`;

export async function currentPushStats(): Promise<PushStats> {
  // The builder, not db.all: the row shape is then the same on D1 and in tests.
  const [row] = await db
    .select({ players: sql<number>`count(*)`, pushUsers: PUSH_USERS, devices: DEVICES })
    .from(users)
    .where(sql`${users.id} in (${PLAYERS})`);
  return row;
}

// One query: today's (Budapest) row, overwritten by each run of the day.
export const PUSH_STATS_QUERIES = 1;

export async function recordPushStats(now: Date): Promise<void> {
  const day = budapestDay(now);
  await db.run(sql`insert into push_stats_daily (day, players, push_users, devices)
    select ${day}, count(*), ${PUSH_USERS}, ${DEVICES} from users where users.id in (${PLAYERS})
    on conflict (day) do update set players = excluded.players, push_users = excluded.push_users, devices = excluded.devices`);
}

export async function listPushDays({ from, to }: Period): Promise<PushDay[]> {
  return db
    .select()
    .from(pushStatsDaily)
    .where(and(gte(pushStatsDaily.day, from), lte(pushStatsDaily.day, to)))
    .orderBy(asc(pushStatsDaily.day));
}
