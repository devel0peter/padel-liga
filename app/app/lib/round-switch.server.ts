import {
  changeAtSwitch,
  changeLeaveReason,
  isFastSwitch,
  leaveReason,
  optedOutAfter,
  roundSwitchDraft,
  type MatchOutcome,
  type PartnerChange,
} from "@padel-liga/rules";
import { and, asc, eq, gt, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { groups, jobRuns, leagues, matches, noShowReports, seasonEntries, seasonPhases, seasons } from "~/db/schema";
import type { RunBudget, Usage } from "~/lib/run-usage";

import { phaseProjection } from "./deadline-projection.server";
import { updateElo, ELO_REPLAY_QUERIES } from "./elo.server";
import { enteredPairs, type GroupPair, phaseGroups, publishPhase, writeDraft } from "./groups.server";
import { groupTable } from "./ladder";
import { markChangesAfterPublish, startChangesAtPublish, switchChanges, type SwitchChange } from "./partner-changes.server";
import { resultsOf } from "./result-log.server";
import { DISPUTES_FIRST, type LeaveReason, NOT_READY, NOTHING_TO_DRAFT, type Origin, OUTDATED_DRAFT } from "./round-switch";
import { averageElo } from "./season-entries";
import { getSeason } from "./seasons.server";
import { pairsLeavingAfterPhase } from "./strikes.server";

// The round switch (spec 10, #12, #35, D107). After a phase's deadline, once
// the deadline resolution has settled its unplayed matches (Monday from
// 06:00, deadline.server.ts), the cron drafts the next phase's groups from
// the ending phase's final tables (packages/rules roundSwitchDraft:
// promotion and relegation, the leavers out and the groups re-cut, the new
// pairs placed). The organizer reviews the draft on Csoportok (the phase-1
// page, for phase n), moves pairs, rebuilds it from the current results
// ("Tervezet újraszámolása") and publishes it by hand, which creates the
// phase's matches and sends the new-phase emails (groups.server.ts
// publishPhase). Publishing is refused while the ending phase has a disputed
// result or a waiting no-show report (#33). A recorded result not yet confirmed counts as recorded in the
// draft (it is accepted automatically unless disputed). The last phase of a
// season has no next-phase draft (the season switch is later).

type Result = { ok: true } | { ok: false; error: string };

export type TableRow = { pair: GroupPair; place: number };

export type RoundSwitch = {
  endingPhase: number;
  nextPhase: number;
  // "running": before the ending phase's deadline; "resolving": after it,
  // while a match still waits for the deadline resolution; "ready": the
  // draft can be made.
  state: "running" | "resolving" | "ready";
  fast: boolean;
  // The ending phase's final tables, 1. csoport first.
  tables: { number: number; rows: TableRow[] }[];
  leaving: { pair: GroupPair; reason: LeaveReason }[];
  newPairs: { pair: GroupPair; rating: number }[];
  // The draft from the current results and pairs, 1. csoport first, by seed.
  draft: GroupPair[][];
  origins: Map<number, Origin>;
  // What blocks publishing: the ending phase's disputed results and waiting
  // no-show reports (#33).
  disputes: { matchId: number; kind: "disputed" | "no_show"; group: number; pairs: [GroupPair, GroupPair] }[];
  // Permanent partner changes starting at this switch (#403, D179), by the
  // pair id in the draft: who leaves and who comes ("Partnercsere: <távozó>
  // helyett <új partner>"). Before the publish the old pair's id stands for
  // the new pair (the new pair's players and rating, the old pair's spot).
  changes: Map<number, { leaving: string; partner: string }>;
  // A new pair already started at this switch (a publish that failed after
  // starting it), to the old pair's id: the stored draft basis names the old one.
  spots: Map<number, number>;
};

/**
 * The switch into `nextPhase` of a season as the current data has it, or
 * null when there is no such switch (phase 1, a phase the season doesn't
 * have, or the ending phase isn't published). Read only.
 *
 * `projection` (the preview, #363): the outcomes the deadline would give the
 * ending phase's unresolved matches now, counted as if stored, and the pairs
 * its strikes would send off instead of today's (deadline-projection.server.ts).
 */
export async function roundSwitch(
  seasonId: number,
  nextPhase: number,
  now = new Date(),
  projection?: { outcomes: ReadonlyMap<number, MatchOutcome>; leaving: readonly number[] },
): Promise<RoundSwitch | null> {
  const endingPhase = nextPhase - 1;
  const season = await getSeason(seasonId);
  const ending = season?.phases.find((p) => p.number === endingPhase);
  if (!season || !ending || !season.phases.some((p) => p.number === nextPhase)) return null;
  const stored = await phaseGroups(seasonId, endingPhase);
  if (stored.length === 0 || stored.some((g) => !g.publishedAt)) return null;

  const [[league], [first], rows, entered, strikeLeavers, optedOut, switching] = await Promise.all([
    db.select({ fastSwitches: leagues.fastSwitches }).from(leagues).where(eq(leagues.id, season.leagueId)),
    // The league's first season: the one created first.
    db.select({ id: sql<number>`min(${seasons.id})` }).from(seasons).where(eq(seasons.leagueId, season.leagueId)),
    db
      .select({ id: matches.id, groupId: matches.groupId, pairA: matches.pairA, pairB: matches.pairB, status: matches.status, outcome: matches.outcome })
      .from(matches)
      .where(
        inArray(
          matches.groupId,
          stored.map((g) => g.id),
        ),
      )
      .orderBy(asc(matches.id)),
    enteredPairs(seasonId),
    projection ? projection.leaving.map((pairId) => ({ pairId })) : pairsLeavingAfterPhase(seasonId, endingPhase),
    // The season's opt-outs on Ligáim (#395), whatever happened to the pair
    // or its entry since; optedOutAfter picks the ones that end by now.
    db
      .select({ pairId: seasonEntries.pairId, optOutPhase: seasonEntries.optOutPhase, optedOutBy: seasonEntries.optedOutBy })
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, seasonId), isNotNull(seasonEntries.optOutPhase))),
    switchChanges(seasonId, nextPhase),
  ]);

  const withdrawn = new Set(stored.flatMap((g) => g.pairs.filter((p) => p.withdrawn).map((p) => p.pairId)));
  // A withdrawn pair's match doesn't count and is never resolved (D87).
  const counted = rows.filter((m) => !withdrawn.has(m.pairA) && !withdrawn.has(m.pairB));
  const pending = counted.filter((m) => m.status === "result_pending");
  const [recorded, reported] = await Promise.all([
    resultsOf(pending),
    // Matches with a waiting no-show report (#33): the deadline resolution
    // leaves them to the organizer, and they block publishing.
    counted.length === 0
      ? Promise.resolve([])
      : db
          .selectDistinct({ matchId: noShowReports.matchId })
          .from(noShowReports)
          .where(
            and(
              eq(noShowReports.status, "open"),
              inArray(
                noShowReports.matchId,
                db.select({ id: matches.id }).from(matches).where(inArray(matches.groupId, stored.map((g) => g.id))),
              ),
            ),
          ),
  ]);
  const noShow = new Set(reported.map((r) => r.matchId));
  const outcomeOf = (m: (typeof rows)[number]): MatchOutcome | null => {
    if (m.status === "final") return m.outcome;
    const projected = projection?.outcomes.get(m.id);
    if (projected) return projected;
    const state = recorded.get(m.id)?.state;
    return state?.status === "recorded" ? { kind: "played", score: state.score } : null;
  };
  const unresolved = counted.some((m) => (m.status === "open" || m.status === "scheduled") && !noShow.has(m.id));
  const state = now <= ending.deadline ? "running" : unresolved ? "resolving" : "ready";

  const tables = stored.map((g) => {
    const byId = new Map(g.pairs.map((p) => [p.pairId, p]));
    const table = groupTable(
      g.pairs.map((p) => ({ id: p.pairId, elo: p.averageElo, withdrawn: p.withdrawn })),
      counted.filter((m) => m.groupId === g.id).map((m) => ({ a: m.pairA, b: m.pairB, outcome: outcomeOf(m) })),
      g.setGames,
    );
    return { number: g.number, rows: table.map((r) => ({ pair: byId.get(r.pairId)!, place: r.rank })) };
  });

  // A pair of the tables leaves after promotion and relegation (spec 8, 10):
  // a 3rd strike, opted out (#395), dissolved since, or taken out of the
  // season since (its entry no longer counts). Everyone else plays on:
  // default in (packages/rules leaveReason).
  const entry = new Map(entered.map((p) => [p.pairId, p]));
  const strikes = new Set(strikeLeavers.map((p) => p.pairId));
  const out = new Set(optedOut.filter((p) => optedOutAfter(p.optOutPhase, endingPhase)).map((p) => p.pairId));
  // A permanent partner change (#403) at this switch (packages/rules
  // changeAtSwitch): the staying player's own opt-out (#395) ends it, and its
  // old pair leaves as "Nem folytatja" like any opted-out pair (the publish
  // then ends the change and tells its players); otherwise the old pair
  // leaves only by strikes (the leaving player's opt-out changes nothing) and
  // is dissolved once its new pair starts, which takes its spot.
  const optOutBy = new Map(optedOut.filter((p) => out.has(p.pairId)).map((p) => [p.pairId, p.optedOutBy]));
  const optedOutBy = (c: SwitchChange) =>
    !out.has(c.oldPairId) ? null : c.status === "final" && optOutBy.get(c.oldPairId) === c.staying.id ? ("staying" as const) : ("leaving" as const);
  const changes = switching.filter((c) => changeAtSwitch({ strikes: strikes.has(c.oldPairId), optedOutBy: optedOutBy(c) }) !== "ends");
  const changeOf = new Map(changes.map((c) => [c.oldPairId, c]));
  const reasonOf = (p: GroupPair): LeaveReason | null => {
    const c = changeOf.get(p.pairId);
    return c
      ? changeLeaveReason({ strikes: strikes.has(p.pairId), optedOutBy: optedOutBy(c) })
      : leaveReason({ strikes: strikes.has(p.pairId), optedOut: out.has(p.pairId), active: p.active, entered: entry.has(p.pairId) });
  };
  const changing = new Set(changes.map((c) => c.oldPairId));
  const continuing = new Set(tables.flatMap((t) => t.rows.map((r) => r.pair.pairId)));
  const leaving = [
    ...stored.flatMap((g) => g.pairs.filter((p) => p.withdrawn).map((pair) => ({ pair, reason: "withdrawn" as const }))),
    ...tables.flatMap((t) => t.rows.flatMap((r) => {
      const reason = reasonOf(r.pair);
      return reason ? [{ pair: r.pair, reason }] : [];
    })),
  ];
  const leaves = new Set(leaving.map((l) => l.pair.pairId));

  // New pairs: entered for a later phase, joining by this one, not playing
  // on from the ending phase (a late entry, a re-formed pair, or a pair the
  // organizer entered again after a withdrawal), in entry order. Never a pair
  // that opted out (#395): its entry stays approved, so a late entry that
  // left would otherwise come back at the switch after the one it left in
  // (entering again clears the opt-out). A partner change's new pair is
  // placed by its change, below.
  const changePairs = new Set(changes.flatMap((c) => (c.newPairId === null ? [] : [c.newPairId])));
  const newPairs: RoundSwitch["newPairs"] = entered
    .filter(
      (p) =>
        p.joinsPhase > 1 &&
        p.joinsPhase <= nextPhase &&
        !continuing.has(p.pairId) &&
        !strikes.has(p.pairId) &&
        !out.has(p.pairId) &&
        !changePairs.has(p.pairId),
    )
    // Rated by the pair's average current Elo, the level's starting value for
    // a player without a rated match, with no discount (D107f).
    .map((pair) => ({ pair, rating: pair.averageElo }));

  // The new pairs of partner changes (#403): each takes its old pair's spot,
  // or is placed as a new pair when the old pair left by strikes or isn't
  // in the tables (withdrawn mid-phase).
  const pairById = new Map(stored.flatMap((g) => g.pairs.map((p) => [p.pairId, p])));
  const changed = changes.flatMap((c) => {
    const pair = changePair(c, pairById.get(c.oldPairId), entry);
    return pair ? [{ change: c, old: pairById.get(c.oldPairId) ?? pair, pair }] : [];
  });
  const fast = isFastSwitch({ firstSeason: first?.id === seasonId, endingPhase, fastSwitches: league?.fastSwitches ?? 1 });
  const draft = roundSwitchDraft({
    tables: tables.map((t) => t.rows.map((r) => r.pair)),
    fast,
    leaves: (p) => leaves.has(p.pairId),
    newPairs: newPairs.map((n) => n.pair),
    changes: changed.map(({ old, pair }): PartnerChange<GroupPair> => ({ old, pair })),
  });

  const origins = new Map<number, Origin>();
  for (const t of tables) for (const r of t.rows) origins.set(r.pair.pairId, { kind: "continuing", group: t.number, place: r.place });
  for (const n of newPairs) origins.set(n.pair.pairId, { kind: "new" });
  const changeInfo = new Map<number, { leaving: string; partner: string }>();
  const spots = new Map<number, number>();
  for (const { change, pair } of changed) {
    const kept = continuing.has(change.oldPairId) && !leaves.has(change.oldPairId);
    const origin = origins.get(change.oldPairId);
    origins.set(pair.pairId, kept && origin ? origin : { kind: "new" });
    changeInfo.set(pair.pairId, { leaving: change.leaving, partner: change.partner.name });
    if (pair.pairId !== change.oldPairId) spots.set(pair.pairId, change.oldPairId);
    if (!kept) newPairs.push({ pair, rating: pair.averageElo });
  }

  const numberOf = new Map(stored.map((g) => [g.id, g.number]));
  const disputes = counted
    .filter((m) => m.status === "disputed" || (m.status !== "final" && noShow.has(m.id)))
    .map((m) => ({
      matchId: m.id,
      kind: m.status === "disputed" ? ("disputed" as const) : ("no_show" as const),
      group: numberOf.get(m.groupId)!,
      pairs: [pairById.get(m.pairA)!, pairById.get(m.pairB)!] as [GroupPair, GroupPair],
    }));

  // A pair withdrawn mid-phase and entered again plays on as a new pair, so
  // it is not listed as leaving.
  // A partner change's old pair that left by strikes stays listed: its new
  // pair is placed as a new pair under the same id until the publish.
  const placed = new Set(newPairs.filter((n) => !changing.has(n.pair.pairId)).map((n) => n.pair.pairId));
  const shownLeaving = leaving.filter((l) => !placed.has(l.pair.pairId));
  return { endingPhase, nextPhase, state, fast, tables, leaving: shownLeaving, newPairs, draft, origins, disputes, changes: changeInfo, spots };
}

