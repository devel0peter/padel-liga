import { absenceClosesAt, absenceOpen } from "@padel-liga/rules";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { rowSelect } from "~/db/insert-select";
import { groupPairs, groups, leagues, matchAbsences, matches, pairs, partnerChanges, partnerSearches, seasonEntries, users } from "~/db/schema";

import { auditEntry, auditIfChanged } from "./audit.server";
import type { User } from "./auth/session.server";
import { queuePartnerChangeEmail } from "./email/outbox.server";
import { phasesWithGroups } from "./groups.server";
import { pairMemberStatements } from "./league-members.server";
import { logError, logInfo, logWarn } from "./log";
import { absenceMarkedMessage, partnerChangeMessage } from "./notifications";
import { notifyPartnerChangeWaiting, notifyPlayers } from "./notifications.server";
import { activePairIdOf, activePairWith, insertPairIfFree } from "./pairs.server";
import {
  ACCEPTED_NOTICE,
  answerRefusal,
  APPROVED_NOTICE,
  decideRefusal,
  REJECTED_NOTICE,
  waitingText,
  currentStatus,
  DECLINED_NOTICE,
  finalText,
  isLive,
  lapsesAt,
  LAPSE_DAYS,
  openText,
  PARTNER_CHANGE_REFUSALS,
  SENT_NOTICE,
  startRefusal,
  startsAt,
  undoRefusal,
  withdrawRefusal,
  WITHDRAWN_NOTICE,
  type ChangeRole,
  type PartnerChangeStatus,
} from "./partner-changes";
import { withdrawEntries } from "./season-entries.server";
import { currentSeason, isWaiting, type Season } from "./seasons";
import { getSeason, listSeasons } from "./seasons.server";
import { markAbsent } from "./substitutes.server";

// Permanent partner change (#402, spec 4, D178) in D1; the rules are in
// partner-changes.ts. A player of a pair names a new partner on Ligáim
// (either player: the one who starts it stays), the new partner accepts or
// declines there; an unanswered change lapses after 7 days. Accepted, it is
// final: the leaving player is marked absent (#400's markAbsent) on every
// match of the old pair the window still allows, the new partner plays
// instead, and the new pair starts at the round switch in the old pair's
// spot (#403, round-switch.server.ts, startChangesAtPublish here), or at
// once when the old pair hasn't played yet. The organizer can undo a final
// change on Párok until then. Every step is audited (Napló, #402 req 9).
// Notices: the new partner (asked) and the leaving player (final) in the
// app, by push and by email; the others in the app and by push.

type Result = { ok: true; notice: string } | { ok: false; error: string };

const NAMELESS = "Törölt játékos";
const nameOf = (n: string | null | undefined, deleted?: Date | null) => (deleted ? NAMELESS : n || "Névtelen");
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

const staying = alias(users, "pc_staying");
const leaving = alias(users, "pc_leaving");
const partner = alias(users, "pc_partner");

type ChangeRow = {
  id: number;
  leagueId: number;
  seasonId: number;
  pairId: number;
  startedBy: string;
  leavingId: string;
  partnerId: string;
  status: PartnerChangeStatus;
  startsPhase: number | null;
  newPairId: number | null;
  createdAt: Date;
  stayingName: string;
  leavingName: string;
  partnerName: string;
};

const changeColumns = {
  id: partnerChanges.id,
  leagueId: partnerChanges.leagueId,
  seasonId: partnerChanges.seasonId,
  pairId: partnerChanges.pairId,
  startedBy: partnerChanges.startedBy,
  leavingId: partnerChanges.leavingId,
  partnerId: partnerChanges.partnerId,
  status: partnerChanges.status,
  startsPhase: partnerChanges.startsPhase,
  newPairId: partnerChanges.newPairId,
  createdAt: partnerChanges.createdAt,
  stayingName: sql<string>`case when ${staying.deletedAt} is not null then ${NAMELESS} else ${staying.name} end`,
  leavingName: sql<string>`case when ${leaving.deletedAt} is not null then ${NAMELESS} else ${leaving.name} end`,
  partnerName: sql<string>`case when ${partner.deletedAt} is not null then ${NAMELESS} else ${partner.name} end`,
};

function changesQuery() {
  return db
    .select(changeColumns)
    .from(partnerChanges)
    .innerJoin(staying, eq(staying.id, partnerChanges.startedBy))
    .innerJoin(leaving, eq(leaving.id, partnerChanges.leavingId))
    .innerJoin(partner, eq(partner.id, partnerChanges.partnerId));
}

async function changeById(id: number): Promise<ChangeRow | undefined> {
  const [row] = await changesQuery().where(eq(partnerChanges.id, id));
  return row;
}

// --- Who may take part ---------------------------------------------------------

/** The season a league's card shows (currentSeason, as on Ligáim and the Tabella). */
async function seasonOf(leagueId: number, now: Date): Promise<Season | undefined> {
  return currentSeason(await listSeasons(leagueId), now);
}

/** Until the season's last round deadline; a first season waiting for its start counts as open. */
export function seasonOpen(season: Season | undefined, now: Date): boolean {
  if (!season) return false;
  if (isWaiting(season) || season.phases.length === 0) return true;
  return Math.max(...season.phases.map((p) => p.deadline.getTime())) >= now.getTime();
}

type OwnPair = { pairId: number; players: [string, string]; joinsPhase: number };

/** The player's active pair in the league with an approved entry in the season that still counts (#402 req 1). */
async function ownPair(userId: string, leagueId: number, seasonId: number): Promise<OwnPair | null> {
  const [row] = await db
    .select({ pairId: pairs.id, a: pairs.playerA, b: pairs.playerB, joinsPhase: seasonEntries.joinsPhase })
    .from(pairs)
    .innerJoin(seasonEntries, eq(seasonEntries.pairId, pairs.id))
    .where(
      and(
        eq(pairs.leagueId, leagueId),
        eq(pairs.status, "active"),
        or(eq(pairs.playerA, userId), eq(pairs.playerB, userId)),
        eq(seasonEntries.seasonId, seasonId),
        eq(seasonEntries.status, "approved"),
        isNotNull(seasonEntries.joinsPhase),
      ),
    );
  return row ? { pairId: row.pairId, players: [row.a, row.b], joinsPhase: row.joinsPhase! } : null;
}

