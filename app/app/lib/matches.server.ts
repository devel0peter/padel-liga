import {
  agreedTimeErrors,
  autoAcceptAt,
  isLateCancel,
  proposalErrors,
  proposalKind,
  resultActions,
  SCHEDULING_EVENT_KINDS,
  schedulingActions,
  schedulingState,
  slotErrorMessage,
  type SchedulingActions,
  type SchedulingEvent,
  type ResultState,
  type SchedulingEventKind,
  type SchedulingState,
  type Side,
  type SlotError,
} from "@padel-liga/rules";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { clubs, groupPairs, groups, leagues, matchEvents, matches, pairs, seasonPhases, seasons, users } from "~/db/schema";
import { queueMatchEmails } from "~/lib/email/outbox.server";
import {
  matchAgreedTimeMessage,
  matchCancelledMessage,
  matchDeclinedMessage,
  matchProposalMessage,
  matchScheduledMessage,
  type Message,
  type PlayerKind,
} from "~/lib/notifications";
import { notifyPlayers } from "~/lib/notifications.server";

import { eventText, schedulingEmailDue } from "./matches";
import { calendarLinks, calendarSlot, type CalendarEvent, type CalendarLinks } from "./calendar";
import { SITE_URL } from "./site";
import { pairName } from "./groups";
import { COURT_MAX } from "./matches";
import { countedOutcome, groupTable } from "./ladder";
import { formatPhone } from "./phone";
import { resultOf, resultsOf } from "./result-log.server";
import { decisionText, resultEventText } from "./results";
import { averageElo } from "./season-entries";
import { logError } from "~/lib/log";

// A player's group and matches (#25) and scheduling them (#26) in D1. The
// rules are in packages/rules (slots.ts, scheduling.ts); the texts in
// matches.ts. Phone numbers leave this module only for the current phase's
// opponents (spec 3), email addresses never (they go to the outbox).

export type Person = { id: string; name: string; email: string; phone: string | null };
// `elo`: the pair's rating, the last tiebreak of the table (D20).
// `withdrawn`: taken out of the group mid-phase (#34); its matches there
// don't count and can't be played.
export type PairPlayers = { pairId: number; seed: number; elo: number; players: [Person, Person]; withdrawn: boolean };

const playerA = alias(users, "player_a_user");
const playerB = alias(users, "player_b_user");

const pairPlayerColumns = {
  pairId: pairs.id,
  aId: playerA.id,
  aName: playerA.name,
  aEmail: playerA.email,
  aPhone: playerA.phone,
  aLevel: playerA.level,
  aElo: playerA.elo,
  bLevel: playerB.level,
  bElo: playerB.elo,
  bId: playerB.id,
  bName: playerB.name,
  bEmail: playerB.email,
  bPhone: playerB.phone,
};

type PairPlayerRow = { pairId: number; aId: string; aName: string; aEmail: string; aPhone: string | null; bId: string; bName: string; bEmail: string; bPhone: string | null };

const toPlayers = (r: PairPlayerRow): [Person, Person] => [
  { id: r.aId, name: r.aName || "Névtelen", email: r.aEmail, phone: r.aPhone },
  { id: r.bId, name: r.bName || "Névtelen", email: r.bEmail, phone: r.bPhone },
];

// The pairs of these groups with their players, by group, in seed order.
export async function groupMembers(groupIds: number[]): Promise<Map<number, PairPlayers[]>> {
  const out = new Map<number, PairPlayers[]>();
  if (groupIds.length === 0) return out;
  const rows = await db
    .select({ groupId: groupPairs.groupId, seed: groupPairs.seed, withdrawnAt: groupPairs.withdrawnAt, ...pairPlayerColumns })
    .from(groupPairs)
    .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(inArray(groupPairs.groupId, groupIds))
    .orderBy(asc(groupPairs.groupId), asc(groupPairs.seed));
  for (const r of rows) {
    const list = out.get(r.groupId) ?? out.set(r.groupId, []).get(r.groupId)!;
    list.push({
      pairId: r.pairId,
      seed: r.seed,
      elo: averageElo({ elo: r.aElo, level: r.aLevel }, { elo: r.bElo, level: r.bLevel }) ?? 0,
      players: toPlayers(r),
      withdrawn: r.withdrawnAt !== null,
    });
  }
  return out;
}

export type StoredEvent = {
  id: number;
  matchId: number;
  pairId: number;
  userId: string | null;
  userName: string | null;
  kind: SchedulingEventKind;
  slots: number[] | null;
  slot: Date | null;
  clubId: number | null;
  court: string | null;
  at: Date;
};

