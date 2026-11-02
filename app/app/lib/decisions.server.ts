import { decisionErrors, type MatchOutcome, type ResultState, type Side } from "@padel-liga/rules";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { groups, matchDecisions, matches, pairs, seasons, users } from "~/db/schema";
import { matchDecidedMessage } from "~/lib/notifications";
import { notifyPlayers } from "~/lib/notifications.server";

import { pairName } from "./groups";
import { eventText } from "./matches";
import { CHANGED, loadMatch } from "./matches.server";
import { resultOf, resultsOf } from "./result-log.server";
import { neutralDecisionText, neutralOutcomeText, neutralScoreText, outcomeText, resultEventText } from "./results";

// The organizer's side of results (#29): the league's disputes and matches,
// one match with both pairs' versions and its log, and a decision or override
// with a required reason. Names only: no email or phone leaves this module.
// The caller checks the league permission (league.manage); every function
// here also checks that the match belongs to that league, so a hand-made
// request with another league's match id finds nothing.

const NOT_IN_LEAGUE = "Nincs ilyen meccs ebben a ligában.";

const pa = alias(users, "pa_user");
const pb = alias(users, "pb_user");

async function pairNames(ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: pairs.id, a: pa.name, b: pb.name })
    .from(pairs)
    .innerJoin(pa, eq(pa.id, pairs.playerA))
    .innerJoin(pb, eq(pb.id, pairs.playerB))
    .where(inArray(pairs.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, pairName([{ name: r.a }, { name: r.b }])]));
}

// The league of a match in a published group, or null.
async function leagueOf(matchId: number): Promise<number | null> {
  const [row] = await db
    .select({ leagueId: seasons.leagueId })
    .from(matches)
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .where(and(eq(matches.id, matchId), isNotNull(groups.publishedAt)));
  return row?.leagueId ?? null;
}

// --- The list (#29 requirement 1) ---------------------------------------------------

export type LeagueMatch = {
  id: number;
  season: string;
  phase: number;
  groupNumber: number;
  week: number;
  a: string;
  b: string;
  result: ResultState;
  // The status in a few words, for the organizer.
  label: string;
};

export type Dispute = LeagueMatch & {
  // Who recorded what, and the other pair's version (match order: a first).
  recordedBy: string;
  recorded: string;
  disputedBy: string;
  counter: string | null;
  disputedAt: Date;
};

function organizerLabel(m: { result: ResultState; status: string; a: string; b: string }): string {
  const r = m.result;
  switch (r.status) {
    case "recorded":
      return `Eredmény megerősítésre vár: ${neutralScoreText(r.score)}`;
    case "disputed":
      return "Vitatott eredmény";
    case "final":
      return `${r.how === "organizer" ? "Döntés" : "Lejátszva"}: ${neutralOutcomeText(r.outcome, m)}`;
    case "none":
      return m.status === "scheduled" ? "Lefixálva" : "Egyeztetés alatt";
  }
}

/**
 * Every match of the league's published groups, newest season first, then
 * by phase, group and week; and the disputed ones with both versions.
 */
export async function leagueMatches(leagueId: number): Promise<{ disputes: Dispute[]; matches: LeagueMatch[] }> {
  const rows = await db
    .select({
      id: matches.id,
      pairA: matches.pairA,
      pairB: matches.pairB,
      week: matches.week,
      status: matches.status,
      season: seasons.name,
      phase: groups.phase,
      groupNumber: groups.number,
    })
    .from(matches)
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .where(and(eq(seasons.leagueId, leagueId), isNotNull(groups.publishedAt)))
    .orderBy(desc(seasons.id), asc(groups.phase), asc(groups.number), asc(matches.week), asc(matches.id));
  const [names, results] = await Promise.all([pairNames(rows.flatMap((r) => [r.pairA, r.pairB])), resultsOf(rows)]);
  const list: LeagueMatch[] = rows.map((r) => {
    const a = names.get(r.pairA) ?? "";
    const b = names.get(r.pairB) ?? "";
    const result = results.get(r.id)?.state ?? { status: "none" };
    return { id: r.id, season: r.season, phase: r.phase, groupNumber: r.groupNumber, week: r.week, a, b, result, label: organizerLabel({ result, status: r.status, a, b }) };
  });
  const disputes = list.flatMap((m): Dispute[] => {
    const r = m.result;
    if (r.status !== "disputed") return [];
    const by = (s: Side) => (s === "a" ? m.a : m.b);
    return [
      {
        ...m,
        recordedBy: by(r.by),
        recorded: neutralScoreText(r.score),
        disputedBy: by(r.by === "a" ? "b" : "a"),
        counter: r.counter ? neutralScoreText(r.counter) : null,
        disputedAt: r.disputedAt,
      },
    ];
  });
  return { disputes, matches: list };
}

// --- One match (#29 requirements 1-4) ---------------------------------------------------

