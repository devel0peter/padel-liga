import {
  approvalRefusal,
  currentElo,
  isLiveSubstitute,
  rejectionRefusal,
  requestRefusal,
  revocationRefusal,
  substituteClosesAt,
  substituteOpen,
  withdrawalRefusal,
  type Side,
  type SubstituteStatus,
} from "@padel-liga/rules";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { groups, matches, matchSubstitutes, pairs, seasons, users } from "~/db/schema";
import { auditIfChanged } from "~/lib/audit.server";
import { logError, logInfo } from "~/lib/log";
import { substituteAnnouncedMessage, substituteDecidedMessage, substituteRevokedMessage, type Message, type PlayerKind } from "~/lib/notifications";
import { notifyPlayers, notifySubstituteRequested } from "~/lib/notifications.server";

import { pairName } from "./groups";
import { memberOf } from "./league-members.server";
import { groupMembers, loadMatch, NOT_FOUND, noWithdrawnPair, sideOf, type MatchContext } from "./matches.server";
import { SUBSTITUTE_CHANGED, SUBSTITUTE_REASON_MAX, SUBSTITUTE_REFUSALS, substituteStatusLabel } from "./substitutes";

// Substitutes (#37, spec 4, D109) in D1. A player of either pair asks for a
// substitute for an absent player of their pair, from the match page, before
// the match starts (its agreed start, or the deadline while none is agreed);
// the asker can withdraw it while it waits. The league's organizer approves
// or rejects it (optional reason) and may revoke an approval until the start;
// each of those writes an audit entry (D91). Only an approved substitute
// changes who played (Elo, elo.server.ts). Notices are in the app and by push
// only, never by email (D83). Names only: no email or phone leaves this
// module, and the substitute gets no notice and no match page.

export type StepResult = { ok: true; notice: string } | { ok: false; error: string; notFound?: true };

const absentUser = alias(users, "sub_absent_user");
const substituteUser = alias(users, "sub_substitute_user");

const NAMELESS = "Törölt játékos";

type RequestRow = {
  id: number;
  matchId: number;
  pairId: number;
  absentId: string;
  substituteId: string;
  status: SubstituteStatus;
  requestedBy: string | null;
  reason: string | null;
  absentName: string;
  substituteName: string;
};

const requestColumns = {
  id: matchSubstitutes.id,
  matchId: matchSubstitutes.matchId,
  pairId: matchSubstitutes.pairId,
  absentId: matchSubstitutes.absentId,
  substituteId: matchSubstitutes.substituteId,
  status: matchSubstitutes.status,
  requestedBy: matchSubstitutes.requestedBy,
  reason: matchSubstitutes.reason,
  absentName: absentUser.name,
  substituteName: substituteUser.name,
};

async function requestsOf(matchId: number): Promise<RequestRow[]> {
  const rows = await db
    .select(requestColumns)
    .from(matchSubstitutes)
    .innerJoin(absentUser, eq(absentUser.id, matchSubstitutes.absentId))
    .innerJoin(substituteUser, eq(substituteUser.id, matchSubstitutes.substituteId))
    .where(eq(matchSubstitutes.matchId, matchId))
    .orderBy(desc(matchSubstitutes.id));
  return rows.map((r) => ({ ...r, absentName: r.absentName || NAMELESS, substituteName: r.substituteName || NAMELESS }));
}

// The window of a match from its mirrored status (matches.server keeps
// scheduled_at in step with the log): before the agreed start, or the
// deadline while none is agreed; closed once a result is recorded.
function windowOf(m: { status: string; scheduledAt: Date | null; deadline: Date }, voided: boolean, now: Date) {
  const closesAt = substituteClosesAt({ scheduledAt: m.status === "scheduled" ? m.scheduledAt : null, deadline: m.deadline });
  const hasResult = m.status !== "open" && m.status !== "scheduled";
  return { closesAt, open: substituteOpen({ closesAt, hasResult, voided }, now) };
}

const matchPlayersOf = (ctx: MatchContext) => [...ctx.pairs.a.players, ...ctx.pairs.b.players].map((p) => p.id);