/**
 * The pair a permanent partner change puts in the draft (#403): the new pair
 * once it exists; before that the old pair's row with the new pair's players
 * and rating (the average Elo of the staying player and the new partner,
 * D107f), so the draft keeps the old pair's id until the publish starts the
 * new pair (startChangesAtPublish). Null when neither is there.
 */
function changePair(c: SwitchChange, old: GroupPair | undefined, entered: ReadonlyMap<number, GroupPair>): GroupPair | null {
  if (c.status === "started") return c.newPairId === null ? null : (entered.get(c.newPairId) ?? null);
  if (!old) return null;
  const person = (p: SwitchChange["staying"]) => ({ id: p.id, name: p.name, level: p.level, email: p.email });
  // The staying player keeps their column, as the new pair will.
  const stayingFirst = old.players[0].id === c.staying.id;
  const players: GroupPair["players"] = stayingFirst ? [person(c.staying), person(c.partner)] : [person(c.partner), person(c.staying)];
  return { ...old, players, averageElo: averageElo(c.staying, c.partner) ?? old.averageElo, active: true };
}

/** The pairs a phase-n draft must hold exactly: the continuing pairs that stay and the new pairs. */
export function draftPairIds(s: RoundSwitch): number[] {
  return s.draft.flat().map((p) => p.pairId);
}