export type DecisionPage = {
  id: number;
  league: string;
  season: string;
  phase: number;
  groupNumber: number;
  week: number;
  deadline: Date;
  a: string;
  b: string;
  result: ResultState;
  label: string;
  // The disputing pair's note, if any.
  note: string | null;
  // The prefill of the form: the current outcome, or the recorded score.
  current: MatchOutcome | null;
  log: { key: string; at: Date; who: string; role: string; text: string }[];
};

/** A match of this league for its organizer; null if it isn't one. */
export async function decisionPage(leagueId: number, matchId: number): Promise<DecisionPage | null> {
  if ((await leagueOf(matchId)) !== leagueId) return null;
  const ctx = await loadMatch(matchId);
  if (!ctx) return null;
  const names = { a: pairName(ctx.pairs.a.players), b: pairName(ctx.pairs.b.players) };
  const results = await resultOf(ctx.match);
  const result = results.state;
  const pairLabel = (pairId: number) => (pairId === ctx.match.pairA ? "1. pár" : "2. pár");
  const log = [
    ...ctx.events.map((e) => ({
      key: `e${e.id}`,
      id: e.id,
      at: e.at,
      who: e.userName || "Törölt játékos",
      role: pairLabel(e.pairId),
      // The venue's name isn't needed here; the players' page has it.
      text: eventText({ kind: e.kind, slots: e.slots?.map((s) => new Date(s * 1000)) ?? null, slot: e.slot }),
    })),
    ...results.events.map((e) => ({
      key: `e${e.id}`,
      id: e.id,
      at: e.at,
      who: e.userName || "Törölt játékos",
      role: pairLabel(e.pairId),
      // In match order: "1. pár" first.
      text: resultEventText(e, "a"),
    })),
    ...results.decisions.map((d) => ({
      key: `d${d.id}`,
      id: Number.MAX_SAFE_INTEGER,
      at: d.at,
      who: d.kind === "auto_accepted" ? "Padelpárbaj" : d.userName || "Szervező",
      role: d.kind === "auto_accepted" ? "automatikus" : "szervező",
      text: neutralDecisionText(d, names),
    })),
  ]
    .sort((x, y) => x.at.getTime() - y.at.getTime() || x.id - y.id)
    .map(({ id: _, ...e }) => e);
  const note = [...results.events].reverse().find((e) => e.kind === "result_disputed")?.note ?? null;
  return {
    id: ctx.match.id,
    league: ctx.league,
    season: ctx.season,
    phase: ctx.phase,
    groupNumber: ctx.groupNumber,
    week: ctx.match.week,
    deadline: ctx.match.deadline,
    ...names,
    result,
    label: organizerLabel({ result, status: ctx.match.status, ...names }),
    note,
    current: result.status === "final" ? result.outcome : result.status === "none" ? null : { kind: "played", score: result.score },
    log,
  };
}

// --- Deciding (#29 requirements 2-5) ---------------------------------------------------

export type DecideResult = { ok: true; notice: string } | { ok: false; error: string; notFound?: true };

/**
 * The organizer sets the outcome of a match of their league, disputed or
 * not, played or not, with a required reason: a ruling in match_decisions
 * (with who and when), the match final with that outcome, and both pairs
 * told in the app and by push (a digest item, no instant email).
 */
export async function decideMatch(
  userId: string,
  leagueId: number,
  matchId: number,
  outcome: MatchOutcome,
  reason: string,
  now = new Date(),
): Promise<DecideResult> {
  if ((await leagueOf(matchId)) !== leagueId) return { ok: false, error: NOT_IN_LEAGUE, notFound: true };
  const ctx = await loadMatch(matchId);
  if (!ctx) return { ok: false, error: NOT_IN_LEAGUE, notFound: true };
  const errors = decisionErrors(outcome, reason);
  if (errors.length > 0) return { ok: false, error: errors.join(" ") };
  const revision = ctx.match.revision;
  try {
    await db.batch([
      db.insert(matchDecisions).values({
        matchId: sql<number>`(select ${matches.id} from ${matches} where ${matches.id} = ${matchId} and ${matches.revision} = ${revision})`,
        kind: "organizer",
        userId,
        outcome,
        reason: reason.trim(),
        at: now,
      }),
      db
        .update(matches)
        .set({ revision: revision + 1, status: "final", outcome })
        .where(and(eq(matches.id, matchId), eq(matches.revision, revision))),
    ]);
  } catch (e) {
    if (/NOT NULL constraint failed: match_decisions\.match_id/i.test(`${e} ${(e as Error)?.cause ?? ""}`)) return { ok: false, error: CHANGED };
    throw e;
  }
  try {
    await notifyPlayers(
      "match_decided",
      (["a", "b"] as const).flatMap((side) =>
        ctx.pairs[side].players.map((p) => ({ userId: p.id, message: matchDecidedMessage({ matchId, outcome: outcomeText(outcome, side) }) })),
      ),
    );
  } catch (error) {
    console.error(`match ${matchId} decision notification failed`, error);
  }
  return { ok: true, notice: "Elmentettük a döntést. Mindkét pár értesítést kap." };
}