// The players of the group's pairs that are not withdrawn (#34): they can't
// stand in for anyone in that group.
async function groupPlayersOf(groupId: number): Promise<Set<string>> {
  const members = (await groupMembers([groupId])).get(groupId) ?? [];
  return new Set(members.filter((p) => !p.withdrawn).flatMap((p) => p.players.map((x) => x.id)));
}

// The league's registered players (first-login page done, not deleted), by
// the D128 rule (league-members.server.ts), by name. No address leaves here.
async function leaguePlayers(leagueId: number): Promise<{ id: string; name: string }[]> {
  const accounts = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(isNotNull(users.consentAt), isNull(users.deletedAt), memberOf(leagueId, users.id)))
    .orderBy(asc(users.name), asc(users.id));
  return accounts.map(({ id, name }) => ({ id, name: name || "Névtelen" }));
}

const live = (rows: readonly RequestRow[]) => rows.filter((r) => isLiveSubstitute(r.status));

// --- The match page ------------------------------------------------------------

export type SubstitutePanel = {
  open: boolean;
  closesAt: Date;
  // Approved substitutes of both pairs: every player of the match sees them.
  approved: { id: number; ours: boolean; absent: string; substitute: string }[];
  // The own pair's requests not approved (waiting, rejected, withdrawn, revoked), newest first.
  ours: { id: number; absent: string; substitute: string; status: SubstituteStatus; label: string; reason: string | null; canWithdraw: boolean }[];
  // The form, while the window is open and a player of the pair has no live
  // request: whom to replace, and who may stand in.
  form: { absent: { id: string; name: string }[]; candidates: { id: string; name: string }[] } | null;
};

export async function substitutePanel(ctx: MatchContext, side: Side, userId: string, now = new Date()): Promise<SubstitutePanel> {
  const ours = ctx.pairs[side];
  const { open, closesAt } = windowOf(ctx.match, ctx.voided, now);
  const rows = await requestsOf(ctx.match.id);
  const taken = new Set(live(rows).map((r) => r.absentId));
  const absent = ours.players.filter((p) => !taken.has(p.id)).map((p) => ({ id: p.id, name: p.name }));
  let form: SubstitutePanel["form"] = null;
  if (open && absent.length > 0) {
    const excluded = new Set([...matchPlayersOf(ctx), ...(await groupPlayersOf(ctx.match.groupId)), ...live(rows).map((r) => r.substituteId)]);
    form = { absent, candidates: (await leaguePlayers(ctx.leagueId)).filter((p) => !excluded.has(p.id)) };
  }
  return {
    open,
    closesAt,
    approved: rows
      .filter((r) => r.status === "approved")
      .map((r) => ({ id: r.id, ours: r.pairId === ours.pairId, absent: r.absentName, substitute: r.substituteName })),
    // An approved one is in `approved` already.
    ours: rows
      .filter((r) => r.pairId === ours.pairId && r.status !== "approved")
      .map((r) => ({
        id: r.id,
        absent: r.absentName,
        substitute: r.substituteName,
        status: r.status,
        label: substituteStatusLabel(r.status, open),
        reason: r.status === "rejected" || r.status === "revoked" ? r.reason : null,
        canWithdraw: withdrawalRefusal(r, userId) === null,
      })),
    form,
  };
}

// The insert fails (NOT NULL) when the match took a step since it was read,
// and the unique index refuses a second live request for the same player.
const lostRace = (e: unknown) =>
  /NOT NULL constraint failed: match_substitutes\.match_id|UNIQUE constraint failed: match_substitutes/i.test(`${e} ${(e as Error)?.cause ?? ""}`);

const guardedMatch = (matchId: number, revision: number) =>
  sql<number>`(select ${matches.id} from ${matches} where ${matches.id} = ${matchId} and ${matches.revision} = ${revision})`;