// A registered, not deleted player of the league with a level, without an
// active pair there and not the new partner of another final change: who
// can be named, and who can still accept.
function freePlayer(leagueId: number, userId: string, exceptChange?: number) {
  return sql`exists (select 1 from ${users} u where u.id = ${userId} and u.consent_at is not null and u.deleted_at is null and u.level is not null
    and (exists (select 1 from league_members lm where lm.league_id = ${leagueId} and lm.user_id = u.id)
      or exists (select 1 from pairs mp where mp.league_id = ${leagueId} and (mp.player_a = u.id or mp.player_b = u.id))))
    and not ${activePairWith(leagueId, [userId])}
    and not exists (select 1 from ${partnerChanges} fc where fc.league_id = ${leagueId} and fc.partner_id = ${userId}
      and fc.status in ('accepted', 'final') and fc.id <> ${exceptChange ?? 0})`;
}

async function isFree(leagueId: number, userId: string, exceptChange?: number): Promise<boolean> {
  const [row] = await db.select({ ok: sql<number>`1` }).from(leagues).where(and(eq(leagues.id, leagueId), freePlayer(leagueId, userId, exceptChange)));
  return !!row;
}

/** The players a new partner can be picked from: names only, never an email or phone (#402 req 1). */
export async function partnerCandidates(leagueId: number, except: readonly string[]): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(
        isNotNull(users.consentAt),
        isNull(users.deletedAt),
        isNotNull(users.level),
        sql`(exists (select 1 from league_members lm where lm.league_id = ${leagueId} and lm.user_id = ${users.id})
          or exists (select 1 from pairs mp where mp.league_id = ${leagueId} and (mp.player_a = ${users.id} or mp.player_b = ${users.id})))`,
        sql`not exists (select 1 from ${pairs} p where p.league_id = ${leagueId} and p.status = 'active' and (p.player_a = ${users.id} or p.player_b = ${users.id}))`,
        sql`not exists (select 1 from ${partnerChanges} fc where fc.league_id = ${leagueId} and fc.partner_id = ${users.id} and fc.status in ('accepted', 'final'))`,
      ),
    )
    .orderBy(asc(users.name), asc(users.id));
  return rows.filter((r) => !except.includes(r.id)).map((r) => ({ id: r.id, name: r.name || "Névtelen" }));
}

// The pair's open (not lapsed) or final change.
async function liveChangeOf(pairId: number, now: Date): Promise<ChangeRow | undefined> {
  const rows = await changesQuery().where(and(eq(partnerChanges.pairId, pairId), inArray(partnerChanges.status, ["open", "accepted", "final"])));
  return rows.find((r) => isLive(currentStatus(r, now)));
}

const notLapsed = (now: Date) => sql`${partnerChanges.createdAt} > ${sec(now) - LAPSE_DAYS * 86_400}`;

// --- Ligáim's section ----------------------------------------------------------

export type PartnerChangeItem = {
  id: number;
  role: ChangeRole;
  status: "open" | "accepted" | "final";
  text: string;
  canWithdraw: boolean;
  canAnswer: boolean;
};

export type PartnerChangeView = {
  /** The changes the player takes part in, open or final. */
  items: PartnerChangeItem[];
  /** The picker, when the player may start one: names only. */
  start: { candidates: { id: string; name: string }[] } | null;
};

const roleOf = (c: Pick<ChangeRow, "startedBy" | "leavingId" | "partnerId">, userId: string): ChangeRole =>
  c.startedBy === userId ? "staying" : c.leavingId === userId ? "leaving" : "partner";

/** What the "Állandó partnercsere" section shows the player for one league's season; null: nothing. */
export async function partnerChangeView(userId: string, leagueId: number, season: Season | undefined, now = new Date()): Promise<PartnerChangeView | null> {
  if (!season) return null;
  const rows = await changesQuery().where(
    and(
      eq(partnerChanges.seasonId, season.id),
      inArray(partnerChanges.status, ["open", "accepted", "final"]),
      or(eq(partnerChanges.startedBy, userId), eq(partnerChanges.leavingId, userId), eq(partnerChanges.partnerId, userId)),
    ),
  );
  const items: PartnerChangeItem[] = [];
  for (const c of rows) {
    const status = currentStatus(c, now);
    if (status !== "open" && status !== "accepted" && status !== "final") continue;
    const role = roleOf(c, userId);
    items.push({
      id: c.id,
      role,
      status,
      text:
        status === "open"
          ? openText(role, { starter: c.stayingName, leaving: c.leavingName, partner: c.partnerName, lapsesAt: lapsesAt(c.createdAt) })
          : status === "accepted"
            ? waitingText(role, { starter: c.stayingName, leaving: c.leavingName, partner: c.partnerName })
            : finalText(role, { staying: c.stayingName, leaving: c.leavingName, partner: c.partnerName, phase: c.startsPhase }),
      canWithdraw: status === "open" && role === "staying",
      canAnswer: status === "open" && role === "partner",
    });
  }
  const pair = seasonOpen(season, now) ? await ownPair(userId, leagueId, season.id) : null;
  const holds = pair && items.some((i) => i.role !== "partner");
  const start = pair && !holds ? { candidates: await partnerCandidates(leagueId, pair.players) } : null;
  return items.length === 0 && !start ? null : { items, start };
}

// --- The players' steps ----------------------------------------------------------

const refused = (r: keyof typeof PARTNER_CHANGE_REFUSALS): Result => ({ ok: false, error: PARTNER_CHANGE_REFUSALS[r] });

const PAIR_GONE = "A régi pár már nem aktív, így a partnercsere nem indulhat. Lezártuk, és szóltunk a játékosoknak.";

