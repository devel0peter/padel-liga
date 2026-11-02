import { activeSides, schedulingState, type Side } from "@padel-liga/rules";
import { and, asc, eq, gte, inArray, isNotNull } from "drizzle-orm";

import { db } from "~/db/client.server";
import { groups, matches, seasonPhases, seasons } from "~/db/schema";

import { pairName } from "./groups";
import { activityLine, overviewStatus, stuckReason, type OverviewStatus, type StuckReason } from "./match-overview";
import { eventText, type Tone } from "./matches";
import { clubNames, eventsOf, groupCount, groupMembers, loadMatch, stateOf, toSchedulingEvent } from "./matches.server";
import { formatPhone } from "./phone";

// The organizer's overview of the running phase's matches and one match's
// log (#158, D76), for the league's Szervező and the Admin (the routes check
// league.manage). Read from match_events (D68). Names leave this module on
// the list; phone numbers only on one match's page while its phase runs;
// email addresses never.

export type OverviewMatch = {
  id: number;
  groupNumber: number;
  week: number;
  names: Record<Side, string>;
  status: OverviewStatus;
  label: string;
  tone: Tone;
  // The newest step in the log, any kind; null: nothing yet.
  lastActivity: Date | null;
  active: Record<Side, boolean>;
  activity: string;
  stuck: StuckReason | null;
};

export type OverviewPhase = {
  season: string;
  phase: number;
  phaseStartsAt: Date;
  deadline: Date;
  groupCount: number;
  groups: number[];
  matches: OverviewMatch[];
};

/**
 * Every match of the league's running phases (groups published, deadline not
 * passed), by group and week. Normally one phase; a league running two
 * seasons at once gets one each.
 */
export async function runningPhases(leagueId: number, now = new Date()): Promise<OverviewPhase[]> {
  const groupRows = await db
    .select({
      id: groups.id,
      number: groups.number,
      seasonId: groups.seasonId,
      phase: groups.phase,
      season: seasons.name,
      startsAt: seasonPhases.startsAt,
      deadline: seasonPhases.deadline,
    })
    .from(groups)
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .innerJoin(seasonPhases, and(eq(seasonPhases.seasonId, groups.seasonId), eq(seasonPhases.number, groups.phase)))
    .where(and(eq(seasons.leagueId, leagueId), isNotNull(groups.publishedAt), gte(seasonPhases.deadline, now)))
    .orderBy(asc(seasonPhases.startsAt), asc(groups.seasonId), asc(groups.number));
  if (groupRows.length === 0) return [];

  const groupIds = groupRows.map((g) => g.id);
  const members = await groupMembers(groupIds);
  const matchRows = await db
    .select()
    .from(matches)
    .where(inArray(matches.groupId, groupIds))
    .orderBy(asc(matches.week), asc(matches.id));
  const events = await eventsOf(matchRows.map((m) => m.id));
  const states = new Map(
    matchRows.map((m) => [m.id, schedulingState((events.get(m.id) ?? []).map((e) => toSchedulingEvent(e, m.pairA)), now)]),
  );
  const venues = await clubNames([...states.values()].map((s) => (s.status === "to_schedule" ? null : s.clubId)));
  const groupById = new Map(groupRows.map((g) => [g.id, g]));

  const phases = new Map<string, OverviewPhase>();
  for (const g of groupRows) {
    const key = `${g.seasonId}:${g.phase}`;
    if (!phases.has(key))
      phases.set(key, {
        season: g.season,
        phase: g.phase,
        phaseStartsAt: g.startsAt,
        deadline: g.deadline,
        groupCount: await groupCount(g.seasonId, g.phase),
        groups: [],
        matches: [],
      });
    phases.get(key)!.groups.push(g.number);
  }

  for (const m of matchRows) {
    const g = groupById.get(m.groupId)!;
    const pairsOf = members.get(m.groupId) ?? [];
    const name = (pairId: number) => {
      const p = pairsOf.find((x) => x.pairId === pairId);
      return p ? pairName(p.players) : "Ismeretlen pár";
    };
    const names = { a: name(m.pairA), b: name(m.pairB) };
    const log = events.get(m.id) ?? [];
    const state = states.get(m.id)!;
    const sides = activeSides(
      log.map((e) => toSchedulingEvent(e, m.pairA)),
      m.deadline,
    );
    const active = { a: sides.includes("a"), b: sides.includes("b") };
    const status = overviewStatus(state, names, state.status === "to_schedule" ? null : venues.get(state.clubId ?? -1));
    phases.get(`${g.seasonId}:${g.phase}`)!.matches.push({
      id: m.id,
      groupNumber: g.number,
      week: m.week,
      names,
      status: state.status,
      label: status.label,
      tone: status.tone,
      lastActivity: log.at(-1)?.at ?? null,
      active,
      activity: activityLine(active, names),
      stuck: stuckReason({ state, kinds: log.map((e) => e.kind), phaseStartsAt: g.startsAt, week: m.week, now }),
    });
  }
  return [...phases.values()];
}