/** A player of the match asks for a substitute for an absent player of their pair. */
export async function requestSubstitute(
  userId: string,
  matchId: number,
  input: { absentId: string; substituteId: string },
  now = new Date(),
): Promise<StepResult> {
  const ctx = await loadMatch(matchId);
  if (!ctx) return { ok: false, error: NOT_FOUND, notFound: true };
  const side = sideOf(ctx, userId);
  if (!side) return { ok: false, error: NOT_FOUND, notFound: true };
  if (!input.substituteId) return { ok: false, error: "Válaszd ki a helyettest a listából." };
  const pair = ctx.pairs[side];
  const { open } = windowOf(ctx.match, ctx.voided, now);
  const rows = await requestsOf(matchId);
  const refusal = requestRefusal({
    open,
    pair: pair.players.map((p) => p.id),
    absentId: input.absentId,
    matchPlayers: matchPlayersOf(ctx),
    groupPlayers: open ? await groupPlayersOf(ctx.match.groupId) : new Set(),
    registered: open && (await leaguePlayers(ctx.leagueId)).some((p) => p.id === input.substituteId),
    substituteId: input.substituteId,
    live: live(rows),
  });
  if (refusal) return { ok: false, error: SUBSTITUTE_REFUSALS[refusal] };
  try {
    await db.insert(matchSubstitutes).values({
      matchId: guardedMatch(matchId, ctx.match.revision),
      pairId: pair.pairId,
      absentId: input.absentId,
      substituteId: input.substituteId,
      status: "requested",
      requestedBy: userId,
      requestedAt: now,
    });
  } catch (e) {
    if (lostRace(e)) return { ok: false, error: SUBSTITUTE_CHANGED };
    throw e;
  }
  logInfo("substitute requested", { matchId });
  await notifySubstituteRequested({ leagueId: ctx.leagueId, leagueSlug: ctx.leagueSlug, leagueName: ctx.league, week: ctx.match.week, requestedBy: userId });
  return { ok: true, notice: "Elküldtük a kérést a szervezőnek. Szólunk, ha döntött." };
}

/** The asking player takes back their request while it waits. */
export async function withdrawSubstitute(userId: string, matchId: number, requestId: number): Promise<StepResult> {
  const ctx = await loadMatch(matchId);
  if (!ctx || !sideOf(ctx, userId)) return { ok: false, error: NOT_FOUND, notFound: true };
  const row = (await requestsOf(matchId)).find((r) => r.id === requestId);
  if (!row) return { ok: false, error: NOT_FOUND, notFound: true };
  const refusal = withdrawalRefusal(row, userId);
  if (refusal) return { ok: false, error: SUBSTITUTE_REFUSALS[refusal] };
  const done = await db
    .update(matchSubstitutes)
    .set({ status: "withdrawn" })
    .where(and(eq(matchSubstitutes.id, requestId), eq(matchSubstitutes.status, "requested")))
    .returning({ id: matchSubstitutes.id });
  if (done.length === 0) return { ok: false, error: SUBSTITUTE_CHANGED };
  return { ok: true, notice: "Visszavontad a kérést." };
}

// --- The organizer's list ----------------------------------------------------------

export type SubstituteRequest = {
  id: number;
  matchId: number;
  season: string;
  phase: number;
  groupNumber: number;
  week: number;
  // The asking pair and its opponents.
  pair: string;
  opponents: string;
  absent: { name: string; elo: number | null };
  substitute: { name: string; elo: number | null };
  status: SubstituteStatus;
  open: boolean;
  closesAt: Date;
  // The agreed start, or null while none is agreed (closesAt is the deadline).
  startsAt: Date | null;
};

const pa = alias(users, "sub_pa");
const pb = alias(users, "sub_pb");
const askingPair = alias(pairs, "sub_pair");
const otherPair = alias(pairs, "sub_other_pair");
const oa = alias(users, "sub_oa");
const ob = alias(users, "sub_ob");

/**
 * The league's live requests: waiting ones and approvals, with both players'
 * current Elo. Matches of a withdrawn pair (#34) are left out: they don't
 * count, so nothing there is decided. Only matches not started yet: a
 * waiting request then lapses, and an approval can no longer be revoked.
 */