/**
 * The draft the system computes, as a string stored with the draft groups:
 * each group's pair ids, sorted ("1,2,5,6|3,4,7,8"). When the current
 * results and pairs put other pairs in a group, the stored draft is
 * outdated: a dispute or no-show settled, a result overridden, a strike
 * cancelled, a pair entered or gone (#35). The seed order is left out, so an
 * Elo change alone (a result accepted later) never makes it outdated.
 */
export function draftBasis(s: RoundSwitch): string {
  // A partner change's new pair counts as the old pair it stands for (#403).
  return s.draft.map((g) => g.map((p) => s.spots.get(p.pairId) ?? p.pairId).sort((a, b) => a - b).join(",")).join("|");
}

/** Whether a stored phase-n draft no longer matches what the switch computes now. */
export function draftOutdated(stored: readonly { basis: string | null }[], s: RoundSwitch): boolean {
  return stored.length > 0 && stored[0]!.basis !== draftBasis(s);
}

export type RoundSwitchPreview = RoundSwitch & {
  // The ending phase's counting matches not final yet: their outcome can
  // still change the preview.
  undecided: number;
};

/**
 * "Előzetes beosztás: ha most érne véget a kör" on Csoportok (#363, D163):
 * the next phase's draft as roundSwitch would make it after the deadline
 * run, if that ran now. The ending phase's unresolved matches count with
 * the outcome the deadline would give them now and the pairs its strikes
 * would send off leave (deadline-projection.server.ts); everything else is
 * the real draft's rule (roundSwitchDraft). Null when there is no such
 * switch (a season's last phase) or the real draft (or the published
 * groups) exists already. Read only: no Elo replay, nothing stored.
 */
