import { absenceClosesAt, absenceOpen, markRefusal, resultAbsences, unmarkRefusal, type Side } from "@padel-liga/rules";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { matchAbsences, matches, partnerChanges, users } from "~/db/schema";
import { logError, logInfo } from "~/lib/log";
import { absenceMarkedMessage, type Message } from "~/lib/notifications";
import { notifyPlayers } from "~/lib/notifications.server";

import { loadMatch, NOT_FOUND, sideOf, type MatchContext } from "./matches.server";
import { chunks } from "./result-log.server";
import { ABSENCE_CHANGED, ABSENCE_REFUSALS } from "./substitutes";

// Temporary substitutes (#400, spec 4, D175) in D1: a pair marks which of its
// players doesn't play a match, and anyone (no account needed) plays
// instead. No name, no approval. Either player of a pair marks one of the
// pair on the match page before the match (its agreed start, or the deadline
// while none is agreed) and can take the mark back until then; after a
// sudden injury the pair that records the result ticks it on the result
// form, and the opponents confirm it with the result. The absent player's
// Elo doesn't change for that match (elo.server.ts). Notices go to the
// match's other three players, in the app and by push only, never by email
// (D83). Players' own steps: no audit entry (D91 is for organizers).

export type StepResult = { ok: true; notice: string } | { ok: false; error: string; notFound?: true };

const NAMELESS = "Törölt játékos";

// `substitute`: the new partner of the permanent partner change that made
// the mark (#402, D178), by name; null for a pair's own mark (no name, #400).
export type AbsenceMark = { pairId: number; absentId: string; name: string; afterMatch: boolean; substitute: string | null };

const changePartner = alias(users, "absence_change_partner");

/** The marks of these matches, by match. */
export async function absencesOf(matchIds: readonly number[]): Promise<Map<number, AbsenceMark[]>> {
  const out = new Map<number, AbsenceMark[]>();
  for (const ids of chunks([...new Set(matchIds)])) {
    if (ids.length === 0) continue;
    const rows = await db
      .select({
        matchId: matchAbsences.matchId,
        pairId: matchAbsences.pairId,
        absentId: matchAbsences.absentId,
        name: users.name,
        afterMatch: matchAbsences.afterMatch,
        substitute: changePartner.name,
        substituteDeleted: changePartner.deletedAt,
      })
      .from(matchAbsences)
      .innerJoin(users, eq(users.id, matchAbsences.absentId))
      .leftJoin(partnerChanges, eq(partnerChanges.id, matchAbsences.partnerChangeId))
      .leftJoin(changePartner, eq(changePartner.id, partnerChanges.partnerId))
      .where(inArray(matchAbsences.matchId, ids))
      .orderBy(asc(matchAbsences.id));
    for (const { matchId, substituteDeleted, ...r } of rows)
      out.set(matchId, [
        ...(out.get(matchId) ?? []),
        { ...r, name: r.name || NAMELESS, substitute: r.substitute === null ? null : substituteDeleted ? NAMELESS : r.substitute || "Névtelen" },
      ]);
  }
  return out;
}

const marksOf = async (matchId: number) => (await absencesOf([matchId])).get(matchId) ?? [];

/**
 * The marks of one match for the organizer's match and decision pages:
 * `played` once the match was played or its start passed (the window is
 * closed), as the four players read it on the match page.
 */
export async function organizerAbsences(matchId: number, now = new Date()): Promise<{ id: string; name: string; played: boolean; substitute: string | null }[]> {
  const ctx = await loadMatch(matchId);
  if (!ctx) return [];
  const { open } = windowOf(ctx.match, ctx.voided, now);
  return (await marksOf(matchId)).map((m) => ({ id: m.absentId, name: m.name, played: m.afterMatch || !open, substitute: m.substitute }));
}

// The window of a match from its mirrored status (matches.server keeps
// scheduled_at in step with the log): before the agreed start, or the
// deadline while none is agreed; closed once a result is recorded.
function windowOf(m: { status: string; scheduledAt: Date | null; deadline: Date }, voided: boolean, now: Date) {
  const closesAt = absenceClosesAt({ scheduledAt: m.status === "scheduled" ? m.scheduledAt : null, deadline: m.deadline });
  const hasResult = m.status !== "open" && m.status !== "scheduled";
  return { closesAt, open: absenceOpen({ closesAt, hasResult, voided }, now) };
}