// --- One match ----------------------------------------------------------------

export type OrganizerMatch = {
  id: number;
  week: number;
  season: string;
  phase: number;
  phaseStartsAt: Date;
  deadline: Date;
  groupNumber: number;
  groupCount: number;
  running: boolean;
  label: string;
  tone: Tone;
  stuck: StuckReason | null;
  activity: string;
  // Both pairs with their players; phones only while the phase runs.
  pairs: { side: Side; name: string; active: boolean; players: { name: string; phone: string | null }[] }[];
  log: { id: number; at: Date; who: string; pair: string; text: string }[];
};

/**
 * One match of this league for its Szervező or the Admin: status, activity,
 * both pairs' phones while the phase runs, and the full log. Null when the
 * match doesn't exist, isn't published, or belongs to another league.
 */
export async function organizerMatch(leagueId: number, matchId: number, now = new Date()): Promise<OrganizerMatch | null> {
  const [owner] = await db
    .select({ leagueId: seasons.leagueId })
    .from(matches)
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .where(eq(matches.id, matchId));
  if (owner?.leagueId !== leagueId) return null;
  const ctx = await loadMatch(matchId);
  if (!ctx) return null;

  const state = stateOf(ctx, now);
  const running = ctx.match.deadline.getTime() >= now.getTime();
  const names = { a: pairName(ctx.pairs.a.players), b: pairName(ctx.pairs.b.players) };
  const sides = activeSides(
    ctx.events.map((e) => toSchedulingEvent(e, ctx.match.pairA)),
    ctx.match.deadline,
  );
  const active = { a: sides.includes("a"), b: sides.includes("b") };
  const venues = await clubNames([...ctx.events.map((e) => e.clubId), state.status === "to_schedule" ? null : state.clubId]);
  const status = overviewStatus(state, names, state.status === "to_schedule" ? null : venues.get(state.clubId ?? -1));
  return {
    id: ctx.match.id,
    week: ctx.match.week,
    season: ctx.season,
    phase: ctx.phase,
    phaseStartsAt: ctx.phaseStartsAt,
    deadline: ctx.match.deadline,
    groupNumber: ctx.groupNumber,
    groupCount: ctx.groupCount,
    running,
    label: status.label,
    tone: status.tone,
    stuck: running
      ? stuckReason({ state, kinds: ctx.events.map((e) => e.kind), phaseStartsAt: ctx.phaseStartsAt, week: ctx.match.week, now })
      : null,
    activity: activityLine(active, names),
    pairs: (["a", "b"] as const).map((side) => ({
      side,
      name: names[side],
      active: active[side],
      players: ctx.pairs[side].players.map((p) => ({ name: p.name, phone: running ? formatPhone(p.phone) || null : null })),
    })),
    log: ctx.events.map((e) => ({
      id: e.id,
      at: e.at,
      who: e.userName || "Törölt játékos",
      pair: e.pairId === ctx.match.pairA ? names.a : names.b,
      text: eventText({
        kind: e.kind,
        slots: e.slots?.map((s) => new Date(s * 1000)) ?? null,
        slot: e.slot,
        venue: e.clubId ? (venues.get(e.clubId) ?? null) : null,
      }),
    })),
  };
}