export async function roundSwitchPreview(seasonId: number, nextPhase: number, now = new Date()): Promise<RoundSwitchPreview | null> {
  if ((await phaseGroups(seasonId, nextPhase)).length > 0) return null;
  const p = await phaseProjection(seasonId, nextPhase - 1);
  if (!p) return null;
  // The outcome each match the projection resolves would get.
  const outcomes = new Map(p.matches.flatMap((m) => (m.decision.kind === "resolve" ? [[m.id, m.decision.resolution.outcome] as const] : [])));
  const s = await roundSwitch(seasonId, nextPhase, now, { outcomes, leaving: p.leaving });
  if (!s) return null;
  const undecided = p.matches.filter((m) => m.decision.kind !== "leave" || m.decision.reason !== "final").length;
  return { ...s, undecided };
}

/**
 * Makes (or remakes) the next phase's draft from the current results:
 * "Tervezet újraszámolása", and the cron (actor null). The organizer's
 * moves are lost. Refused before the ending phase is settled and once the
 * phase is published.
 */
export async function generateRoundSwitchDraft(seasonId: number, nextPhase: number, actorId: string | null, now = new Date()): Promise<Result> {
  // The draft reads the current Elo: a replay first, in case the one after
  // the last final match failed (#13), as the phase-1 draft does.
  await updateElo(now);
  const s = await roundSwitch(seasonId, nextPhase, now);
  if (!s) return { ok: false, error: "Ehhez a körhöz nem készül tervezet." };
  if (s.state !== "ready") return { ok: false, error: NOT_READY };
  if (s.draft.length === 0) return { ok: false, error: NOTHING_TO_DRAFT };
  return writeDraft(seasonId, nextPhase, s.draft, actorId, actorId ? undefined : now, draftBasis(s));
}