/** "Állandó partnercsere": a player of the pair names the new partner (#402 req 1-3). */
export async function startPartnerChange(user: Pick<User, "id">, leagueId: number, partnerId: string, now = new Date()): Promise<Result> {
  const season = await seasonOf(leagueId, now);
  const pair = season ? await ownPair(user.id, leagueId, season.id) : null;
  const live = pair ? await liveChangeOf(pair.pairId, now) : undefined;
  const refusal = startRefusal({
    pair: pair ? { players: pair.players } : null,
    seasonOpen: seasonOpen(season, now),
    live: !!live,
    partnerId,
    partnerFree: !!partnerId && (await isFree(leagueId, partnerId)),
  });
  if (refusal) return refused(refusal);
  const leavingId = pair!.players.find((p) => p !== user.id)!;
  const lapsedBefore = sec(now) - LAPSE_DAYS * 86_400;
  try {
    await db.batch([
      // A lapsed one makes room for the new one (the live index).
      db
        .update(partnerChanges)
        .set({ status: "lapsed" })
        .where(and(eq(partnerChanges.pairId, pair!.pairId), eq(partnerChanges.status, "open"), sql`${partnerChanges.createdAt} <= ${lapsedBefore}`)),
      db.insert(partnerChanges).values({
        leagueId,
        seasonId: season!.id,
        pairId: pair!.pairId,
        startedBy: user.id,
        leavingId,
        partnerId,
        status: "open",
        createdAt: now,
      }),
      auditEntry({
        actorId: user.id,
        action: "partner_change.request",
        target: sql`'partner_change:' || (select max(${partnerChanges.id}) from ${partnerChanges} where ${partnerChanges.pairId} = ${pair!.pairId})`,
        detail: `pair:${pair!.pairId}; user:${leavingId} -> user:${partnerId}`,
        leagueId,
      }),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(`${e} ${(e as Error)?.cause ?? ""}`)) return refused("already");
    throw e;
  }
  logInfo("partner change requested", { leagueId, pairId: pair!.pairId });
  const [change] = await changesQuery()
    .where(and(eq(partnerChanges.pairId, pair!.pairId), eq(partnerChanges.status, "open")))
    .orderBy(desc(partnerChanges.id))
    .limit(1);
  if (change) await tellAsked(change);
  return { ok: true, notice: SENT_NOTICE };
}

/** The one who sent it takes it back while it waits. */
export async function withdrawPartnerChange(user: Pick<User, "id">, changeId: number, now = new Date()): Promise<Result> {
  const c = await changeById(changeId);
  if (!c) return refused("not_open");
  const refusal = withdrawRefusal({ status: currentStatus(c, now), startedBy: c.startedBy }, user.id);
  if (refusal) return refused(refusal);
  const [done] = await db.batch([
    db
      .update(partnerChanges)
      .set({ status: "withdrawn", endedBy: user.id, endedAt: now })
      .where(and(eq(partnerChanges.id, changeId), eq(partnerChanges.status, "open"), notLapsed(now)))
      .returning({ id: partnerChanges.id }),
    auditIfChanged({ actorId: user.id, action: "partner_change.withdraw", target: `partner_change:${changeId}`, detail: `pair:${c.pairId}`, leagueId: c.leagueId }),
  ]);
  if (done.length === 0) return refused("not_open");
  await notifyPlayers("partner_change", [{ userId: c.partnerId, message: partnerChangeMessage({ kind: "withdrawn", league: await leagueSlug(c.leagueId), starter: c.stayingName }) }]);
  return { ok: true, notice: WITHDRAWN_NOTICE };
}

/** The new partner says no. */
export async function declinePartnerChange(user: Pick<User, "id">, changeId: number, now = new Date()): Promise<Result> {
  const c = await changeById(changeId);
  if (!c) return refused("not_open");
  const refusal = answerRefusal({ status: currentStatus(c, now), partnerId: c.partnerId }, user.id, null);
  if (refusal) return refused(refusal);
  const [done] = await db.batch([
    db
      .update(partnerChanges)
      .set({ status: "declined", answeredAt: now })
      .where(and(eq(partnerChanges.id, changeId), eq(partnerChanges.status, "open"), notLapsed(now)))
      .returning({ id: partnerChanges.id }),
    auditIfChanged({ actorId: user.id, action: "partner_change.decline", target: `partner_change:${changeId}`, detail: `pair:${c.pairId}`, leagueId: c.leagueId }),
  ]);
  if (done.length === 0) return refused("not_open");
  await notifyPlayers("partner_change", [{ userId: c.startedBy, message: partnerChangeMessage({ kind: "declined", league: await leagueSlug(c.leagueId), partner: c.partnerName }) }]);
  return { ok: true, notice: DECLINED_NOTICE };
}

/**
 * The new partner accepts (#402 req 3; #416 req 1-2): the change waits for
 * the organizer ("Jóváhagyásra vár"). Nothing is marked yet and the old pair
 * plays on, but the new partner is taken from now (activePairWith) and no
 * longer looks for a partner. The starter is told in the app, the league's
 * organizers get "Partnercsere jóváhagyásra vár" (app and push, no email).
 */
export async function acceptPartnerChange(user: Pick<User, "id">, changeId: number, now = new Date()): Promise<Result> {
  const c = await changeById(changeId);
  if (!c) return refused("not_open");
  const season = await getSeason(c.seasonId);
  const refusal = answerRefusal({ status: currentStatus(c, now), partnerId: c.partnerId }, user.id, {
    pairActive: await oldPairActive(c),
    seasonOpen: seasonOpen(season, now),
    partnerFree: await isFree(c.leagueId, c.partnerId, c.id),
  });
  if (refusal) return refused(refusal);
  try {
    const [done] = await db.batch([
      db
        .update(partnerChanges)
        .set({ status: "accepted", answeredAt: now })
        .where(and(eq(partnerChanges.id, changeId), eq(partnerChanges.status, "open"), notLapsed(now), freePlayer(c.leagueId, c.partnerId, c.id)))
        .returning({ id: partnerChanges.id }),
      auditIfChanged({ actorId: user.id, action: "partner_change.accept", target: `partner_change:${changeId}`, detail: `pair:${c.pairId}`, leagueId: c.leagueId }),
      // Taken now: no longer looking for a partner (D59), nor listed on
      // Párkereső (D177: switching off clears the listing).
      db
        .update(partnerSearches)
        .set({ seeking: false, listed: false, updatedAt: now })
        .where(
          and(
            eq(partnerSearches.leagueId, c.leagueId),
            eq(partnerSearches.userId, c.partnerId),
            eq(partnerSearches.seeking, true),
            sql`exists (select 1 from ${partnerChanges} where ${partnerChanges.id} = ${changeId} and ${partnerChanges.status} = 'accepted')`,
          ),
        ),
    ]);
    if (done.length === 0) return refused("not_open");
  } catch (e) {
    if (/UNIQUE/i.test(`${e} ${(e as Error)?.cause ?? ""}`)) return refused("partner");
    throw e;
  }
  logInfo("partner change accepted", { leagueId: c.leagueId, pairId: c.pairId });
  const league = await leagueSlug(c.leagueId);
  await notifyPlayers("partner_change", [{ userId: c.startedBy, message: partnerChangeMessage({ kind: "accepted", league, partner: c.partnerName }) }]);
  await notifyPartnerChangeWaiting({ leagueId: c.leagueId, leagueSlug: league.slug, leagueName: league.name, except: c.partnerId });
  return { ok: true, notice: ACCEPTED_NOTICE };
}

// The old pair still holds the starter and the leaving player, active.
async function oldPairActive(c: Pick<ChangeRow, "pairId" | "startedBy" | "leavingId">): Promise<boolean> {
  const [row] = await db.select({ status: pairs.status, a: pairs.playerA, b: pairs.playerB }).from(pairs).where(eq(pairs.id, c.pairId));
  return row?.status === "active" && [row.a, row.b].includes(c.startedBy) && [row.a, row.b].includes(c.leavingId);
}

/**
 * The organizer approves an accepted change on Párok (#416): now it is final,
 * with #402's effects. A pair waiting for its first round becomes the new
 * pair at once; otherwise the leaving player is marked absent on the old
 * pair's matches the window still allows, and the new pair starts at the
 * next round switch (the following one once that switch's draft exists:
 * also for a change that waited for approval while the draft was made).
 */
export async function approvePartnerChange(actorId: string, leagueId: number, changeId: number, now = new Date()): Promise<Result> {
  const c = await changeById(changeId);
  if (!c || c.leagueId !== leagueId) return refused("not_waiting");
  const refusal = decideRefusal({ status: c.status });
  if (refusal) return refused(refusal);
  const season = await getSeason(c.seasonId);
  // The old pair was dissolved or taken out meanwhile: nothing to approve,
  // and the change must not keep holding the new partner.
  if (!(await oldPairActive(c))) {
    await endUnstarted(c, actorId, now);
    return { ok: false, error: PAIR_GONE };
  }
  if (!seasonOpen(season, now)) return refused("season_over");
  const [withGroups, played] = await Promise.all([phasesWithGroups(c.seasonId), playedInSeason(c.pairId, c.seasonId)]);
  const when = startsAt({ phases: season!.phases.map((p) => p.number), withGroups: withGroups.map((g) => g.phase), played });
  if (when.kind === "now") {
    if (!(await startNow(c, actorId, now))) return refused("not_waiting");
    await tellFinal(c, null, true);
    return { ok: true, notice: APPROVED_NOTICE };
  }
  const startsPhase = when.kind === "switch" ? when.phase : null;
  const [done] = await db.batch([
    db
      .update(partnerChanges)
      .set({ status: "final", startsPhase, decidedBy: actorId, decidedAt: now })
      .where(and(eq(partnerChanges.id, changeId), eq(partnerChanges.status, "accepted")))
      .returning({ id: partnerChanges.id }),
    auditIfChanged({
      actorId,
      action: "partner_change.approve",
      target: `partner_change:${changeId}`,
      detail: `pair:${c.pairId}; starts ${startsPhase === null ? "next season" : `phase ${startsPhase}`}`,
      leagueId,
    }),
  ]);
  if (done.length === 0) return refused("not_waiting");
  logInfo("partner change final", { leagueId, pairId: c.pairId, startsPhase });
  const marked = await markRemaining(c, null, now);
  await tellFinal(c, startsPhase, false);
  await tellOpponents(c, marked, false);
  return { ok: true, notice: APPROVED_NOTICE };
}

/**
 * The organizer rejects an accepted change on Párok (#416 req 3), with an
 * optional reason: it ends, the old pair stays, and the three players get
 * the reason in the app and by push; no email.
 */
export async function rejectPartnerChange(actorId: string, leagueId: number, changeId: number, reason: string, now = new Date()): Promise<Result> {
  const c = await changeById(changeId);
  if (!c || c.leagueId !== leagueId) return refused("not_waiting");
  const refusal = decideRefusal({ status: c.status }, reason);
  if (refusal) return refused(refusal);
  const why = reason.trim() || null;
  const [done] = await db.batch([
    db
      .update(partnerChanges)
      .set({ status: "rejected", decidedBy: actorId, decidedAt: now, reason: why })
      .where(and(eq(partnerChanges.id, changeId), eq(partnerChanges.status, "accepted")))
      .returning({ id: partnerChanges.id }),
    auditIfChanged({ actorId, action: "partner_change.reject", target: `partner_change:${changeId}`, detail: `pair:${c.pairId}`, leagueId }),
  ]);
  if (done.length === 0) return refused("not_waiting");
  logInfo("partner change rejected", { leagueId, pairId: c.pairId });
  const league = await leagueSlug(leagueId);
  await notifyPlayers(
    "partner_change",
    [c.startedBy, c.leavingId, c.partnerId].map((userId) => ({
      userId,
      message: partnerChangeMessage({ kind: "rejected", league, staying: c.stayingName, leaving: c.leavingName, partner: c.partnerName, reason: why }),
    })),
  );
  return { ok: true, notice: REJECTED_NOTICE };
}

// Whether the pair is (or was) in a published group of the season.
async function playedInSeason(pairId: number, seasonId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: groupPairs.groupId })
    .from(groupPairs)
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .where(and(eq(groupPairs.pairId, pairId), eq(groups.seasonId, seasonId), isNotNull(groups.publishedAt)))
    .limit(1);
  return !!row;
}

