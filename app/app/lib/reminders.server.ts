import { and, count, eq, isNotNull, max, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import { cities, leagues, pairLinks, pairs, partnerSearches, seasonEntries, stuckReminders, users } from "~/db/schema";
import { randomToken } from "~/lib/auth/tokens";
import { hideAddresses } from "~/lib/email/outbox-view";
import { emailSwitchedOff, stuckReminderInserts, suppressedSet } from "~/lib/email/outbox.server";
import { stuckReminder, type StuckReminderInput } from "~/lib/email/templates";
import { audit } from "~/lib/leagues.server";
import { pairLinkPath } from "~/lib/pair-links.server";
import { listSeasons } from "~/lib/seasons.server";
import { listSignups } from "~/lib/signups-admin.server";
import { SITE_URL } from "~/lib/site";

import type { LeagueRef } from "./auth/permissions";
import {
  countBySituation,
  dueReminders,
  entrySeason,
  nextPhase,
  SITUATIONS,
  type Reminder,
  type ReminderInput,
  type ReminderRecipient,
  type Situation,
} from "./reminders";

// The automatic reminders in D1 (#155). The rules are in reminders.ts. The
// hourly cron (workers/app.ts) queues what is due in the leagues whose
// switch is on, then the same run sends it. Whole tables, filtered in
// reminders.ts, never a long list of ids (D1: at most 100 bound parameters);
// the volumes are small. A run takes about 20 D1 queries.

// Everything reminders.ts needs, read now.
export async function reminderInput(now = new Date()): Promise<ReminderInput> {
  const [leagueRows, seasonList, signups, accounts, emailOff, pairRows, entries, searches, suppressed, sent] =
    await Promise.all([
      db
        .select({ id: leagues.id, city: leagues.city, name: leagues.name })
        .from(leagues)
        .innerJoin(cities, eq(cities.slug, leagues.city))
        .where(eq(cities.listed, true)),
      listSeasons(),
      listSignups(),
      db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          consentAt: users.consentAt,
          createdAt: users.createdAt,
          role: users.platformRole,
        })
        .from(users),
      emailSwitchedOff(),
      db
        .select({
          id: pairs.id,
          leagueId: pairs.leagueId,
          playerA: pairs.playerA,
          playerB: pairs.playerB,
          status: pairs.status,
          createdAt: pairs.createdAt,
          dissolvedAt: pairs.dissolvedAt,
        })
        .from(pairs),
      db.select({ seasonId: seasonEntries.seasonId, pairId: seasonEntries.pairId }).from(seasonEntries),
      db.select().from(partnerSearches),
      suppressedSet(),
      db.select({ key: stuckReminders.key }).from(stuckReminders),
    ]);
  return {
    now,
    leagues: leagueRows,
    seasons: seasonList,
    signups,
    accounts: accounts.map((a) => {
      const email = a.email.toLowerCase();
      return { ...a, email, admin: a.role === "superadmin", emailOff: emailOff.has(email) };
    }),
    pairs: pairRows,
    entries,
    partnerSearches: searches,
    suppressed,
    sent: new Set(sent.map((r) => r.key)),
  };
}

function templateInput(r: Reminder, to: ReminderRecipient, league: string, pairLink: string | null, now: Date): StuckReminderInput {
  const next = nextPhase(r.season, now);
  return {
    situation: r.situation,
    to: to.name,
    email: to.email,
    partner: to.partner,
    league,
    season: r.season.name,
    deadline: r.season.registrationClosesAt,
    nextRound: next ? { number: next.number, startsAt: next.startsAt } : null,
    pairLink,
    now,
  };
}

// account_invites-style chunks: 3 parameters per pair link, 5 per record.
const LINK_CHUNK = 30;
const RECORD_CHUNK = 15;

// C needs the player's own pair link: made now for whoever has none yet
// (as Párom would on their next visit).
async function pairLinksFor(owners: { userId: string; leagueId: number }[]): Promise<Map<string, string>> {
  if (owners.length > 0) {
    const inserts: BatchItem<"sqlite">[] = [];
    for (let i = 0; i < owners.length; i += LINK_CHUNK)
      inserts.push(
        db
          .insert(pairLinks)
          .values(owners.slice(i, i + LINK_CHUNK).map((o) => ({ leagueId: o.leagueId, ownerId: o.userId, token: randomToken(18) })))
          .onConflictDoNothing(),
      );
    const [first, ...rest] = inserts;
    await db.batch([first, ...rest]);
  }
  const rows = await db.select({ leagueId: pairLinks.leagueId, ownerId: pairLinks.ownerId, token: pairLinks.token }).from(pairLinks);
  return new Map(rows.map((r) => [`${r.leagueId}:${r.ownerId}`, `${SITE_URL}${pairLinkPath(r.token)}`]));
}