/**
 * "Közzététel" of a phase-n draft: refused while the ending phase has a
 * disputed result or a waiting no-show report (the page lists them), and
 * when the draft is outdated (the results or pairs it was computed from
 * have changed: rebuild it first); then as phase 1 (publishPhase).
 */
export async function publishRoundSwitch(seasonId: number, nextPhase: number, actorId: string, now = new Date()): Promise<Result> {
  const [first, stored] = await Promise.all([roundSwitch(seasonId, nextPhase, now), phaseGroups(seasonId, nextPhase)]);
  let s = first;
  if (!s) return { ok: false, error: "Ehhez a körhöz nem készül tervezet." };
  if (s.state !== "ready") return { ok: false, error: NOT_READY };
  if (s.disputes.length > 0) return { ok: false, error: DISPUTES_FIRST };
  const draft = stored.length > 0 && !stored.some((g) => g.publishedAt);
  if (draft && draftOutdated(stored, s)) return { ok: false, error: OUTDATED_DRAFT };
  // The new pairs of partner changes start now and take their old pairs'
  // rows in the draft (#403 req 2), before the matches are made.
  if (draft && (await startChangesAtPublish(seasonId, nextPhase, actorId, now)) > 0) {
    s = await roundSwitch(seasonId, nextPhase, now);
    if (!s) return { ok: false, error: "Ehhez a körhöz nem készül tervezet." };
  }
  const result = await publishPhase(seasonId, nextPhase, actorId, draftPairIds(s), now);
  // A change made after this draft: its new partner plays the old pair's new matches too (#402).
  if (result.ok) await markChangesAfterPublish(seasonId, nextPhase, now);
  return result;
}