export async function eventsOf(matchIds: number[]): Promise<Map<number, StoredEvent[]>> {
  const out = new Map<number, StoredEvent[]>();
  if (matchIds.length === 0) return out;
  const rows = await db
    .select({
      id: matchEvents.id,
      matchId: matchEvents.matchId,
      pairId: matchEvents.pairId,
      userId: matchEvents.userId,
      userName: users.name,
      kind: matchEvents.kind,
      slots: matchEvents.slots,
      slot: matchEvents.slot,
      clubId: matchEvents.clubId,
      court: matchEvents.court,
      at: matchEvents.at,
    })
    .from(matchEvents)
    .leftJoin(users, eq(users.id, matchEvents.userId))
    // Result steps (#28) are read by result-log.server.ts.
    .where(and(inArray(matchEvents.matchId, matchIds), inArray(matchEvents.kind, [...SCHEDULING_EVENT_KINDS])))
    .orderBy(asc(matchEvents.id));
  for (const r of rows) (out.get(r.matchId) ?? out.set(r.matchId, []).get(r.matchId)!).push({ ...r, kind: r.kind as SchedulingEventKind });
  return out;
}

export const toSchedulingEvent = (e: StoredEvent, pairA: number): SchedulingEvent => ({
  kind: e.kind,
  side: e.pairId === pairA ? "a" : "b",
  at: e.at,
  slots: e.slots?.map((s) => new Date(s * 1000)) ?? null,
  slot: e.slot,
  clubId: e.clubId,
  court: e.court,
});

export async function clubNames(ids: (number | null | undefined)[]): Promise<Map<number, string>> {
  const wanted = [...new Set(ids.filter((id): id is number => typeof id === "number"))];
  if (wanted.length === 0) return new Map();
  const rows = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(inArray(clubs.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// How many published groups the phase has, for the division (spec 4).
export async function groupCount(seasonId: number, phase: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(groups)
    .where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase), isNotNull(groups.publishedAt)));
  return row?.n ?? 0;
}

// --- Kezdőlap (#25) -----------------------------------------------------------

export type Opponent = { name: string; phone: string };

export type HomeMatch = {
  id: number;
  week: number;
  // The other pair: names, and phones (only the current phase is listed here).
  opponents: string;
  contacts: Opponent[];
  side: Side;
  state: SchedulingState;
  venue: string | null;
  // The result, once recorded (#28).
  result: ResultState;
};

export type HomeGroup = {
  groupId: number;
  league: string;
  season: string;
  phase: number;
  number: number;
  groupCount: number;
  phaseStartsAt: Date;
  deadline: Date;
  // Every pair of the group in table order (#201), names only; `mine` marks
  // the player's. The table is the public league page's, from final results
  // only; before any result every `matches` is 0 and the order is the table's
  // tiebreak alone: Elo, then seed (groupStandings). A
  // pair withdrawn mid-phase (#34) is not in it, with all of its matches.
  pairs: { pairId: number; name: string; mine: boolean; rank: number; matches: number; points: number; setDiff: number; gameDiff: number }[];
  // The pairs withdrawn mid-phase (#34), by name, shown below the table.
  withdrawn: string[];
  matches: HomeMatch[];
  // The weeks whose match is off because the opponents withdrew (#34).
  offWeeks: { week: number; opponents: string }[];
};

/**
 * The player's groups in the current phase (published, deadline not passed),
 * one per league, with every match of their pair. Empty before the groups are
 * out and after the phase ends; past phases never show phone numbers. A pair
 * withdrawn mid-phase (#34) has no group any more, and its matches leave the
 * other pairs' lists.
 */