// The cron's step: queues every reminder due in the leagues with the switch
// on. One D1 batch (a transaction) writes the stuck_reminders records and
// the emails: both commit or neither does, so a failure part-way can't leave
// an email queued without its record (it would go out again next run). A
// run overlapping another fails on the records' unique key and queues
// nothing; whatever it missed is due on the next run. Returns how many
// emails were queued.
export async function queueDueReminders(now = new Date()): Promise<number> {
  const on = await db.select({ id: leagues.id, name: leagues.name }).from(leagues).where(isNotNull(leagues.remindersOnAt));
  if (on.length === 0) return 0;
  const due = dueReminders(await reminderInput(now), on.map((l) => l.id));
  if (due.length === 0) return 0;

  // Made first, outside the batch: a pair link is the player's anyway.
  const links = await pairLinksFor(
    due.filter((r) => r.situation === "C").map((r) => ({ userId: r.recipients[0].userId!, leagueId: r.leagueId })),
  );
  const leagueName = new Map(on.map((l) => [l.id, l.name]));
  const messages = due.flatMap((r) =>
    r.recipients.map((to) => ({
      toEmail: to.email,
      input: templateInput(
        r,
        to,
        leagueName.get(r.leagueId) ?? "",
        r.situation === "C" ? (links.get(`${r.leagueId}:${to.userId}`) ?? null) : null,
        now,
      ),
    })),
  );
  const statements: BatchItem<"sqlite">[] = [];
  for (let i = 0; i < due.length; i += RECORD_CHUNK)
    statements.push(
      db.insert(stuckReminders).values(
        due.slice(i, i + RECORD_CHUNK).map((r) => ({
          key: r.key,
          situation: r.situation,
          leagueId: r.leagueId,
          seasonId: r.season.id,
          recipients: r.recipients.length,
        })),
      ),
    );
  statements.push(...(await stuckReminderInserts(messages)));
  const [first, ...rest] = statements;
  try {
    await db.batch([first, ...rest]);
  } catch (e) {
    if (String(e).includes("UNIQUE constraint failed")) {
      console.warn("reminders: another run queued some of these; left to the next run");
      return 0;
    }
    throw e;
  }
  return messages.length;
}

// --- The switch page --------------------------------------------------------

export type ReminderPreview = { situation: Situation; subject: string; text: string };

export type ReminderOverview = {
  on: boolean;
  onSince: Date | null;
  // Who each reminder would reach right now (the backlog when switched on).
  due: Record<Situation, number>;
  // One email per situation with a real recipient's data, every address
  // and the pair link's token hidden.
  previews: ReminderPreview[];
  // What was started so far (queued; the outbox log shows delivery): emails
  // and the latest time, per situation.
  sent: Record<Situation, { emails: number; last: Date | null }>;
  // The season the reminders are about, or null: none accepts entries now.
  season: string | null;
};

const PREVIEW_LINK = `${SITE_URL}${pairLinkPath("…")}`;

export async function reminderOverview(league: LeagueRef, now = new Date()): Promise<ReminderOverview> {
  const [[row], input, stats] = await Promise.all([
    db.select({ on: leagues.remindersOnAt }).from(leagues).where(eq(leagues.id, league.id)),
    reminderInput(now),
    db
      .select({
        situation: stuckReminders.situation,
        emails: sql<number>`sum(${stuckReminders.recipients})`,
        reminders: count(),
        last: max(stuckReminders.createdAt),
      })
      .from(stuckReminders)
      .where(eq(stuckReminders.leagueId, league.id))
      .groupBy(stuckReminders.situation),
  ]);
  const due = dueReminders(input, [league.id]);
  const previews = SITUATIONS.flatMap((situation) => {
    const r = due.find((x) => x.situation === situation);
    if (!r) return [];
    const email = stuckReminder(templateInput(r, r.recipients[0], league.name, situation === "C" ? PREVIEW_LINK : null, now), "#");
    return [{ situation, subject: email.subject, text: hideAddresses(email.text.split("\n--\n")[0]) }];
  });
  const sent = Object.fromEntries(
    SITUATIONS.map((s) => {
      const x = stats.find((r) => r.situation === s);
      return [s, { emails: Number(x?.emails ?? 0), last: x?.last ?? null }];
    }),
  ) as ReminderOverview["sent"];
  const season = entrySeason(input.seasons, league.id, now)?.name ?? null;
  return { on: !!row?.on, onSince: row?.on ?? null, due: countBySituation(due), previews, sent, season };
}

// The Szervező or the Admin switches the reminders on or off for the league.
export async function setReminders(actorId: string, league: LeagueRef, on: boolean, now = new Date()): Promise<void> {
  await db
    .update(leagues)
    .set({ remindersOnAt: on ? now : null })
    .where(on ? and(eq(leagues.id, league.id), sql`${leagues.remindersOnAt} is null`) : eq(leagues.id, league.id));
  await audit(actorId, on ? "reminders.on" : "reminders.off", `league:${league.id}`);
}
