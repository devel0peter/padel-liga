import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { leagues, pairs, seasonEntries, users } from "~/db/schema";
import { queueSeasonEntered } from "~/lib/email/outbox.server";
import { seasonEntryMessage } from "~/lib/notifications";
import { notifyPlayers } from "~/lib/notifications.server";

import type { User } from "./auth/session.server";
import { audit } from "./leagues.server";
import {
  averageStartingElo,
  checkEntry,
  ENTRY_REFUSALS,
  entryOpen,
  entryView,
  joinsPhase,
  type EntryStatus,
  type EntryView,
} from "./season-entries";
import type { Season } from "./seasons";
import { getSeason } from "./seasons.server";
import { FIRST_PHASE, groupsPublished } from "./groups.server";

// Season entries in D1 (#23). The rules are in season-entries.ts.

type Result = { ok: true } | { ok: false; error: string };

const playerA = alias(users, "player_a_user");
const playerB = alias(users, "player_b_user");

type ActivePair = {
  id: number;
  leagueId: number;
  players: [string, string];
  myLevel: string | null;
  partnerLevel: string | null;
};

// The player's active pair in each of these leagues, with both levels.
async function activePairs(userId: string, leagueIds: number[]): Promise<Map<number, ActivePair>> {
  if (leagueIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: pairs.id,
      leagueId: pairs.leagueId,
      playerA: pairs.playerA,
      playerB: pairs.playerB,
      levelA: playerA.level,
      levelB: playerB.level,
    })
    .from(pairs)
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(
      and(
        inArray(pairs.leagueId, leagueIds),
        eq(pairs.status, "active"),
        or(eq(pairs.playerA, userId), eq(pairs.playerB, userId)),
      ),
    );
  return new Map(
    rows.map((r) => {
      const mine = r.playerA === userId;
      return [
        r.leagueId,
        {
          id: r.id,
          leagueId: r.leagueId,
          players: [r.playerA, r.playerB],
          myLevel: mine ? r.levelA : r.levelB,
          partnerLevel: mine ? r.levelB : r.levelA,
        },
      ];
    }),
  );
}

type StoredEntry = { seasonId: number; pairId: number; status: EntryStatus; joinsPhase: number | null; note: string | null; playerA: string; playerB: string };

// The season entries of pairs this player was in, for these seasons.
async function entriesOf(userId: string, seasonIds: number[]): Promise<StoredEntry[]> {
  if (seasonIds.length === 0) return [];
  return db
    .select({
      seasonId: seasonEntries.seasonId,
      pairId: seasonEntries.pairId,
      status: seasonEntries.status,
      joinsPhase: seasonEntries.joinsPhase,
      note: seasonEntries.note,
      playerA: pairs.playerA,
      playerB: pairs.playerB,
    })
    .from(seasonEntries)
    .innerJoin(pairs, eq(pairs.id, seasonEntries.pairId))
    .where(and(inArray(seasonEntries.seasonId, seasonIds), or(eq(pairs.playerA, userId), eq(pairs.playerB, userId))));
}

// The entry that counts for this pair in this season: its own, or one of an
// earlier pair of the same two players that wasn't withdrawn, so dissolving
// and re-forming the pair doesn't get round a rejection (D17).
function entryFor(entries: readonly StoredEntry[], seasonId: number, pair: ActivePair): StoredEntry | undefined {
  const same = (e: StoredEntry) => [e.playerA, e.playerB].sort().join() === [...pair.players].sort().join();
  return (
    entries.find((e) => e.seasonId === seasonId && e.pairId === pair.id) ??
    entries.find((e) => e.seasonId === seasonId && e.status !== "withdrawn" && same(e))
  );
}

// What the player sees for each of these seasons (Párom and the home page):
// a season with nothing to show is left out.
export async function entryViews(user: User, list: readonly Season[], now = new Date()): Promise<Map<number, EntryView>> {
  const views = new Map<number, EntryView>();
  if (list.length === 0) return views;
  const mine = await activePairs(user.id, [...new Set(list.map((s) => s.leagueId))]);
  const entries = mine.size ? await entriesOf(user.id, list.map((s) => s.id)) : [];
  for (const season of list) {
    const pair = mine.get(season.leagueId);
    const entry = pair ? entryFor(entries, season.id, pair) : undefined;
    const view = entryView({
      season,
      now,
      hasPair: !!pair,
      myLevel: pair?.myLevel ?? user.level ?? null,
      partnerLevel: pair?.partnerLevel ?? null,
      entry: entry ?? null,
    });
    if (view) views.set(season.id, view);
  }
  return views;
}