export async function leagueSubstitutes(leagueId: number, now = new Date()): Promise<{ waiting: SubstituteRequest[]; approved: SubstituteRequest[] }> {
  const rows = await db
    .select({
      id: matchSubstitutes.id,
      matchId: matches.id,
      status: matchSubstitutes.status,
      matchStatus: matches.status,
      scheduledAt: matches.scheduledAt,
      deadline: matches.deadline,
      week: matches.week,
      season: seasons.name,
      phase: groups.phase,
      groupNumber: groups.number,
      pa: pa.name,
      pb: pb.name,
      oa: oa.name,
      ob: ob.name,
      absentName: absentUser.name,
      absentElo: absentUser.elo,
      absentLevel: absentUser.level,
      substituteName: substituteUser.name,
      substituteElo: substituteUser.elo,
      substituteLevel: substituteUser.level,
    })
    .from(matchSubstitutes)
    .innerJoin(matches, eq(matches.id, matchSubstitutes.matchId))
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .innerJoin(askingPair, eq(askingPair.id, matchSubstitutes.pairId))
    .innerJoin(pa, eq(pa.id, askingPair.playerA))
    .innerJoin(pb, eq(pb.id, askingPair.playerB))
    .innerJoin(otherPair, sql`${otherPair.id} = case when ${matches.pairA} = ${matchSubstitutes.pairId} then ${matches.pairB} else ${matches.pairA} end`)
    .innerJoin(oa, eq(oa.id, otherPair.playerA))
    .innerJoin(ob, eq(ob.id, otherPair.playerB))
    .innerJoin(absentUser, eq(absentUser.id, matchSubstitutes.absentId))
    .innerJoin(substituteUser, eq(substituteUser.id, matchSubstitutes.substituteId))
    .where(
      and(
        eq(seasons.leagueId, leagueId),
        isNotNull(groups.publishedAt),
        inArray(matchSubstitutes.status, ["requested", "approved"]),
        noWithdrawnPair,
      ),
    )
    .orderBy(asc(matches.deadline), asc(matchSubstitutes.id));
  const list = rows.map((r): SubstituteRequest => {
    const { open, closesAt } = windowOf({ status: r.matchStatus, scheduledAt: r.scheduledAt, deadline: r.deadline }, false, now);
    return {
      id: r.id,
      matchId: r.matchId,
      season: r.season,
      phase: r.phase,
      groupNumber: r.groupNumber,
      week: r.week,
      pair: pairName([{ name: r.pa || NAMELESS }, { name: r.pb || NAMELESS }]),
      opponents: pairName([{ name: r.oa || NAMELESS }, { name: r.ob || NAMELESS }]),
      absent: { name: r.absentName || NAMELESS, elo: currentElo(r.absentElo, r.absentLevel) },
      substitute: { name: r.substituteName || NAMELESS, elo: currentElo(r.substituteElo, r.substituteLevel) },
      status: r.status,
      open,
      closesAt,
      startsAt: r.matchStatus === "scheduled" ? r.scheduledAt : null,
    };
  });
  return {
    waiting: list.filter((r) => r.status === "requested" && r.open),
    approved: list.filter((r) => r.status === "approved" && r.open),
  };
}

// --- The organizer's decision --------------------------------------------------------

export type SubstituteDecision = "approve" | "reject" | "revoke";

const NOT_IN_LEAGUE = "Nincs ilyen kérés ebben a ligában.";

const ACTIONS = { approve: "substitute.approve", reject: "substitute.reject", revoke: "substitute.revoke" } as const;
const STATUS_AFTER = { approve: "approved", reject: "rejected", revoke: "revoked" } as const;
const STATUS_BEFORE = { approve: "requested", reject: "requested", revoke: "approved" } as const;
const NOTICES = {
  approve: "Jóváhagytad a helyettest. Mindkét pár értesítést kap.",
  reject: "Elutasítottad a kérést. A pár értesítést kap.",
  revoke: "Visszavontad a jóváhagyást. Mindkét pár értesítést kap.",
};

/**
 * The league's organizer approves, rejects or revokes a request (optional
 * reason, at most SUBSTITUTE_REASON_MAX characters), with an audit entry in
 * the same batch; then the pairs are told in the app and by push.
 */