// The new pair in a batch, `keep` in the old pair's column (pairs.server's
// changePartner does the same): A stays A.
async function newPairPlayers(c: Pick<ChangeRow, "pairId" | "startedBy" | "partnerId">): Promise<[string, string]> {
  const [row] = await db.select({ a: pairs.playerA }).from(pairs).where(eq(pairs.id, c.pairId));
  return row?.a === c.startedBy ? [c.startedBy, c.partnerId] : [c.partnerId, c.startedBy];
}

/**
 * The statements that end the old pair and start the new one, for one batch:
 * the old pair dissolved, the new pair inserted (only if both players are
 * free by then: otherwise the entry's pair id comes out null and the whole
 * batch fails), its entry, the old pair's unplayed entries withdrawn (D19),
 * the change marked started. `entry`: the new pair's season entry: the old
 * entry's approval for a pair that hasn't played, or the round it starts.
 */
function startStatements(
  c: Pick<ChangeRow, "id" | "leagueId" | "seasonId" | "pairId" | "startedBy" | "partnerId">,
  players: [string, string],
  entry: { kind: "copy" } | { kind: "phase"; phase: number },
  actorId: string | null,
  now: Date,
): [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] {
  const newPair = activePairIdOf(c.leagueId, players[0], players[1]);
  const entryInsert =
    entry.kind === "copy"
      ? db.insert(seasonEntries).select(
          rowSelect(
            seasonEntries,
            {
              id: sql`null`,
              seasonId: sql`${c.seasonId}`,
              pairId: sql`${newPair}`,
              status: sql`'approved'`,
              note: sql`null`,
              decidedBy: sql`${seasonEntries.decidedBy}`,
              decidedAt: sql`${seasonEntries.decidedAt}`,
              joinsPhase: sql`${seasonEntries.joinsPhase}`,
              updatedAt: sql`${sec(now)}`,
              createdAt: sql`${seasonEntries.createdAt}`,
              // The old pair's opt-out (#395) is not the new pair's.
              optOutPhase: sql`null`,
              optedOutBy: sql`null`,
              optedOutAt: sql`null`,
            },
            sql`from ${seasonEntries} where ${seasonEntries.seasonId} = ${c.seasonId} and ${seasonEntries.pairId} = ${c.pairId} and ${seasonEntries.status} = 'approved'`,
          ),
        )
      : db.insert(seasonEntries).values({
          seasonId: c.seasonId,
          pairId: sql<number>`${newPair}`,
          status: "approved",
          decidedBy: null,
          decidedAt: now,
          joinsPhase: entry.phase,
          updatedAt: now,
        });
  return [
    // Only for a final change: otherwise the staying player is still in the
    // old pair, the new pair isn't inserted and the entry fails the batch.
    db
      .update(pairs)
      .set({ status: "dissolved", dissolvedAt: now, dissolvedBy: actorId })
      .where(
        and(
          eq(pairs.id, c.pairId),
          eq(pairs.status, "active"),
          sql`exists (select 1 from ${partnerChanges} where ${partnerChanges.id} = ${c.id} and ${partnerChanges.status} = 'final')`,
        ),
      ),
    // Started before the pair's insert: while final, the new partner counts
    // as committed (activePairWith), which the insert refuses.
    db
      .update(partnerChanges)
      .set({ status: "started", endedAt: now })
      .where(and(eq(partnerChanges.id, c.id), eq(partnerChanges.status, "final"))),
    insertPairIfFree(c.leagueId, players[0], players[1], "change"),
    entryInsert,
    withdrawEntries(c.pairId, now),
    db
      .update(partnerChanges)
      .set({ newPairId: sql<number>`${newPair}` })
      .where(eq(partnerChanges.id, c.id)),
    ...pairMemberStatements(c.leagueId, players[0], players[1], () => "pair"),
  ];
}