export async function currentGroups(userId: string, now = new Date()): Promise<HomeGroup[]> {
  const mine = await db
    .select({
      groupId: groups.id,
      pairId: pairs.id,
      number: groups.number,
      seasonId: groups.seasonId,
      phase: groups.phase,
      season: seasons.name,
      league: leagues.name,
      startsAt: seasonPhases.startsAt,
      deadline: seasonPhases.deadline,
    })
    .from(groupPairs)
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .innerJoin(seasonPhases, and(eq(seasonPhases.seasonId, groups.seasonId), eq(seasonPhases.number, groups.phase)))
    .where(
      and(
        isNotNull(groups.publishedAt),
        gte(seasonPhases.deadline, now),
        isNull(groupPairs.withdrawnAt),
        or(eq(pairs.playerA, userId), eq(pairs.playerB, userId)),
      ),
    )
    .orderBy(asc(leagues.name));
  if (mine.length === 0) return [];

  const groupIds = mine.map((g) => g.groupId);
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
  const venues = await clubNames(
    [...states.values()].map((s) => (s.status === "to_schedule" ? null : s.clubId)),
  );
  const results = await resultsOf(matchRows);

  return Promise.all(
    mine.map(async (g) => {
      const pairsOf = members.get(g.groupId) ?? [];
      const byId = new Map(pairsOf.map((p) => [p.pairId, p]));
      const ours = matchRows.filter((m) => m.groupId === g.groupId && (m.pairA === g.pairId || m.pairB === g.pairId));
      const own = ours.filter((m) => !voided(m, byId));
      const other = (m: { pairA: number; pairB: number }) => byId.get(m.pairA === g.pairId ? m.pairB : m.pairA);
      return {
        groupId: g.groupId,
        league: g.league,
        season: g.season,
        phase: g.phase,
        number: g.number,
        groupCount: await groupCount(g.seasonId, g.phase),
        phaseStartsAt: g.startsAt,
        deadline: g.deadline,
        pairs: groupTable(
          pairsOf.map((p) => ({ id: p.pairId, elo: p.elo, withdrawn: p.withdrawn })),
          // Only a final outcome counts (#186, #201): the public page's rule.
          matchRows.filter((m) => m.groupId === g.groupId).map((m) => ({ a: m.pairA, b: m.pairB, outcome: countedOutcome(m) })),
        ).map((row) => {
          const p = byId.get(row.pairId)!;
          return { ...row, name: pairName(p.players), mine: p.pairId === g.pairId };
        }),
        withdrawn: pairsOf.filter((p) => p.withdrawn).map((p) => pairName(p.players)),
        offWeeks: ours
          .filter((m) => voided(m, byId))
          .map((m) => ({ week: m.week, opponents: pairName(other(m)?.players ?? []) })),
        matches: own.map((m) => {
          const side: Side = m.pairA === g.pairId ? "a" : "b";
          const them = other(m);
          const state = states.get(m.id)!;
          return {
            id: m.id,
            week: m.week,
            opponents: them ? pairName(them.players) : "",
            contacts: (them?.players ?? []).map((p) => ({ name: p.name, phone: formatPhone(p.phone) })),
            side,
            state,
            venue: state.status === "to_schedule" ? null : (venues.get(state.clubId ?? -1) ?? null),
            result: results.get(m.id)?.state ?? { status: "none" },
          };
        }),
      };
    }),
  );
}

// --- Reminders (#31) ----------------------------------------------------------

export type RunningMatch = {
  id: number;
  week: number;
  phaseStartsAt: Date;
  deadline: Date;
  status: string;
  state: SchedulingState;
  kinds: SchedulingEventKind[];
  venue: string | null;
  // Pair a's and pair b's players (emails go only to the outbox).
  pairs: { a: [Person, Person]; b: [Person, Person] };
};

const IDS_PER_QUERY = 90;

function chunked<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += IDS_PER_QUERY) out.push(list.slice(i, i + IDS_PER_QUERY));
  return out;
}

/**
 * Every match of a published group whose phase deadline hasn't passed, with
 * its state, its log's kinds, the venue and both pairs' players, for the
 * reminders (#31). A withdrawn pair's matches (#34) are left out. A few queries for the whole league: the matches, then the
 * players and the logs in chunks of 90 ids (D1: 100 bound parameters).
 */
export async function runningMatches(now = new Date()): Promise<RunningMatch[]> {
  const rows = await db
    .select({ match: matches, phaseStartsAt: seasonPhases.startsAt })
    .from(matches)
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .innerJoin(seasonPhases, and(eq(seasonPhases.seasonId, groups.seasonId), eq(seasonPhases.number, groups.phase)))
    .where(and(isNotNull(groups.publishedAt), gte(matches.deadline, now)))
    .orderBy(asc(matches.id));
  if (rows.length === 0) return [];
  const members = new Map<number, PairPlayers[]>();
  for (const ids of chunked([...new Set(rows.map((r) => r.match.groupId))]))
    for (const [groupId, list] of await groupMembers(ids)) members.set(groupId, list);
  const events = new Map<number, StoredEvent[]>();
  for (const ids of chunked(rows.map((r) => r.match.id))) for (const [id, list] of await eventsOf(ids)) events.set(id, list);
  const states = new Map(
    rows.map(({ match: m }) => [m.id, schedulingState((events.get(m.id) ?? []).map((e) => toSchedulingEvent(e, m.pairA)), now)]),
  );
  const venues = await clubNames([...states.values()].map((s) => (s.status === "scheduled" ? s.clubId : null)));
  return rows.flatMap(({ match: m, phaseStartsAt }) => {
    const pairsOf = members.get(m.groupId) ?? [];
    const a = pairsOf.find((p) => p.pairId === m.pairA);
    const b = pairsOf.find((p) => p.pairId === m.pairB);
    if (!a || !b || a.withdrawn || b.withdrawn) return [];
    const state = states.get(m.id)!;
    return [
      {
        id: m.id,
        week: m.week,
        phaseStartsAt,
        deadline: m.deadline,
        status: m.status,
        state,
        kinds: (events.get(m.id) ?? []).map((e) => e.kind),
        venue: state.status === "scheduled" ? (venues.get(state.clubId ?? -1) ?? null) : null,
        pairs: { a: a.players, b: b.players },
      },
    ];
  });
}