// --- The cron step -----------------------------------------------------------

// The lookup of the switches that can be drafted: one query, every run.
export const ROUND_LOOKUP_QUERIES = 1;

// One run drafts at most one switch: the Elo replay, the switch's reads
// (season 2, groups 2, league, first season, matches, entries, strikes 2,
// opt-outs, recorded results, no-show reports, partner changes #403), the
// write batch and the job mark.
export const ROUND_DRAFT_MIN: Usage = { queries: ELO_REPLAY_QUERIES + 14 + 2, calls: 0 };

const jobKey = (seasonId: number, phase: number) => `round-draft:${seasonId}:${phase}`;

/**
 * The cron step after the deadline resolution (#35): for one season whose
 * phase has ended, is published and settled (no counting match left open
 * or scheduled, except one with a waiting no-show report, which the
 * organizer decides), and whose next phase has no groups yet (and hasn't
 * ended), writes the next phase's draft, unpublished. One lookup finds such
 * switches, so a run before the resolution costs one query and no Elo
 * replay; at most one draft per run, only when its whole cost fits after
 * `keep`. Each switch is drafted once (job_runs). Returns what it did.
 */
export async function draftRoundSwitches(now: Date, budget?: { run: RunBudget; keep: Usage }): Promise<string | null> {
  const fits = (queries: number) => !budget || budget.run.fits({ queries: budget.keep.queries + queries, calls: budget.keep.calls });
  if (!fits(ROUND_LOOKUP_QUERIES)) return "round switch draft: no room in this run; left for the next one";
  const next = alias(seasonPhases, "next_phase");
  const candidates = await db
    .select({ seasonId: seasonPhases.seasonId, phase: next.number })
    .from(seasonPhases)
    .innerJoin(next, and(eq(next.seasonId, seasonPhases.seasonId), eq(next.number, sql`${seasonPhases.number} + 1`)))
    .where(
      and(
        lt(seasonPhases.deadline, now),
        gt(next.deadline, now),
        sql`exists (select 1 from ${groups} g where g.season_id = ${seasonPhases.seasonId} and g.phase = ${seasonPhases.number} and g.published_at is not null)`,
        sql`not exists (select 1 from ${groups} g where g.season_id = ${seasonPhases.seasonId} and g.phase = ${next.number})`,
        sql`not exists (select 1 from ${jobRuns} j where j.key = 'round-draft:' || ${seasonPhases.seasonId} || ':' || ${next.number})`,
        // Settled: the same rule as roundSwitch's state.
        sql`not exists (select 1 from ${matches} m join ${groups} g on g.id = m.group_id
          where g.season_id = ${seasonPhases.seasonId} and g.phase = ${seasonPhases.number} and m.status in ('open', 'scheduled')
            and not exists (select 1 from group_pairs wp where wp.group_id = m.group_id and wp.pair_id in (m.pair_a, m.pair_b) and wp.withdrawn_at is not null)
            and not exists (select 1 from ${noShowReports} nr where nr.match_id = m.id and nr.status = 'open'))`,
      ),
    )
    .orderBy(asc(seasonPhases.deadline), asc(seasonPhases.seasonId));
  for (const c of candidates) {
    if (!fits(ROUND_DRAFT_MIN.queries)) return `round switch draft: phase ${c.phase} of season ${c.seasonId} left for the next run (run limits)`;
    const result = await generateRoundSwitchDraft(c.seasonId, c.phase, null, now);
    // Changed since the lookup (a match reopened): the next run looks again.
    if (!result.ok && result.error === NOT_READY) return null;
    await db.insert(jobRuns).values({ key: jobKey(c.seasonId, c.phase), doneAt: now }).onConflictDoNothing();
    return result.ok
      ? `drafted phase ${c.phase} of season ${c.seasonId}`
      : `no draft for phase ${c.phase} of season ${c.seasonId}: ${result.error}`;
  }
  return null;
}