// A pair that hasn't played: the new pair takes over its entry at once and
// its place in any draft not published yet (#402 req 6). False when the new
// partner or the old pair changed in the meantime.
async function startNow(c: ChangeRow, actorId: string, now: Date): Promise<boolean> {
  const players = await newPairPlayers(c);
  // Drafts not published yet that hold the old pair: the new pair takes its row.
  const drafts = await db
    .select({ id: groups.id, basis: groups.basis })
    .from(groupPairs)
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .where(and(eq(groupPairs.pairId, c.pairId), eq(groups.seasonId, c.seasonId), isNull(groups.publishedAt)));
  const newPair = activePairIdOf(c.leagueId, players[0], players[1]);
  try {
    await db.batch([
      // If this doesn't take the change (decided meanwhile), the
      // old pair isn't dissolved and the statements after it fail the batch.
      db
        .update(partnerChanges)
        .set({ status: "final", decidedBy: actorId, decidedAt: now })
        .where(and(eq(partnerChanges.id, c.id), eq(partnerChanges.status, "accepted"))),
      ...startStatements(c, players, { kind: "copy" }, actorId, now),
      ...drafts.map((d) => db.update(groupPairs).set({ pairId: sql<number>`${newPair}` }).where(and(eq(groupPairs.groupId, d.id), eq(groupPairs.pairId, c.pairId)))),
      auditEntry({
        actorId,
        action: "partner_change.approve",
        target: `partner_change:${c.id}`,
        detail: sql`${`pair:${c.pairId}; started at once, new pair:`} || ${newPair}`,
        leagueId: c.leagueId,
      }),
    ]);
  } catch (e) {
    if (/NOT NULL|UNIQUE/i.test(`${e} ${(e as Error)?.cause ?? ""}`)) return false;
    throw e;
  }
  // The stored draft basis (round-switch.server.ts draftBasis) names the new
  // pair instead, so the draft isn't taken as outdated.
  const [done] = await db.select({ id: partnerChanges.newPairId }).from(partnerChanges).where(eq(partnerChanges.id, c.id));
  for (const d of drafts)
    if (d.basis && done?.id)
      await db
        .update(groups)
        .set({ basis: replaceInBasis(d.basis, c.pairId, done.id) })
        .where(and(eq(groups.id, d.id), eq(groups.basis, d.basis)));
  logInfo("partner change started at once", { leagueId: c.leagueId, pairId: c.pairId });
  return true;
}

/** The stored draft basis ("1,2,5,6|3,4,7,8") with one pair id replaced by another, each group sorted again (as draftBasis). */
export function replaceInBasis(basis: string, oldId: number, newId: number): string {
  return basis
    .split("|")
    .map((g) =>
      g
        .split(",")
        .filter(Boolean)
        .map((id) => (Number(id) === oldId ? newId : Number(id)))
        .sort((a, b) => a - b)
        .join(","),
    )
    .join("|");
}

/**
 * Marks the leaving player absent, for this change, on every match of the
 * old pair without a result whose window is still open (before the agreed
 * start or the deadline; #400 rules), in this season (`phase`: only that
 * round's). Returns the matches marked.
 */
async function markRemaining(c: Pick<ChangeRow, "id" | "pairId" | "seasonId" | "leavingId" | "partnerId">, phase: number | null, now: Date): Promise<number[]> {
  const rows = await db
    .select({ id: matches.id, revision: matches.revision, status: matches.status, scheduledAt: matches.scheduledAt, deadline: matches.deadline })
    .from(matches)
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .where(
      and(
        eq(groups.seasonId, c.seasonId),
        phase === null ? sql`1` : eq(groups.phase, phase),
        isNotNull(groups.publishedAt),
        or(eq(matches.pairA, c.pairId), eq(matches.pairB, c.pairId)),
        inArray(matches.status, ["open", "scheduled"]),
        // Not a withdrawn pair's match (D87): it doesn't count.
        sql`not exists (select 1 from ${groupPairs} gp where gp.group_id = ${matches.groupId} and gp.pair_id in (${matches.pairA}, ${matches.pairB}) and gp.withdrawn_at is not null)`,
      ),
    )
    .orderBy(asc(matches.id));
  const marked: number[] = [];
  for (const m of rows) {
    const closesAt = absenceClosesAt({ scheduledAt: m.status === "scheduled" ? m.scheduledAt : null, deadline: m.deadline });
    if (!absenceOpen({ closesAt, hasResult: false, voided: false }, now)) continue;
    const done = await markAbsent({
      matchId: m.id,
      revision: m.revision,
      pairId: c.pairId,
      absentId: c.leavingId,
      markedBy: c.partnerId,
      afterMatch: false,
      now,
      partnerChangeId: c.id,
    });
    if (done) {
      marked.push(m.id);
      continue;
    }
    // Marked by the pair already (#400, likely for an injured player): the
    // mark now names the new partner, as one made by the change would.
    const linked = await db
      .update(matchAbsences)
      .set({ partnerChangeId: c.id })
      .where(and(eq(matchAbsences.matchId, m.id), eq(matchAbsences.absentId, c.leavingId), isNull(matchAbsences.partnerChangeId)))
      .returning({ id: matchAbsences.id });
    if (linked.length > 0) marked.push(m.id);
  }
  return marked;
}