// --- The match page (#26) -----------------------------------------------------

export type MatchContext = {
  match: typeof matches.$inferSelect;
  groupNumber: number;
  groupCount: number;
  league: string;
  leagueId: number;
  leagueSlug: string;
  city: string;
  season: string;
  seasonId: number;
  phase: number;
  phaseStartsAt: Date;
  pairs: { a: PairPlayers; b: PairPlayers };
  events: StoredEvent[];
  // A pair of the match was withdrawn mid-phase (#34): it doesn't count and
  // takes no step any more.
  voided: boolean;
};

export async function loadMatch(matchId: number): Promise<MatchContext | null> {
  const [row] = await db
    .select({
      match: matches,
      groupNumber: groups.number,
      seasonId: groups.seasonId,
      phase: groups.phase,
      season: seasons.name,
      league: leagues.name,
      leagueId: leagues.id,
      leagueSlug: leagues.slug,
      city: leagues.city,
      phaseStartsAt: seasonPhases.startsAt,
    })
    .from(matches)
    .innerJoin(groups, eq(groups.id, matches.groupId))
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .innerJoin(seasonPhases, and(eq(seasonPhases.seasonId, groups.seasonId), eq(seasonPhases.number, groups.phase)))
    .where(and(eq(matches.id, matchId), isNotNull(groups.publishedAt)));
  if (!row) return null;
  const members = (await groupMembers([row.match.groupId])).get(row.match.groupId) ?? [];
  const a = members.find((p) => p.pairId === row.match.pairA);
  const b = members.find((p) => p.pairId === row.match.pairB);
  if (!a || !b) return null;
  return {
    match: row.match,
    groupNumber: row.groupNumber,
    groupCount: await groupCount(row.seasonId, row.phase),
    league: row.league,
    leagueId: row.leagueId,
    leagueSlug: row.leagueSlug,
    city: row.city,
    season: row.season,
    seasonId: row.seasonId,
    phase: row.phase,
    phaseStartsAt: row.phaseStartsAt,
    pairs: { a, b },
    events: (await eventsOf([matchId])).get(matchId) ?? [],
    voided: a.withdrawn || b.withdrawn,
  };
}

// Which side the user plays on; null: not one of the two pairs' players
// (#26 requirement 6).
export function sideOf(ctx: MatchContext, userId: string): Side | null {
  if (ctx.pairs.a.players.some((p) => p.id === userId)) return "a";
  if (ctx.pairs.b.players.some((p) => p.id === userId)) return "b";
  return null;
}

export const stateOf = (ctx: MatchContext, now: Date) =>
  schedulingState(ctx.events.map((e) => toSchedulingEvent(e, ctx.match.pairA)), now);

export type MatchPage = {
  id: number;
  week: number;
  deadline: Date;
  phase: number;
  phaseStartsAt: Date;
  league: string;
  season: string;
  groupNumber: number;
  groupCount: number;
  side: Side;
  us: string;
  opponents: string;
  // Only while the phase runs (spec 3); empty afterwards.
  contacts: Opponent[];
  state: SchedulingState;
  venue: string | null;
  actions: ReturnType<typeof schedulingActions>;
  // Cancelling now would be late (under 24 hours before the slot, #27).
  cancelLate: boolean;
  clubs: { id: number; name: string }[];
  // The result (#28): its state, what this player can do, when a waiting one
  // is accepted by itself.
  result: ResultState;
  resultActions: ReturnType<typeof resultActions>;
  autoAcceptAt: Date | null;
  // Scheduling and result steps and rulings, oldest first. `by`: a pair's
  // player, the organizer (#29) or the 48-hour rule (#28).
  log: { key: string; at: Date; who: string; ours: boolean; by: "pair" | "organizer" | "auto"; text: string }[];
  // Why the match no longer counts (#34), or null.
  voided: string | null;
  // Add to calendar (#192): the links, or null while no time was ever fixed.
  calendar: CalendarLinks | null;
};

// Once a result is recorded, disputed or final, scheduling is over (#28).
const NO_SCHEDULING: SchedulingActions = { propose: false, recordAgreed: false, accept: [], confirm: false, decline: false, venue: false, cancel: false };
const NO_RESULT_ACTIONS = { record: false, confirm: false, dispute: false };

