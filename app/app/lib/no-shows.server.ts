import {
  confirmRefusal,
  noShowClosesAt,
  noShowOutcome,
  rejectRefusal,
  reportRefusal,
  reportWithdrawalRefusal,
  type NoShowStatus,
  type Side,
} from "@padel-liga/rules";
import { and, asc, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { groups, matchDecisions, matches, noShowReports, pairs, seasons, users } from "~/db/schema";
import { auditEntry, auditIfChanged } from "~/lib/audit.server";
import { logError, logInfo } from "~/lib/log";
import { noShowDecidedMessage } from "~/lib/notifications";
import { notifyNoShowReported, notifyPlayers } from "~/lib/notifications.server";

import { SIDES } from "./decisions.server";
import { pairName } from "./groups";
import { loadMatch, NOT_FOUND, noWithdrawnPair, sideOf, type MatchContext } from "./matches.server";
import { NO_SHOW_CHANGED, NO_SHOW_REASON_MAX, NO_SHOW_REFUSALS, noShowDecisionReason } from "./no-shows";
import { lostRace } from "./results.server";
import { neutralOutcomeText } from "./results";
import { strikeInserts, tellStruck, type StrikeGrant } from "./strikes.server";

// No-shows (#33, spec 8, D108) in D1. A player of the pair that showed up
// reports from the match page, after the agreed slot's start and before the
// deadline resolution runs, that the other pair didn't come; one waiting
// report per match, and the reporter can withdraw it before a decision. The
// league's organizer confirms it (a 4-0 4-0 walkover for the reporting pair,
// stored as an organizer's ruling so the tables read it, and a strike with
// source "no_show" for the other pair's two players, never a substitute) or
// rejects it, with an optional reason; each decision writes an audit entry
// (D91). The deadline resolution (deadline.server.ts) leaves a match with a
// waiting report to the organizer. Notices are in the app and by push only,
// never by email (D83). Names only: no email or phone leaves this module.

export type StepResult = { ok: true; notice: string } | { ok: false; error: string; notFound?: true };

const NAMELESS = "Törölt játékos";

type ReportRow = {
  id: number;
  pairId: number;
  status: NoShowStatus;
  reportedBy: string | null;
  reportedAt: Date;
  decidedAt: Date | null;
  reason: string | null;
};

async function reportsOf(matchId: number): Promise<ReportRow[]> {
  return db
    .select({
      id: noShowReports.id,
      pairId: noShowReports.pairId,
      status: noShowReports.status,
      reportedBy: noShowReports.reportedBy,
      reportedAt: noShowReports.reportedAt,
      decidedAt: noShowReports.decidedAt,
      reason: noShowReports.reason,
    })
    .from(noShowReports)
    .where(eq(noShowReports.matchId, matchId))
    .orderBy(desc(noShowReports.id));
}

const openOf = (rows: readonly ReportRow[]) => rows.find((r) => r.status === "open") ?? null;

const refusalOf = (ctx: MatchContext, rows: readonly ReportRow[], now: Date) =>
  reportRefusal(
    { voided: ctx.voided, status: ctx.match.status, scheduledAt: ctx.match.scheduledAt, deadline: ctx.match.deadline, openReport: openOf(rows) !== null },
    now,
  );

// --- The match page ------------------------------------------------------------

export type NoShowPanel = {
  // The "Nem jöttek el" button: the slot started, the round isn't resolved, no report waits.
  canReport: boolean;
  closesAt: Date;
  // The waiting report, to both pairs: `ours` when this pair made it.
  open: { id: number; ours: boolean; at: Date; canWithdraw: boolean } | null;
  // The organizer's decisions, newest first, with the reason: both pairs see them.
  decided: { id: number; ours: boolean; confirmed: boolean; at: Date; reason: string | null }[];
};

export async function noShowPanel(ctx: MatchContext, side: Side, userId: string, now = new Date()): Promise<NoShowPanel> {
  const rows = await reportsOf(ctx.match.id);
  const ourPair = ctx.pairs[side].pairId;
  // A match made final meanwhile (auto-accept, an override) leaves nothing waiting.
  const open = ctx.match.status === "final" ? null : openOf(rows);
  return {
    canReport: refusalOf(ctx, rows, now) === null,
    closesAt: noShowClosesAt(ctx.match.deadline),
    open: open && { id: open.id, ours: open.pairId === ourPair, at: open.reportedAt, canWithdraw: reportWithdrawalRefusal(open, userId) === null },
    decided: rows
      .filter((r) => r.status === "confirmed" || r.status === "rejected")
      .map((r) => ({ id: r.id, ours: r.pairId === ourPair, confirmed: r.status === "confirmed", at: r.decidedAt ?? r.reportedAt, reason: r.reason })),
  };
}

// The insert fails (NOT NULL) when the match took a step since it was read,
// and the partial unique index refuses a second waiting report.
const lostReport = (e: unknown) =>
  /NOT NULL constraint failed: no_show_reports\.match_id|UNIQUE constraint failed: no_show_reports/i.test(`${e} ${(e as Error)?.cause ?? ""}`);

const guardedMatch = (matchId: number, revision: number) =>
  sql<number>`(select ${matches.id} from ${matches} where ${matches.id} = ${matchId} and ${matches.revision} = ${revision})`;

/** A player of the match reports that the other pair didn't show up at the agreed slot. */
export async function reportNoShow(userId: string, matchId: number, now = new Date()): Promise<StepResult> {
  const ctx = await loadMatch(matchId);
  if (!ctx) return { ok: false, error: NOT_FOUND, notFound: true };
  const side = sideOf(ctx, userId);
  if (!side) return { ok: false, error: NOT_FOUND, notFound: true };
  const refusal = refusalOf(ctx, await reportsOf(matchId), now);
  if (refusal) return { ok: false, error: NO_SHOW_REFUSALS[refusal] };
  try {
    await db.insert(noShowReports).values({
      matchId: guardedMatch(matchId, ctx.match.revision),
      pairId: ctx.pairs[side].pairId,
      status: "open",
      reportedBy: userId,
      reportedAt: now,
    });
  } catch (e) {
    if (lostReport(e)) return { ok: false, error: NO_SHOW_CHANGED };
    throw e;
  }
  logInfo("no-show reported", { matchId });
  await notifyNoShowReported({ matchId, leagueId: ctx.leagueId, leagueSlug: ctx.leagueSlug, leagueName: ctx.league, week: ctx.match.week, reportedBy: userId });
  return { ok: true, notice: "Elküldtük a szervezőnek. Szólunk, ha döntött." };
}

/** The reporting player takes back their report while it waits. */
export async function withdrawNoShow(userId: string, matchId: number, reportId: number): Promise<StepResult> {
  const ctx = await loadMatch(matchId);
  if (!ctx || !sideOf(ctx, userId)) return { ok: false, error: NOT_FOUND, notFound: true };
  const row = (await reportsOf(matchId)).find((r) => r.id === reportId);
  if (!row) return { ok: false, error: NOT_FOUND, notFound: true };
  const refusal = reportWithdrawalRefusal(row, userId);
  if (refusal) return { ok: false, error: NO_SHOW_REFUSALS[refusal] };
  const done = await db
    .update(noShowReports)
    .set({ status: "withdrawn" })
    .where(and(eq(noShowReports.id, reportId), eq(noShowReports.status, "open")))
    .returning({ id: noShowReports.id });
  if (done.length === 0) return { ok: false, error: NO_SHOW_CHANGED };
  logInfo("no-show withdrawn", { matchId });
  return { ok: true, notice: "Visszavontad a bejelentést." };
}

// --- The organizer's side ----------------------------------------------------------

export type NoShowReport = {
  id: number;
  matchId: number;
  season: string;
  phase: number;
  groupNumber: number;
  week: number;
  // The pair that reported it, and the pair it says didn't come.
  reporting: string;
  absent: string;
  // The same pairs' players, for the Admin's links to their profiles (#301).
  reportingPlayers: { id: string; name: string }[];
  absentPlayers: { id: string; name: string }[];
  slot: Date | null;
  reportedAt: Date;
};

const ra = alias(users, "ns_ra");
const rb = alias(users, "ns_rb");
const reportingPair = alias(pairs, "ns_pair");
const absentPair = alias(pairs, "ns_absent_pair");
const aa = alias(users, "ns_aa");
const ab = alias(users, "ns_ab");

/**
 * The league's waiting reports, oldest first, for its organizer (Viták and
 * the decision page). A withdrawn pair's match (#34) is left out: it doesn't
 * count, so nothing there is decided.
 */
export async function leagueNoShows(leagueId: number, matchId?: number): Promise<NoShowReport[]> {
  const rows = await db
    .select({
      id: noShowReports.id,
      matchId: matches.id,
      season: seasons.name,
      phase: groups.phase,
      groupNumber: groups.number,
      week: matches.week,
      raId: ra.id,
      ra: ra.name,
      rbId: rb.id,
      rb: rb.name,
      aaId: aa.id,
      aa: aa.name,
      abId: ab.id,
      ab: ab.name,
      slot: matches.scheduledAt,
      reportedAt: noShowReports.reportedAt,
    })
    .from(noShowReports)
    .innerJoin(matches, eq(matches.id, noShowReports.matchId))
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .innerJoin(reportingPair, eq(reportingPair.id, noShowReports.pairId))
    .innerJoin(ra, eq(ra.id, reportingPair.playerA))
    .innerJoin(rb, eq(rb.id, reportingPair.playerB))
    .innerJoin(absentPair, sql`${absentPair.id} = case when ${matches.pairA} = ${noShowReports.pairId} then ${matches.pairB} else ${matches.pairA} end`)
    .innerJoin(aa, eq(aa.id, absentPair.playerA))
    .innerJoin(ab, eq(ab.id, absentPair.playerB))
    .where(
      and(
        eq(seasons.leagueId, leagueId),
        isNotNull(groups.publishedAt),
        eq(noShowReports.status, "open"),
        // A match made final meanwhile (auto-accept, an override): nothing left to decide.
        ne(matches.status, "final"),
        noWithdrawnPair,
        matchId === undefined ? undefined : eq(matches.id, matchId),
      ),
    )
    .orderBy(asc(noShowReports.reportedAt), asc(noShowReports.id));
  return rows.map((r) => ({
    id: r.id,
    matchId: r.matchId,
    season: r.season,
    phase: r.phase,
    groupNumber: r.groupNumber,
    week: r.week,
    reporting: pairName([{ name: r.ra || NAMELESS }, { name: r.rb || NAMELESS }]),
    absent: pairName([{ name: r.aa || NAMELESS }, { name: r.ab || NAMELESS }]),
    reportingPlayers: [
      { id: r.raId, name: r.ra || NAMELESS },
      { id: r.rbId, name: r.rb || NAMELESS },
    ],
    absentPlayers: [
      { id: r.aaId, name: r.aa || NAMELESS },
      { id: r.abId, name: r.ab || NAMELESS },
    ],
    slot: r.slot,
    reportedAt: r.reportedAt,
  }));
}

export type NoShowDecision = "confirm" | "reject";

const NOT_IN_LEAGUE = "Nincs ilyen bejelentés ebben a ligában.";

/**
 * The league's organizer confirms or rejects a waiting report (optional
 * reason, at most NO_SHOW_REASON_MAX characters), with an audit entry in the
 * same batch. A confirmation also stores the walkover as the organizer's
 * ruling (the match final, guarded by its revision and the report still
 * waiting) and the absent pair's two players' strikes, all in one batch;
 * the strike notices then go out as giveStrikes sends them (tellStruck).
 * Then both pairs are told in the app and by push.
 */
export async function decideNoShow(
  userId: string,
  leagueId: number,
  reportId: number,
  decision: NoShowDecision,
  reason: string,
  now = new Date(),
): Promise<StepResult> {
  const [found] = await db
    .select({ matchId: noShowReports.matchId, leagueId: seasons.leagueId })
    .from(noShowReports)
    .innerJoin(matches, eq(matches.id, noShowReports.matchId))
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .where(eq(noShowReports.id, reportId));
  if (!found || found.leagueId !== leagueId) return { ok: false, error: NOT_IN_LEAGUE, notFound: true };
  const row = (await reportsOf(found.matchId)).find((r) => r.id === reportId)!;
  const ctx = await loadMatch(found.matchId);
  if (!ctx) return { ok: false, error: NOT_IN_LEAGUE, notFound: true };
  const text = reason.trim();
  if (text.length > NO_SHOW_REASON_MAX) return { ok: false, error: `Az indoklás legfeljebb ${NO_SHOW_REASON_MAX} karakter lehet.` };
  const refusal = decision === "confirm" ? confirmRefusal(row, { voided: ctx.voided, status: ctx.match.status }) : rejectRefusal(row);
  if (refusal) return { ok: false, error: NO_SHOW_REFUSALS[refusal] };

  const reporting: Side = row.pairId === ctx.match.pairA ? "a" : "b";
  const settle = db
    .update(noShowReports)
    .set({ status: decision === "confirm" ? "confirmed" : "rejected", decidedBy: userId, decidedAt: now, reason: text || null })
    .where(and(eq(noShowReports.id, reportId), eq(noShowReports.status, "open")))
    .returning({ id: noShowReports.id });
  // The pairs as A/B, never names (D91): "<reporting> jelentette".
  const detail = `${SIDES[reporting]} jelentette`;

  if (decision === "reject") {
    const [changed] = await db.batch([settle, auditIfChanged({ actorId: userId, action: "match.no_show_reject", target: `match:${ctx.match.id}`, detail, leagueId })]);
    if (changed.length === 0) return { ok: false, error: NO_SHOW_CHANGED };
    await tellPairs(ctx, row.pairId, false);
    return { ok: true, notice: "Elutasítottad a bejelentést. Mindkét pár értesítést kap." };
  }

  const { outcome, absent } = noShowOutcome(reporting);
  const revision = ctx.match.revision;
  // The absent pair's own two players, never a substitute (spec 8).
  const absentPair = ctx.pairs[absent];
  const grant: StrikeGrant = {
    seasonId: ctx.seasonId,
    pairId: absentPair.pairId,
    players: absentPair.players.map((p) => p.id),
    matchId: ctx.match.id,
    source: "no_show",
    at: now,
  };
  // The ruling goes in only while the match took no step since it was read
  // and the report still waits; else the whole batch fails and nothing changes.
  const guardedId = sql<number>`(select ${matches.id} from ${matches} where ${matches.id} = ${ctx.match.id} and ${matches.revision} = ${revision}
    and exists (select 1 from ${noShowReports} where ${noShowReports.id} = ${reportId} and ${noShowReports.status} = 'open'))`;
  try {
    await db.batch([
      db.insert(matchDecisions).values({ matchId: guardedId, kind: "organizer", userId, outcome, reason: noShowDecisionReason(text), at: now }),
      db
        .update(matches)
        .set({ revision: revision + 1, status: "final", outcome })
        .where(and(eq(matches.id, ctx.match.id), eq(matches.revision, revision))),
      settle,
      auditEntry({ actorId: userId, action: "match.no_show_confirm", target: `match:${ctx.match.id}`, detail: `${detail}: ${neutralOutcomeText(outcome, SIDES)}`, leagueId }),
      // The strikes go in with the walkover, or neither does (#294's rows).
      ...strikeInserts([grant]),
    ]);
  } catch (e) {
    if (lostRace(e)) return { ok: false, error: NO_SHOW_CHANGED };
    throw e;
  }
  logInfo("no-show confirmed", { matchId: ctx.match.id });
  // Each player's count and notice as giveStrikes sends them (the 2nd strike's warning too).
  try {
    await tellStruck(grant, new Set(grant.players));
  } catch (error) {
    logError("no-show strike notice failed", { matchId: ctx.match.id, error });
  }
  await tellPairs(ctx, row.pairId, true);
  return { ok: true, notice: "Jóváhagytad: 4:0, 4:0 a bejelentő párnak, a másik pár fekete pontot kapott. Mindkét pár értesítést kap." };
}

// spec 13, D108: both pairs, each from its own side. In the app and by push only.
async function tellPairs(ctx: MatchContext, reportingPairId: number, confirmed: boolean): Promise<void> {
  try {
    await notifyPlayers(
      confirmed ? "no_show_confirmed" : "no_show_rejected",
      (["a", "b"] as const).flatMap((s) =>
        ctx.pairs[s].players.map((p) => ({
          userId: p.id,
          message: noShowDecidedMessage({ matchId: ctx.match.id, confirmed, reported: ctx.pairs[s].pairId === reportingPairId }),
        })),
      ),
    );
  } catch (error) {
    logError("no-show notification failed", { matchId: ctx.match.id, error });
  }
}