// --- Notices -------------------------------------------------------------------

async function leagueSlug(leagueId: number): Promise<{ slug: string; name: string }> {
  const [row] = await db.select({ slug: leagues.slug, name: leagues.name }).from(leagues).where(eq(leagues.id, leagueId));
  return row ?? { slug: "", name: "" };
}

async function emailsOf(ids: string[]): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(inArray(users.id, ids), isNull(users.deletedAt)));
  return new Map(rows.map((r) => [r.id, r.email]));
}

// The new partner is asked (#402 req 3): in the app, by push and by email.
async function tellAsked(c: ChangeRow): Promise<void> {
  try {
    const league = await leagueSlug(c.leagueId);
    await notifyPlayers("partner_change", [
      { userId: c.partnerId, message: partnerChangeMessage({ kind: "asked", league, starter: c.stayingName, leaving: c.leavingName }) },
    ]);
    const email = (await emailsOf([c.partnerId])).get(c.partnerId);
    if (email)
      await queuePartnerChangeEmail(email, {
        kind: "asked",
        to: c.partnerName,
        starter: c.stayingName,
        leaving: c.leavingName,
        league: league.name,
        leagueSlug: league.slug,
        lapsesAt: lapsesAt(c.createdAt),
      });
  } catch (error) {
    logError("partner change notice failed", { changeId: c.id, error });
  }
}

// Final (#402 req 7): the leaving player in the app, by push and by email
// (who replaces them and from when); the player who started it in the app
// and by push. `now`: the new pair started at once.
async function tellFinal(c: ChangeRow, startsPhase: number | null, now: boolean): Promise<void> {
  try {
    const league = await leagueSlug(c.leagueId);
    const from = now ? ("now" as const) : startsPhase;
    await notifyPlayers("partner_change", [
      { userId: c.leavingId, message: partnerChangeMessage({ kind: "final_leaving", league, staying: c.stayingName, partner: c.partnerName, from }) },
      { userId: c.startedBy, message: partnerChangeMessage({ kind: "final_staying", league, partner: c.partnerName, from }) },
      { userId: c.partnerId, message: partnerChangeMessage({ kind: "final_partner", league, staying: c.stayingName, leaving: c.leavingName, from }) },
    ]);
    const email = (await emailsOf([c.leavingId])).get(c.leavingId);
    if (email)
      await queuePartnerChangeEmail(email, {
        kind: "final",
        to: c.leavingName,
        staying: c.stayingName,
        partner: c.partnerName,
        league: league.name,
        leagueSlug: league.slug,
        from,
      });
  } catch (error) {
    logError("partner change notice failed", { changeId: c.id, error });
  }
}

// The usual substitute notice (#400) to the other pair of each match marked
// (or unmarked on an undo), naming the new partner.
async function tellOpponents(c: Pick<ChangeRow, "id" | "pairId" | "leavingName" | "partnerName">, matchIds: readonly number[], withdrawn: boolean): Promise<void> {
  if (matchIds.length === 0) return;
  try {
    const rows = await db
      .select({ id: matches.id, pairA: matches.pairA, pairB: matches.pairB })
      .from(matches)
      .where(inArray(matches.id, [...matchIds]));
    const other = rows.map((m) => ({ matchId: m.id, pairId: m.pairA === c.pairId ? m.pairB : m.pairA }));
    const players = await db
      .select({ id: pairs.id, a: pairs.playerA, b: pairs.playerB })
      .from(pairs)
      .where(inArray(pairs.id, [...new Set(other.map((o) => o.pairId))]));
    const byPair = new Map(players.map((p) => [p.id, [p.a, p.b]]));
    await notifyPlayers(
      "absence_marked",
      other.flatMap((o) =>
        (byPair.get(o.pairId) ?? []).map((userId) => ({
          userId,
          message: absenceMarkedMessage({ matchId: o.matchId, name: c.leavingName, substitute: c.partnerName, withdrawn }),
        })),
      ),
    );
  } catch (error) {
    logError("partner change notice failed", { changeId: c.id, error });
  }
}

// --- The organizer -------------------------------------------------------------

export type LeagueChangeRow = {
  id: number;
  pairId: number;
  status: "open" | "accepted" | "final" | "started";
  staying: string;
  leaving: string;
  partner: string;
  startsPhase: number | null;
  createdAt: Date;
  canUndo: boolean;
  // An accepted change waits for the organizer's approval or rejection (#416).
  canDecide: boolean;
  // How many approved changes (final or started) the starter and the new
  // partner have had this season, in any role (#416 req 5).
  counts: { staying: number; partner: number };
};

/**
 * Párok's list (#402 req 8, #416): the season's open, waiting and final
 * changes, and the started ones, newest first, each with how often its
 * starter and new partner changed partner this season.
 */
export async function leaguePartnerChanges(leagueId: number, now = new Date()): Promise<LeagueChangeRow[]> {
  const season = await seasonOf(leagueId, now);
  if (!season) return [];
  const rows = await changesQuery()
    .where(and(eq(partnerChanges.seasonId, season.id), inArray(partnerChanges.status, ["open", "accepted", "final", "started"])))
    .orderBy(desc(partnerChanges.id));
  const approved = rows.filter((c) => c.status === "final" || c.status === "started");
  const countOf = (userId: string) => approved.filter((c) => [c.startedBy, c.leavingId, c.partnerId].includes(userId)).length;
  return rows.flatMap((c) => {
    const status = currentStatus(c, now);
    if (status !== "open" && status !== "accepted" && status !== "final" && status !== "started") return [];
    return [
      {
        id: c.id,
        pairId: c.pairId,
        status,
        staying: c.stayingName,
        leaving: c.leavingName,
        partner: c.partnerName,
        startsPhase: c.startsPhase,
        createdAt: c.createdAt,
        canUndo: undoRefusal({ status }) === null,
        canDecide: decideRefusal({ status }) === null,
        counts: { staying: countOf(c.startedBy), partner: countOf(c.partnerId) },
      },
    ];
  });
}

/**
 * Párok (#416 req 5): per pair, the number of the league's current-season
 * matches where a player of the pair was marked absent (#400), a partner
 * change's marks included. Pairs without one are left out.
 */
export async function pairAbsenceCounts(leagueId: number, now = new Date()): Promise<Map<number, number>> {
  const season = await seasonOf(leagueId, now);
  if (!season) return new Map();
  const rows = await db
    .select({ pairId: matchAbsences.pairId, n: sql<number>`count(distinct ${matchAbsences.matchId})` })
    .from(matchAbsences)
    .innerJoin(matches, eq(matches.id, matchAbsences.matchId))
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .where(eq(groups.seasonId, season.id))
    .groupBy(matchAbsences.pairId);
  return new Map(rows.map((r) => [r.pairId, r.n]));
}