export async function decideSubstitute(
  userId: string,
  leagueId: number,
  requestId: number,
  decision: SubstituteDecision,
  reason: string,
  now = new Date(),
): Promise<StepResult> {
  const [found] = await db
    .select({ matchId: matchSubstitutes.matchId, leagueId: seasons.leagueId })
    .from(matchSubstitutes)
    .innerJoin(matches, eq(matches.id, matchSubstitutes.matchId))
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .where(eq(matchSubstitutes.id, requestId));
  if (!found || found.leagueId !== leagueId) return { ok: false, error: NOT_IN_LEAGUE, notFound: true };
  const ctx = await loadMatch(found.matchId);
  if (!ctx) return { ok: false, error: NOT_IN_LEAGUE, notFound: true };
  const rows = await requestsOf(found.matchId);
  const row = rows.find((r) => r.id === requestId)!;
  const text = reason.trim();
  if (text.length > SUBSTITUTE_REASON_MAX) return { ok: false, error: `Az indoklás legfeljebb ${SUBSTITUTE_REASON_MAX} karakter lehet.` };
  const { open } = windowOf(ctx.match, ctx.voided, now);

  let refusal;
  if (decision === "approve")
    refusal = approvalRefusal({
      status: row.status,
      open,
      matchPlayers: matchPlayersOf(ctx),
      groupPlayers: await groupPlayersOf(ctx.match.groupId),
      registered: (await leaguePlayers(ctx.leagueId)).some((p) => p.id === row.substituteId),
      substituteId: row.substituteId,
      live: live(rows).filter((r) => r.id !== requestId),
    });
  else if (decision === "reject") refusal = rejectionRefusal(row.status);
  else refusal = revocationRefusal(row.status, open);
  if (refusal) return { ok: false, error: SUBSTITUTE_REFUSALS[refusal] };

  // Approving or revoking only while the match took no step since it was
  // read (its start may have moved); a rejection needs no such guard.
  const guard =
    decision === "reject" ? sql`1` : sql`exists (select 1 from ${matches} where ${matches.id} = ${ctx.match.id} and ${matches.revision} = ${ctx.match.revision})`;
  const [changed] = await db.batch([
    db
      .update(matchSubstitutes)
      .set({ status: STATUS_AFTER[decision], decidedBy: userId, decidedAt: now, reason: decision === "approve" ? null : text || null })
      .where(and(eq(matchSubstitutes.id, requestId), eq(matchSubstitutes.status, STATUS_BEFORE[decision]), guard))
      .returning({ id: matchSubstitutes.id }),
    // Ids, never names (D91): "<absent> -> <substitute>".
    auditIfChanged({
      actorId: userId,
      action: ACTIONS[decision],
      target: `match:${ctx.match.id}`,
      detail: `user:${row.absentId} -> user:${row.substituteId}`,
      leagueId,
    }),
  ]);
  if (changed.length === 0) return { ok: false, error: SUBSTITUTE_CHANGED };

  await tellPairs(ctx, row, decision);
  return { ok: true, notice: NOTICES[decision] };
}

// spec 13, D109: the asking pair on every decision, the opponents on an
// approval and a revocation. In the app and by push only.
async function tellPairs(ctx: MatchContext, row: RequestRow, decision: SubstituteDecision): Promise<void> {
  const asking = ctx.pairs.a.pairId === row.pairId ? ctx.pairs.a : ctx.pairs.b;
  const other = asking === ctx.pairs.a ? ctx.pairs.b : ctx.pairs.a;
  const notice = { matchId: ctx.match.id, substitute: row.substituteName, absent: row.absentName };
  const to = (players: { id: string }[], message: Message) => players.map((p) => ({ userId: p.id, message }));
  const send: [PlayerKind, { userId: string; message: Message }[]][] =
    decision === "approve"
      ? [["substitute_approved", [...to(asking.players, substituteDecidedMessage({ ...notice, approved: true })), ...to(other.players, substituteAnnouncedMessage(notice))]]]
      : decision === "reject"
        ? [["substitute_rejected", to(asking.players, substituteDecidedMessage({ ...notice, approved: false }))]]
        : [["substitute_revoked", [...to(asking.players, substituteRevokedMessage({ ...notice, ours: true })), ...to(other.players, substituteRevokedMessage({ ...notice, ours: false }))]]];
  try {
    for (const [kind, messages] of send) await notifyPlayers(kind, messages);
  } catch (error) {
    logError("substitute notification failed", { matchId: ctx.match.id, error });
  }
}