// Whether a match of the group has a withdrawn pair (#34), by the group's
// members.
export function voided(m: { pairA: number; pairB: number }, members: ReadonlyMap<number, PairPlayers>): boolean {
  return !!members.get(m.pairA)?.withdrawn || !!members.get(m.pairB)?.withdrawn;
}

const withdrawnOf = (ctx: MatchContext): PairPlayers => (ctx.pairs.a.withdrawn ? ctx.pairs.a : ctx.pairs.b);

// On the match page of a withdrawn pair's match (#34).
export function voidedText(withdrawn: PairPlayers, ourPairId: number): string {
  return withdrawn.pairId === ourPairId
    ? "Visszaléptetek a körből: ez a meccs elmarad, és nem számít a tabellában."
    : `${pairName(withdrawn.players)} visszalépett a körből: ez a meccs elmarad, és nem számít a tabellában.`;
}

// The same as a condition on `matches`, for queries that read matches alone.
export const noWithdrawnPair = sql`not exists (select 1 from group_pairs gp where gp.group_id = ${matches.groupId}
  and gp.pair_id in (${matches.pairA}, ${matches.pairB}) and gp.withdrawn_at is not null)`;

// The match page for a player of either pair; null for anyone else, or a
// match that doesn't exist (the page answers 404 either way).
// `loaded`: the match, when the caller already loaded it.
export async function matchPage(matchId: number, userId: string, now = new Date(), loaded?: MatchContext): Promise<MatchPage | null> {
  const ctx = loaded ?? (await loadMatch(matchId));
  if (!ctx) return null;
  const side = sideOf(ctx, userId);
  if (!side) return null;
  const state = stateOf(ctx, now);
  const running = ctx.match.deadline.getTime() >= now.getTime();
  const [ours, theirs] = side === "a" ? [ctx.pairs.a, ctx.pairs.b] : [ctx.pairs.b, ctx.pairs.a];
  const cityClubs = await db
    .select({ id: clubs.id, name: clubs.name })
    .from(clubs)
    .where(and(eq(clubs.city, ctx.city), eq(clubs.active, true)))
    .orderBy(asc(clubs.name));
  const venues = await clubNames([...ctx.events.map((e) => e.clubId), state.status === "to_schedule" ? null : state.clubId]);
  const results = await resultOf(ctx.match);
  const result = results.state;
  const scheduling = schedulingActions(state, side, now, ctx.match.deadline);
  const log: MatchPage["log"] = [
    ...ctx.events.map((e) => ({
      key: `e${e.id}`,
      id: e.id,
      at: e.at,
      who: e.userName || "Törölt játékos",
      ours: e.pairId === ours.pairId,
      by: "pair" as const,
      text: eventText({
        kind: e.kind,
        at: e.at,
        slots: e.slots?.map((s) => new Date(s * 1000)) ?? null,
        slot: e.slot,
        venue: e.clubId ? (venues.get(e.clubId) ?? null) : null,
        court: e.court,
      }),
    })),
    ...results.events.map((e) => ({
      key: `e${e.id}`,
      id: e.id,
      at: e.at,
      who: e.userName || "Törölt játékos",
      ours: e.pairId === ours.pairId,
      by: "pair" as const,
      text: resultEventText(e, side),
    })),
    ...results.decisions.map((d) => ({
      key: `d${d.id}`,
      id: Number.MAX_SAFE_INTEGER,
      at: d.at,
      who: d.kind === "organizer" ? d.userName || "Szervező" : "Padelpárbaj",
      ours: false,
      by: d.kind === "organizer" ? ("organizer" as const) : ("auto" as const),
      text: decisionText(d, side),
    })),
  ]
    // By time; at the same second, in the order they were written.
    .sort((x, y) => x.at.getTime() - y.at.getTime() || x.id - y.id)
    .map(({ id: _, ...e }) => e);
  return {
    id: ctx.match.id,
    week: ctx.match.week,
    deadline: ctx.match.deadline,
    phase: ctx.phase,
    phaseStartsAt: ctx.phaseStartsAt,
    league: ctx.league,
    season: ctx.season,
    groupNumber: ctx.groupNumber,
    groupCount: ctx.groupCount,
    side,
    us: pairName(ours.players),
    opponents: pairName(theirs.players),
    // A withdrawn pair's match (#34): the two are no opponents any more.
    contacts: running && !ctx.voided ? theirs.players.map((p) => ({ name: p.name, phone: formatPhone(p.phone) })) : [],
    state,
    venue: state.status === "to_schedule" ? null : (venues.get(state.clubId ?? -1) ?? null),
    actions: result.status === "none" && !ctx.voided ? scheduling : NO_SCHEDULING,
    cancelLate: !ctx.voided && result.status === "none" && state.status === "scheduled" && isLateCancel(state.slot, now),
    clubs: cityClubs,
    result,
    resultActions: ctx.voided ? NO_RESULT_ACTIONS : resultActions(result, side),
    autoAcceptAt: ctx.voided ? null : autoAcceptAt(result),
    log,
    voided: ctx.voided ? voidedText(withdrawnOf(ctx), ours.pairId) : null,
    // Not once the match has a result or ruling (played or decided: nothing to
    // plan any more); a voided match keeps the link that removes the entry.
    calendar: result.status === "none" || ctx.voided ? calendarLinks(calendarEventOf(ctx, side, venues)) : null,
  };
}