/**
 * "Visszavonás" on Párok (#402 req 8): a final change is undone until the
 * new pair starts. The marks it made on matches not played yet go, and all
 * three players are told in the app (and by push); the opponents get the
 * usual notice that the player plays after all.
 */
export async function undoPartnerChange(actorId: string, leagueId: number, changeId: number, now = new Date()): Promise<Result> {
  const c = await changeById(changeId);
  if (!c || c.leagueId !== leagueId) return refused("not_final");
  const refusal = undoRefusal({ status: currentStatus(c, now) });
  if (refusal) return refused(refusal);
  const unplayed = await db
    .select({ id: matchAbsences.matchId })
    .from(matchAbsences)
    .where(and(eq(matchAbsences.partnerChangeId, changeId), windowStillOpen(now)));
  const ids = unplayed.map((u) => u.id);
  const [done] = await db.batch([
    db
      .update(partnerChanges)
      .set({ status: "undone", endedBy: actorId, endedAt: now })
      .where(and(eq(partnerChanges.id, changeId), eq(partnerChanges.status, "final")))
      .returning({ id: partnerChanges.id }),
    auditIfChanged({ actorId, action: "partner_change.undo", target: `partner_change:${changeId}`, detail: `pair:${c.pairId}; ${ids.length} matches`, leagueId }),
    // Only once the change is undone.
    marksStillOpen(changeId, now),
  ]);
  if (done.length === 0) return refused("not_final");
  logInfo("partner change undone", { leagueId, pairId: c.pairId });
  const league = await leagueSlug(leagueId);
  await notifyPlayers(
    "partner_change",
    [c.startedBy, c.leavingId, c.partnerId].map((userId) => ({
      userId,
      message: partnerChangeMessage({ kind: "undone", league, staying: c.stayingName, leaving: c.leavingName, partner: c.partnerName }),
    })),
  );
  await tellOpponents(c, ids, true);
  return { ok: true, notice: "Visszavontad a partnercserét." };
}

/**
 * A mark's match is still before its window closes (#400: before the agreed
 * start, or the deadline while none is agreed) and has no result: the new
 * partner hasn't played it. A match already started or played keeps who
 * played.
 */
export function windowStillOpen(now: Date) {
  return sql`exists (select 1 from ${matches} m where m.id = ${matchAbsences.matchId} and m.status in ('open', 'scheduled')
    and (case when m.status = 'scheduled' and m.scheduled_at is not null then m.scheduled_at else m.deadline end) > ${Math.floor(now.getTime() / 1000)})`;
}

// The marks a change made on matches still open (windowStillOpen), deleted
// once the change is undone (its status checked inside the batch).
function marksStillOpen(changeId: number, now: Date) {
  return db
    .delete(matchAbsences)
    .where(
      and(
        eq(matchAbsences.partnerChangeId, changeId),
        sql`exists (select 1 from ${partnerChanges} where ${partnerChanges.id} = ${changeId} and ${partnerChanges.status} = 'undone')`,
        windowStillOpen(now),
      ),
    );
}

// --- Account deletion (section 3) ----------------------------------------------

// The changes a deletion ends (partnerChangeDeletion): every open or
// accepted (waiting, #416) one of the account, and every final one where it
// isn't the leaving player. A final
// change whose leaving player goes keeps going: the old pair is dissolved
// anyway, and the staying player keeps the spot (#403, switchChanges).
function endedByDeletion(userId: string) {
  return and(
    or(
      inArray(partnerChanges.status, ["open", "accepted"]),
      and(eq(partnerChanges.status, "final"), or(eq(partnerChanges.startedBy, userId), eq(partnerChanges.partnerId, userId))),
    ),
    or(eq(partnerChanges.startedBy, userId), eq(partnerChanges.leavingId, userId), eq(partnerChanges.partnerId, userId)),
  );
}

export type EndedChange = ChangeRow & { matches: number[] };

/** Before a deletion: the changes it will end, with the matches whose marks go, for the notices. */
export async function changesEndedByDeletion(userId: string, now: Date): Promise<EndedChange[]> {
  const rows = await changesQuery().where(endedByDeletion(userId));
  const out: EndedChange[] = [];
  for (const c of rows) {
    const marks =
      c.status === "final"
        ? await db.select({ id: matchAbsences.matchId }).from(matchAbsences).where(and(eq(matchAbsences.partnerChangeId, c.id), windowStillOpen(now)))
        : [];
    out.push({ ...c, matches: marks.map((m) => m.id) });
  }
  return out;
}

/**
 * The deletion's statements for its batch (`guard`: only once the account is
 * gone): the marks of the ended final changes on matches still open go (as
 * an organizer's undo), then an open change is withdrawn and a final one
 * undone. Started ones are history.
 */
export function partnerChangeDeletion(userId: string, now: Date, guard: SQL) {
  const ended = db.select({ id: partnerChanges.id }).from(partnerChanges).where(and(endedByDeletion(userId), eq(partnerChanges.status, "final")));
  return [
    db.delete(matchAbsences).where(and(inArray(matchAbsences.partnerChangeId, ended), windowStillOpen(now), guard)),
    db
      .update(partnerChanges)
      .set({ status: sql`case when ${partnerChanges.status} in ('open', 'accepted') then 'withdrawn' else 'undone' end`, endedAt: now })
      .where(and(endedByDeletion(userId), guard)),
  ] as const;
}

/** After a deletion: the change's other players are told in the app, and the opponents whose marks went. */
export async function tellChangesEnded(ended: readonly EndedChange[], userId: string): Promise<void> {
  for (const c of ended) {
    const league = await leagueSlug(c.leagueId);
    await notifyPlayers(
      "partner_change",
      [c.startedBy, c.leavingId, c.partnerId].filter((id) => id !== userId).map((id) => ({ userId: id, message: partnerChangeMessage({ kind: "ended", league }) })),
    );
    await tellOpponents(c, c.matches, true);
  }
}

// --- The round switch (#403) ---------------------------------------------------

type SwitchPlayer = { id: string; name: string; level: string | null; elo: number | null; email: string };

export type SwitchChange = {
  id: number;
  oldPairId: number;
  // "final": the new pair isn't there yet: the old pair's row stands for it
  // until the publish; "started": the new pair exists (a publish that
  // failed after starting it, startChangesAtPublish).
  status: "final" | "started";
  newPairId: number | null;
  staying: SwitchPlayer;
  partner: SwitchPlayer;
  leaving: string;
};