async function entryRefusal(user: User, season: Season, now: Date) {
  const pair = (await activePairs(user.id, [season.leagueId])).get(season.leagueId);
  const entered = pair ? !!entryFor(await entriesOf(user.id, [season.id]), season.id, pair) : false;
  const refusal = checkEntry({
    hasPair: !!pair,
    open: entryOpen(season, now),
    entered,
    myLevel: pair?.myLevel ?? null,
    partnerLevel: pair?.partnerLevel ?? null,
  });
  return { pair, refusal };
}

type Joins = { phase: number; startsAt: Date } | null;

// Enters the pair at `now` (#153, D60): the entry counts at once, from the
// joining phase. One statement re-checks that the pair is still active, both
// players have a level and the same two players have no other entry here,
// and that phase 1's groups weren't published meanwhile; the unique index
// settles a double submit. A withdrawn entry of the same pair is entered
// again (#154). Returns where the pair starts, or null when nothing changed.
async function enter(
  season: Season,
  pair: { id: number; players: [string, string] },
  decidedBy: string | null,
  now: Date,
): Promise<{ joins: Joins } | null> {
  const [a, b] = pair.players;
  // A pair entered once phase 1's groups are out starts at phase 2 (#24).
  const published = (await groupsPublished(season.id)) ? [FIRST_PHASE] : [];
  const phase = joinsPhase(season.phases, now, published);
  const seconds = Math.floor(now.getTime() / 1000);
  const inserted = await db.all(sql`insert into ${seasonEntries} (season_id, pair_id, status, joins_phase, decided_by, decided_at, updated_at)
    select ${season.id}, ${pair.id}, 'approved', ${phase}, ${decidedBy}, ${seconds}, ${seconds}
    where exists (select 1 from ${pairs} where ${pairs.id} = ${pair.id} and ${pairs.status} = 'active')
      and (select count(*) from ${users} where ${users.id} in (${a}, ${b}) and ${users.level} is not null) = 2
      and not exists (
        select 1 from season_entries se join pairs p on p.id = se.pair_id
        where se.season_id = ${season.id} and se.status <> 'withdrawn'
          and ((p.player_a = ${a} and p.player_b = ${b}) or (p.player_a = ${b} and p.player_b = ${a}))
      )
      and (${phase} is not ${FIRST_PHASE} or not exists (
        select 1 from groups g where g.season_id = ${season.id} and g.phase = ${FIRST_PHASE} and g.published_at is not null
      ))
    on conflict (season_id, pair_id) do update set
      status = 'approved', joins_phase = excluded.joins_phase, decided_by = excluded.decided_by,
      decided_at = excluded.decided_at, updated_at = excluded.updated_at, note = null
    where season_entries.status = 'withdrawn'
    returning id`);
  if (inserted.length === 0) return null;
  return { joins: phase === null ? null : { phase, startsAt: season.phases.find((p) => p.number === phase)!.startsAt } };
}

// Both players of the pair, with what the notices need.
async function pairPlayers(pairId: number) {
  const [row] = await db
    .select({
      league: leagues.name,
      a: { id: playerA.id, email: playerA.email, name: playerA.name },
      b: { id: playerB.id, email: playerB.email, name: playerB.name },
    })
    .from(pairs)
    .innerJoin(leagues, eq(leagues.id, pairs.leagueId))
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(eq(pairs.id, pairId));
  return row;
}