// The insert's match_id, only while the match is still at `revision`:
// otherwise it comes out null, NOT NULL fails and nothing is written.
const guardedMatch = (matchId: number, revision: number) =>
  sql<number>`(select ${matches.id} from ${matches} where ${matches.id} = ${matchId} and ${matches.revision} = ${revision})`;

export const absenceLostRace = (e: unknown) =>
  /NOT NULL constraint failed: match_absences\.match_id|UNIQUE constraint failed: match_absences/i.test(`${e} ${(e as Error)?.cause ?? ""}`);

// --- The match page ------------------------------------------------------------

type Person = { id: string; name: string };

export type AbsencePanel = {
  open: boolean;
  closesAt: Date;
  // Every mark of both pairs: all four players see them.
  marked: { absentId: string; name: string; ours: boolean; afterMatch: boolean; canUnmark: boolean; substitute: string | null }[];
  // While the window is open: the own pair's players not marked yet.
  form: Person[] | null;
  // The result form's ticks (#400), while this pair can record the result:
  // its two players, each ticked if marked now.
  resultForm: (Person & { marked: boolean })[] | null;
};

/**
 * The match page's Helyettes part for a player of `side`. `canRecord`: this
 * pair can record (or correct) the result now, so the result form offers
 * the ticks.
 */
export async function absencePanel(ctx: MatchContext, side: Side, now = new Date(), canRecord = false): Promise<AbsencePanel> {
  const ours = ctx.pairs[side];
  const { open, closesAt } = windowOf(ctx.match, ctx.voided, now);
  const marks = await marksOf(ctx.match.id);
  const markedIds = new Set(marks.map((m) => m.absentId));
  const players = ours.players.map((p) => ({ id: p.id, name: p.name }));
  const free = players.filter((p) => !markedIds.has(p.id));
  return {
    open,
    closesAt,
    marked: marks.map((m) => ({ ...m, ours: m.pairId === ours.pairId, canUnmark: open && m.pairId === ours.pairId })),
    form: open && free.length > 0 ? free : null,
    resultForm: canRecord && !ctx.voided ? players.map((p) => ({ ...p, marked: markedIds.has(p.id) })) : null,
  };
}

/** A mark of one player on one match, for a batch (#402 marks the leaving player on every remaining match). */
export type AbsenceInput = {
  matchId: number;
  // The match's revision when it was read: nothing is written if it moved on.
  revision: number;
  pairId: number;
  absentId: string;
  markedBy: string | null;
  afterMatch: boolean;
  now: Date;
  // The permanent partner change that marks it (#402), if any.
  partnerChangeId?: number | null;
};

export function absenceInsert(a: AbsenceInput) {
  return db.insert(matchAbsences).values({
    matchId: guardedMatch(a.matchId, a.revision),
    pairId: a.pairId,
    absentId: a.absentId,
    markedBy: a.markedBy,
    markedAt: a.now,
    afterMatch: a.afterMatch,
    partnerChangeId: a.partnerChangeId ?? null,
  });
}

/**
 * Marks one player as not playing one match, on its own (#402 calls it for
 * each remaining match of a leaving player). The caller has checked who may
 * (markRefusal). False when the match moved on since `revision`, or the
 * player is already marked on it: nothing is written.
 */
export async function markAbsent(a: AbsenceInput): Promise<boolean> {
  try {
    await absenceInsert(a);
    return true;
  } catch (e) {
    if (absenceLostRace(e)) return false;
    throw e;
  }
}

// The match's other three players, besides `actorId`, with one message each.
async function tellOthers(ctx: MatchContext, actorId: string, message: Message): Promise<void> {
  const players = [...ctx.pairs.a.players, ...ctx.pairs.b.players].filter((p) => p.id !== actorId);
  try {
    await notifyPlayers(
      "absence_marked",
      players.map((p) => ({ userId: p.id, message })),
    );
  } catch (error) {
    logError("absence notification failed", { matchId: ctx.match.id, error });
  }
}