// The match's calendar entry (#192, D106): the fixed time (or the one just
// cancelled) with the four players' names, the venue and the match page. No
// contact data: only names are read here. `side`: whose pair is named first.
export function calendarEventOf(ctx: MatchContext, side: Side, venues: ReadonlyMap<number, string>): CalendarEvent | null {
  const slot = calendarSlot(ctx.events.map((e) => toSchedulingEvent(e, ctx.match.pairA)), ctx.voided);
  if (!slot) return null;
  const [ours, theirs] = side === "a" ? [ctx.pairs.a, ctx.pairs.b] : [ctx.pairs.b, ctx.pairs.a];
  return {
    ...slot,
    matchId: ctx.match.id,
    pairs: [pairName(ours.players), pairName(theirs.players)],
    players: [...ours.players, ...theirs.players].map((p) => p.name),
    venue: slot.clubId ? (venues.get(slot.clubId) ?? null) : null,
    url: `${SITE_URL}/matches/${ctx.match.id}`,
  };
}

// The .ics of a match for its players and the league's organizers (and the
// Admin); null for anyone else or a match that doesn't exist or never had a
// time, which the route answers with 404 alike.
export async function matchCalendarEvent(
  matchId: number,
  viewer: { userId: string; manages: (leagueSlug: string) => boolean },
): Promise<CalendarEvent | null> {
  const ctx = await loadMatch(matchId);
  if (!ctx) return null;
  const side = sideOf(ctx, viewer.userId) ?? (viewer.manages(ctx.leagueSlug) ? "a" : null);
  if (!side) return null;
  const venues = await clubNames(ctx.events.map((e) => e.clubId));
  return calendarEventOf(ctx, side, venues);
}

// --- Scheduling steps (#26) ---------------------------------------------------

export type StepInput =
  | { kind: "propose"; slots: Date[]; clubId: number | null }
  | { kind: "accept"; slot: Date }
  | { kind: "agreed"; slot: Date; clubId: number | null }
  | { kind: "confirm" }
  | { kind: "decline" }
  | { kind: "venue"; clubId: number | null; court: string }
  | { kind: "cancel" };

export type StepResult = { ok: true; notice: string } | { ok: false; error: string; slotErrors?: SlotError[] };

export const NOT_FOUND = "Nincs ilyen meccs.";
export const CHANGED = "Közben változott a meccs. Nézd meg újra, és próbáld még egyszer.";
export const VOIDED = "Ez a meccs elmarad: az egyik pár visszalépett a körből, a meccseik nem számítanak.";
const CLOSED_SCHEDULED = "A meccs időpontja már le van fixálva.";
const CLOSED_RESULT = "A meccs eredménye már rögzítve van, itt már nem lehet egyeztetni.";
const CLOSED_DEADLINE = "Lejárt a kör határideje, itt már nem lehet egyeztetni.";
const BAD_CLUB = "Válassz a listából helyszínt, vagy hagyd üresen.";
const NOTHING_TO_ANSWER = "Erre most nincs mit válaszolni. Frissítsd az oldalt.";
const SLOT_GONE = "Ez az időpont már nem választható. Frissítsd az oldalt.";
const NOT_SCHEDULED = "A meccsnek most nincs lefixált időpontja. Frissítsd az oldalt.";
const STARTED = "A meccs időpontja már elkezdődött, nem lehet lemondani.";
const NO_CLUB = "Válassz helyszínt a listából.";
const LONG_COURT = `A pálya legfeljebb ${COURT_MAX} karakter lehet.`;

const secs = (d: Date) => Math.floor(d.getTime() / 1000);

// The first error of each kind, in Hungarian, for the form.
export function slotErrorText(errors: readonly SlotError[]): string {
  return [...new Set(errors.map((e) => slotErrorMessage(e.code)))].join(" ");
}

async function clubAllowed(clubId: number | null, city: string): Promise<boolean> {
  if (clubId === null) return true;
  const [row] = await db
    .select({ id: clubs.id })
    .from(clubs)
    .where(and(eq(clubs.id, clubId), eq(clubs.city, city), eq(clubs.active, true)));
  return !!row;
}