// "Nevezünk" (D18): either player of an active pair in the season's league.
// The entry counts at once; both players get the notice in the app (and by
// push, whatever their email switch says, #115) and the email.
export async function applyToSeason(
  user: User,
  seasonId: number,
  now = new Date(),
): Promise<{ ok: true; joins: Joins } | { ok: false; error: string }> {
  const season = await getSeason(seasonId);
  if (!season) return { ok: false, error: "Nincs ilyen szezon." };
  const { pair, refusal } = await entryRefusal(user, season, now);
  if (refusal) return { ok: false, error: ENTRY_REFUSALS[refusal] };
  const entered = await enter(season, pair!, null, now);
  if (!entered) {
    // Something changed in the meantime: say what, from the state now.
    const again = await entryRefusal(user, season, now);
    return { ok: false, error: again.refusal ? ENTRY_REFUSALS[again.refusal] : "Ez a pár már nem létezik." };
  }
  const players = await pairPlayers(pair!.id);
  if (players) {
    const message = seasonEntryMessage({ league: players.league, season: season.name, joins: entered.joins });
    await notifyPlayers("season_entry_decision", [players.a, players.b].map((p) => ({ userId: p.id, message })));
    for (const [to, partner] of [
      [players.a, players.b],
      [players.b, players.a],
    ])
      await queueSeasonEntered(to.email, { to: to.name, partnerName: partner.name, league: players.league, season: season.name, joins: entered.joins });
  }
  return { ok: true, joins: entered.joins };
}

export type EntryRow = {
  id: number;
  status: EntryStatus;
  appliedAt: Date;
  note: string | null;
  joinsPhase: number | null;
  decidedAt: Date | null;
  pairActive: boolean;
  players: { name: string; level: string | null }[];
  averageElo: number | null;
};

// The organizer's list of a season's entered pairs, in the order they
// entered. Names and levels only: no email or phone.
export async function listSeasonEntries(seasonId: number): Promise<EntryRow[]> {
  const rows = await db
    .select({
      id: seasonEntries.id,
      status: seasonEntries.status,
      appliedAt: seasonEntries.createdAt,
      note: seasonEntries.note,
      joinsPhase: seasonEntries.joinsPhase,
      decidedAt: seasonEntries.decidedAt,
      pairStatus: pairs.status,
      nameA: playerA.name,
      levelA: playerA.level,
      nameB: playerB.name,
      levelB: playerB.level,
    })
    .from(seasonEntries)
    .innerJoin(pairs, eq(pairs.id, seasonEntries.pairId))
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.status, "approved")))
    .orderBy(asc(seasonEntries.createdAt), asc(seasonEntries.id));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    appliedAt: r.appliedAt,
    note: r.note,
    joinsPhase: r.joinsPhase,
    decidedAt: r.decidedAt,
    pairActive: r.pairStatus === "active",
    players: [
      { name: r.nameA, level: r.levelA },
      { name: r.nameB, level: r.levelB },
    ],
    averageElo: averageStartingElo(r.levelA, r.levelB),
  }));
}

// Entered pairs per season, for each of these seasons.
export async function entryCounts(seasonIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>(seasonIds.map((id) => [id, 0]));
  if (seasonIds.length === 0) return out;
  const rows = await db
    .select({ seasonId: seasonEntries.seasonId, n: count() })
    .from(seasonEntries)
    .where(and(inArray(seasonEntries.seasonId, seasonIds), eq(seasonEntries.status, "approved")))
    .groupBy(seasonEntries.seasonId);
  for (const r of rows) out.set(r.seasonId, r.n);
  return out;
}

// D19: dissolving a pair withdraws the entries it hasn't played in: pending
// ones (left from the approval step), and approved ones whose first phase hasn't started (or that wait for
// the next season). For the dissolve batch in pairs.server.ts, after the
// pair's update: it does nothing unless the pair is dissolved by then.
export function withdrawEntries(pairId: number, now: Date) {
  const seconds = Math.floor(now.getTime() / 1000);
  return db
    .update(seasonEntries)
    .set({ status: "withdrawn", updatedAt: now })
    .where(
      and(
        eq(seasonEntries.pairId, pairId),
        sql`exists (select 1 from pairs where pairs.id = ${pairId} and pairs.status = 'dissolved')`,
        sql`(season_entries.status = 'pending' or (season_entries.status = 'approved' and (
          season_entries.joins_phase is null or exists (
            select 1 from season_phases sp
            where sp.season_id = season_entries.season_id and sp.number = season_entries.joins_phase and sp.starts_at > ${seconds}
          ))))`,
      ),
    );
}

// The season of an organizer's entries page, if it belongs to the league.
export async function seasonOfLeague(seasonId: number, leagueId: number): Promise<Season | undefined> {
  const season = await getSeason(seasonId);
  return season && season.leagueId === leagueId ? season : undefined;
}