/**
 * The changes whose new pair starts at the round switch into `phase` (#403):
 * final ones whose old pair is still active, and ones already started there,
 * in the order they became final.
 */
export async function switchChanges(seasonId: number, phase: number): Promise<SwitchChange[]> {
  const rows = await db
    .select({
      ...changeColumns,
      stayingLevel: staying.level,
      stayingElo: staying.elo,
      stayingEmail: staying.email,
      partnerLevel: partner.level,
      partnerElo: partner.elo,
      partnerEmail: partner.email,
      pairStatus: pairs.status,
      leavingDeleted: leaving.deletedAt,
    })
    .from(partnerChanges)
    .innerJoin(staying, eq(staying.id, partnerChanges.startedBy))
    .innerJoin(leaving, eq(leaving.id, partnerChanges.leavingId))
    .innerJoin(partner, eq(partner.id, partnerChanges.partnerId))
    .innerJoin(pairs, eq(pairs.id, partnerChanges.pairId))
    .where(and(eq(partnerChanges.seasonId, seasonId), eq(partnerChanges.startsPhase, phase), inArray(partnerChanges.status, ["final", "started"])))
    .orderBy(asc(partnerChanges.answeredAt), asc(partnerChanges.id));
  return rows
    // A final one whose old pair is gone has nothing to start from, unless
    // the leaving player's account was deleted (its pair dissolved by that).
    .filter((r) => (r.status === "final" ? r.pairStatus === "active" || r.leavingDeleted !== null : r.newPairId !== null))
    .map((r) => ({
      id: r.id,
      oldPairId: r.pairId,
      status: r.status as "final" | "started",
      newPairId: r.newPairId,
      staying: { id: r.startedBy, name: nameOf(r.stayingName), level: r.stayingLevel, elo: r.stayingElo, email: r.stayingEmail },
      partner: { id: r.partnerId, name: nameOf(r.partnerName), level: r.partnerLevel, elo: r.partnerElo, email: r.partnerEmail },
      leaving: r.leavingName,
    }));
}

/**
 * At the publish of the round switch into `phase` (#403 req 2): each final
 * change starting there (or earlier and left over) whose old pair is in the
 * draft becomes the new pair (startStatements), which takes the old pair's
 * row in the draft, one batch per change. Before publishPhase, which then
 * creates the matches with the new pairs. A change that can't start (its old
 * pair is gone from the draft, dissolved or taken out by the organizer, or
 * the batch fails) doesn't stay final: it is ended and its three players are
 * told in the app (endUnstarted). Returns how many started.
 */
export async function startChangesAtPublish(seasonId: number, phase: number, actorId: string, now = new Date()): Promise<number> {
  const rows = await db
    .select({ groupId: groupPairs.groupId, pairId: groupPairs.pairId })
    .from(groupPairs)
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase), isNull(groups.publishedAt)));
  if (rows.length === 0) return 0;
  const draftIds = [...new Set(rows.map((r) => r.groupId))];
  const inDraft = new Set(rows.map((r) => r.pairId));
  const due = await changesQuery().where(
    and(eq(partnerChanges.seasonId, seasonId), eq(partnerChanges.status, "final"), sql`${partnerChanges.startsPhase} <= ${phase}`),
  );
  // Accepted ones still waiting whose old pair is gone (#416): ended too.
  for (const c of await changesQuery().where(and(eq(partnerChanges.seasonId, seasonId), eq(partnerChanges.status, "accepted"))))
    if (!(await oldPairActive(c))) await endUnstarted(c, actorId, now);
  let started = 0;
  for (const c of due) {
    if (!inDraft.has(c.pairId)) {
      await endUnstarted(c, actorId, now);
      continue;
    }
    const players = await newPairPlayers(c);
    const newPair = activePairIdOf(c.leagueId, players[0], players[1]);
    try {
      await db.batch([
        ...startStatements(c, players, { kind: "phase", phase }, actorId, now),
        // The new pair takes the old pair's row in the draft.
        db
          .update(groupPairs)
          .set({ pairId: sql<number>`${newPair}` })
          .where(and(inArray(groupPairs.groupId, draftIds), eq(groupPairs.pairId, c.pairId))),
        auditEntry({
          actorId,
          action: "partner_change.start",
          target: `partner_change:${c.id}`,
          detail: sql`${`pair:${c.pairId} -> pair:`} || ${newPair} || ${`; phase ${phase}`}`,
          leagueId: c.leagueId,
        }),
      ]);
      started++;
    } catch (e) {
      if (!/NOT NULL|UNIQUE/i.test(`${e} ${(e as Error)?.cause ?? ""}`)) throw e;
      await endUnstarted(c, actorId, now);
    }
  }
  return started;
}

// A final change that can't start at its switch, or an accepted one whose
// old pair is gone (#416: it would hold the new partner until a decision
// that can't come): ended (status "undone", by
// the publishing organizer, audited), its marks on matches still open go,
// and the three players are told in the app and by push. The old pair plays
// on as it is.
async function endUnstarted(c: ChangeRow, actorId: string | null, now: Date): Promise<void> {
  logWarn("partner change could not start", { changeId: c.id });
  const [done] = await db.batch([
    db
      .update(partnerChanges)
      .set({ status: "undone", endedBy: actorId, endedAt: now })
      .where(and(eq(partnerChanges.id, c.id), inArray(partnerChanges.status, ["accepted", "final"])))
      .returning({ id: partnerChanges.id }),
    auditIfChanged({ actorId, action: "partner_change.undo", target: `partner_change:${c.id}`, detail: `pair:${c.pairId}; could not start`, leagueId: c.leagueId }),
    marksStillOpen(c.id, now),
  ]);
  if (done.length === 0) return;
  const league = await leagueSlug(c.leagueId);
  await notifyPlayers(
    "partner_change",
    [c.startedBy, c.leavingId, c.partnerId].map((userId) => ({
      userId,
      message: partnerChangeMessage({ kind: "not_started", league, staying: c.stayingName, leaving: c.leavingName, partner: c.partnerName }),
    })),
  );
}


/**
 * After a round switch publish (#402 req 6): a final change that starts at
 * a later switch (made after this one's draft) keeps the new partner on the
 * old pair's new matches too.
 */
export async function markChangesAfterPublish(seasonId: number, phase: number, now = new Date()): Promise<void> {
  const rows = await changesQuery().where(
    and(eq(partnerChanges.seasonId, seasonId), eq(partnerChanges.status, "final"), sql`coalesce(${partnerChanges.startsPhase}, 1000) > ${phase}`),
  );
  for (const c of rows) {
    const marked = await markRemaining(c, phase, now);
    await tellOpponents(c, marked, false);
  }
}