type NewEvent = {
  kind: SchedulingEventKind;
  slots?: number[] | null;
  slot?: Date | null;
  clubId?: number | null;
  court?: string | null;
};

// Why a step can't be taken now, or null: recording the venue and cancelling
// need a scheduled match (#27), everything else one that isn't (#26).
function closedReason(input: StepInput, state: SchedulingState, can: ReturnType<typeof schedulingActions>, now: Date, deadline: Date): string | null {
  if (now.getTime() >= deadline.getTime()) return CLOSED_DEADLINE;
  if (input.kind === "venue" || input.kind === "cancel") {
    if (state.status !== "scheduled") return NOT_SCHEDULED;
    return input.kind === "cancel" && !can.cancel ? STARTED : null;
  }
  return can.propose ? null : CLOSED_SCHEDULED;
}

/**
 * One scheduling step by a player of either pair (#26, #27): checked against
 * the slot rules (#8) and the match's state, appended to the log and mirrored
 * on the match in one batch. If someone else's step got in first, nothing is
 * written. Then the other pair is told (spec 13).
 */
export async function matchStep(userId: string, matchId: number, input: StepInput, now = new Date()): Promise<StepResult> {
  const ctx = await loadMatch(matchId);
  if (!ctx) return { ok: false, error: NOT_FOUND };
  const side = sideOf(ctx, userId);
  if (!side) return { ok: false, error: NOT_FOUND };
  if (ctx.voided) return { ok: false, error: VOIDED };
  const deadline = ctx.match.deadline;
  const state = stateOf(ctx, now);
  if ((await resultOf(ctx.match)).state.status !== "none") return { ok: false, error: CLOSED_RESULT };
  const can = schedulingActions(state, side, now, deadline);
  const closed = closedReason(input, state, can, now, deadline);
  if (closed) return { ok: false, error: closed };

  let event: NewEvent;
  let notice: string;
  switch (input.kind) {
    case "venue": {
      const court = input.court.trim();
      if (input.clubId === null || !(await clubAllowed(input.clubId, ctx.city))) return { ok: false, error: NO_CLUB };
      if (court.length > COURT_MAX) return { ok: false, error: LONG_COURT };
      event = { kind: "venue", clubId: input.clubId, court: court || null };
      notice = "Rögzítettük a helyszínt.";
      break;
    }
    case "cancel": {
      // closedReason made sure the match is scheduled.
      const slot = (state as Extract<SchedulingState, { status: "scheduled" }>).slot;
      event = { kind: "cancelled", slot };
      notice = isLateCancel(slot, now)
        ? "Lemondtátok. Mivel 24 órán belül volt, nektek kell új időpontokat ajánlani."
        : "Lemondtátok. Egyeztessetek új időpontot.";
      break;
    }
    case "propose": {
      const slotErrors = proposalErrors(input.slots, now, deadline);
      if (slotErrors.length > 0) return { ok: false, error: slotErrorText(slotErrors), slotErrors };
      if (!(await clubAllowed(input.clubId, ctx.city))) return { ok: false, error: BAD_CLUB };
      const slots = [...new Set(input.slots.map(secs))].sort((x, y) => x - y);
      event = { kind: proposalKind(state, side), slots, clubId: input.clubId };
      notice = "Elküldtük az időpontokat a másik párnak.";
      break;
    }
    case "accept":
      if (!can.accept.some((s) => s.getTime() === input.slot.getTime())) return { ok: false, error: SLOT_GONE };
      event = { kind: "accepted", slot: input.slot };
      notice = "Lefixáltátok a meccset.";
      break;
    case "agreed": {
      const slotErrors = agreedTimeErrors(input.slot, now, deadline);
      if (slotErrors.length > 0) return { ok: false, error: slotErrorText(slotErrors), slotErrors };
      if (!(await clubAllowed(input.clubId, ctx.city))) return { ok: false, error: BAD_CLUB };
      event = { kind: "agreed_time", slot: input.slot, clubId: input.clubId };
      notice = "Rögzítettük. A másik pár megerősíti.";
      break;
    }
    case "confirm":
    case "decline":
      if (state.status !== "agreed_time" || !can.confirm) return { ok: false, error: NOTHING_TO_ANSWER };
      event = { kind: input.kind === "confirm" ? "agreed_confirmed" : "agreed_declined", slot: state.slot };
      notice = input.kind === "confirm" ? "Lefixáltátok a meccset." : "Jeleztük a másik párnak. Egyeztessetek újra.";
      break;
  }

  const pairId = side === "a" ? ctx.match.pairA : ctx.match.pairB;
  const after = schedulingState(
    [
      ...ctx.events.map((e) => toSchedulingEvent(e, ctx.match.pairA)),
      {
        kind: event.kind,
        side,
        at: now,
        slots: event.slots?.map((s) => new Date(s * 1000)),
        slot: event.slot,
        clubId: event.clubId,
        court: event.court,
      },
    ],
    now,
  );
  const revision = ctx.match.revision;
  // One batch (a transaction in D1). The event goes in only while the match
  // is still at the revision checked above: otherwise match_id comes out
  // null, NOT NULL fails and nothing is written.
  try {
    await db.batch([
      db.insert(matchEvents).values({
        matchId: sql<number>`(select ${matches.id} from ${matches} where ${matches.id} = ${matchId} and ${matches.revision} = ${revision})`,
        pairId,
        userId,
        kind: event.kind,
        slots: event.slots ?? null,
        slot: event.slot ?? null,
        clubId: event.clubId ?? null,
        court: event.court ?? null,
        at: now,
      }),
      db
        .update(matches)
        .set({
          revision: revision + 1,
          status: after.status === "scheduled" ? "scheduled" : "open",
          scheduledAt: after.status === "scheduled" ? after.slot : null,
          clubId: after.status === "scheduled" ? after.clubId : null,
        })
        .where(and(eq(matches.id, matchId), eq(matches.revision, revision))),
    ]);
  } catch (e) {
    if (/NOT NULL constraint failed: match_events\.match_id/i.test(`${e} ${(e as Error)?.cause ?? ""}`)) return { ok: false, error: CHANGED };
    throw e;
  }

  await tellOtherPair(ctx, side, event, state, now);
  return { ok: true, notice };
}