async function playerStep(userId: string, matchId: number, absentId: string, now: Date, kind: "mark" | "unmark"): Promise<StepResult> {
  const ctx = await loadMatch(matchId);
  if (!ctx) return { ok: false, error: NOT_FOUND, notFound: true };
  const side = sideOf(ctx, userId);
  if (!side) return { ok: false, error: NOT_FOUND, notFound: true };
  const pair = ctx.pairs[side];
  const { open } = windowOf(ctx.match, ctx.voided, now);
  const marks = await marksOf(matchId);
  const check = { open, pair: pair.players.map((p) => p.id), absentId, marked: marks.map((m) => m.absentId) };
  const refusal = kind === "mark" ? markRefusal(check) : unmarkRefusal(check);
  if (refusal) return { ok: false, error: ABSENCE_REFUSALS[refusal] };
  const name = pair.players.find((p) => p.id === absentId)?.name || NAMELESS;
  if (kind === "mark") {
    const done = await markAbsent({ matchId, revision: ctx.match.revision, pairId: pair.pairId, absentId, markedBy: userId, afterMatch: false, now });
    if (!done) return { ok: false, error: ABSENCE_CHANGED };
  } else {
    const removed = await db
      .delete(matchAbsences)
      .where(
        and(
          eq(matchAbsences.matchId, matchId),
          eq(matchAbsences.absentId, absentId),
          sql`exists (select 1 from ${matches} where ${matches.id} = ${matchId} and ${matches.revision} = ${ctx.match.revision})`,
        ),
      )
      .returning({ id: matchAbsences.id });
    if (removed.length === 0) return { ok: false, error: ABSENCE_CHANGED };
  }
  logInfo(kind === "mark" ? "absence marked" : "absence unmarked", { matchId });
  await tellOthers(ctx, userId, absenceMarkedMessage({ matchId, name, withdrawn: kind === "unmark" }));
  return kind === "mark"
    ? { ok: true, notice: "Rendben, helyettes jön helyette. A többiek is látják." }
    : { ok: true, notice: "Visszavontad: mégis ő játszik." };
}

/** A player of the match marks a player of their own pair as not playing it, before the match. */
export const markAbsence = (userId: string, matchId: number, absentId: string, now = new Date()) => playerStep(userId, matchId, absentId, now, "mark");

/** A player of the pair takes a mark back, before the match. */
export const unmarkAbsence = (userId: string, matchId: number, absentId: string, now = new Date()) => playerStep(userId, matchId, absentId, now, "unmark");

// --- The result form (#400) --------------------------------------------------------

/**
 * The marks of the recording pair's players the result form ticks: exactly
 * those (resultAbsences), so a correction can add or drop one, also one
 * from before the match. The statements go in the result's batch, guarded
 * by the match's revision like the result itself. `added`: the names newly
 * marked, for the notice.
 */
export async function resultAbsenceSteps(
  ctx: MatchContext,
  side: Side,
  userId: string,
  ticked: readonly string[],
  now: Date,
): Promise<{ statements: BatchItem<"sqlite">[]; added: string[] }> {
  const pair = ctx.pairs[side];
  const ids = pair.players.map((p) => p.id);
  const current = (await marksOf(ctx.match.id)).map((m) => m.absentId);
  const { add, remove } = resultAbsences(ids, current, ticked);
  const revision = ctx.match.revision;
  const guard = sql`exists (select 1 from ${matches} where ${matches.id} = ${ctx.match.id} and ${matches.revision} = ${revision})`;
  const statements: BatchItem<"sqlite">[] = [
    ...remove.map((absentId) =>
      db.delete(matchAbsences).where(and(eq(matchAbsences.matchId, ctx.match.id), eq(matchAbsences.absentId, absentId), guard)),
    ),
    ...add.map((absentId) => absenceInsert({ matchId: ctx.match.id, revision, pairId: pair.pairId, absentId, markedBy: userId, afterMatch: true, now })),
  ];
  return { statements, added: add.map((id) => pair.players.find((p) => p.id === id)?.name || NAMELESS) };
}

/** After the result went in: the other three are told who didn't play (#400). */
export async function tellResultAbsences(ctx: MatchContext, userId: string, added: readonly string[]): Promise<void> {
  for (const name of added) await tellOthers(ctx, userId, absenceMarkedMessage({ matchId: ctx.match.id, name, played: true }));
}