// The other pair learns about the step (spec 13): a proposal or an agreed
// time instantly (push, the app, and an email for the first such step of the
// Budapest day from this pair, #191); a scheduled match, a declined agreed
// time or a cancellation in the app and by push (the daily digest email is
// #31). Recording the venue tells nobody (#27).
async function tellOtherPair(ctx: MatchContext, side: Side, event: NewEvent, before: SchedulingState, now: Date): Promise<void> {
  if (event.kind === "venue") return;
  const [ours, theirs] = side === "a" ? [ctx.pairs.a, ctx.pairs.b] : [ctx.pairs.b, ctx.pairs.a];
  const matchId = ctx.match.id;
  // ctx.events is the log before this step.
  const emailed = schedulingEmailDue(
    ctx.events.map((e) => toSchedulingEvent(e, ctx.match.pairA)),
    side,
    now,
  );
  const mail = (messages: Parameters<typeof queueMatchEmails>[0]) => (emailed ? queueMatchEmails(messages) : undefined);
  const send = (kind: PlayerKind, message: Message) =>
    notifyPlayers(
      kind,
      theirs.players.map((p) => ({ userId: p.id, message })),
    );
  const venue = event.clubId ? ((await clubNames([event.clubId])).get(event.clubId) ?? null) : null;
  const base = (to: Person) => ({
    to: to.name,
    opponents: ours.players.map((p) => p.name).join(" és "),
    matchId,
    week: ctx.match.week,
    deadline: ctx.match.deadline,
    venue,
  });
  try {
    switch (event.kind) {
      case "proposal":
      case "counter_proposal": {
        const slots = (event.slots ?? []).map((s) => new Date(s * 1000));
        const counter = event.kind === "counter_proposal";
        await mail(theirs.players.map((p) => ({ kind: "match_proposal", toEmail: p.email, input: { ...base(p), counter, slots } })));
        await send("match_proposal", matchProposalMessage({ matchId, week: ctx.match.week, counter, slots: slots.length }));
        break;
      }
      case "agreed_time":
        await mail(theirs.players.map((p) => ({ kind: "match_agreed_time", toEmail: p.email, input: { ...base(p), slot: event.slot! } })));
        await send("match_agreed_time", matchAgreedTimeMessage({ matchId, slot: event.slot! }));
        break;
      case "accepted":
        await send("match_scheduled", matchScheduledMessage({ matchId, slot: event.slot!, confirmed: false }));
        break;
      case "agreed_confirmed":
        await send("match_scheduled", matchScheduledMessage({ matchId, slot: event.slot!, confirmed: true }));
        break;
      case "agreed_declined":
        if (before.status === "agreed_time") await send("match_declined", matchDeclinedMessage({ matchId, slot: before.slot }));
        break;
      case "cancelled":
        await send("match_cancelled", matchCancelledMessage({ matchId, slot: event.slot!, late: isLateCancel(event.slot!, now) }));
        break;
    }
  } catch (error) {
    // The step is saved; a failed notice must not undo or hide it.
    logError("match notification failed", { matchId, error });
  }
}
