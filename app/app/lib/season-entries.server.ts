import { and, asc, count, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { rowSelect } from "~/db/insert-select";
import { groupPairs, groups, leagues, matches, pairs, seasonEntries, seasonPhases, users } from "~/db/schema";
import { queueSeasonEntered } from "~/lib/email/outbox.server";
import { pairWithdrawnMessage, seasonEntryMessage } from "~/lib/notifications";
import { notifyPlayers } from "~/lib/notifications.server";

import type { User } from "./auth/session.server";
import { auditIfChanged } from "./audit.server";
import {
  averageElo,
  checkEntry,
  ENTRY_REFUSALS,
  entryOpen,
  entryPhase,
  entryView,
  IN_RUNNING_PHASE,
  noLevelRefusal,
  NOT_IN_RUNNING_PHASE,
  ORGANIZER_ENTRY_REFUSALS,
  withdrawalReasonError,
  type EntryStatus,
  type EntryView,
} from "./season-entries";
import { isWaiting, type Season } from "./seasons";
import { announceSeasonStart, fixStartStatements } from "./season-start.server";
import { getSeason } from "./seasons.server";
import { notInRunningGroup, pairInRunningGroup, phasesWithGroups } from "./groups.server";

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

// What the player sees for each of these seasons (Párod and the home page):
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

// startsAt null: a first season still waiting for its minimum entries (D124).
type Joins = { phase: number; startsAt: Date | null } | null;

// Enters the pair at `now` (#153, D62): the entry counts at once, from the
// joining phase. One statement re-checks that the pair is still active, both
// players have a level and the same two players have no other entry here,
// and that phase 1's groups weren't published meanwhile; the unique index
// settles a double submit. A withdrawn entry of the same pair is entered
// again (#154). Returns where the pair starts, or null when nothing changed.
// `logged`: an organizer's entry, audited in the same batch (#225); a
// player's own entry isn't. In a first season waiting for its minimum
// (D124) the pair starts in phase 1, and the same batch fixes the season's
// start if this entry reaches the minimum (`started`): every entered player
// is told then, and the caller sends no notice of the entry itself.
async function enter(
  season: Season,
  pair: { id: number; players: [string, string] },
  decidedBy: string | null,
  now: Date,
  logged?: { actorId: string },
): Promise<{ id: number; joins: Joins; started: boolean } | null> {
  const [a, b] = pair.players;
  const waiting = isWaiting(season);
  // A pair entered once a phase's groups are out starts at the phase after
  // it (#24), also when a later phase is published before it starts (a
  // round switch before a break, #35).
  const published = waiting ? [] : (await phasesWithGroups(season.id)).filter((p) => p.published).map((p) => p.phase);
  const phase = entryPhase(season, now, published);
  const seconds = Math.floor(now.getTime() / 1000);
  // A builder (insert ... select from the pair's row), not a raw statement,
  // so it can share a D1 batch with the audit entry.
  const upsert = db
    .insert(seasonEntries)
    .select(
      rowSelect(
        seasonEntries,
        {
          id: sql`null`,
          seasonId: sql`${season.id}`,
          pairId: sql`${pair.id}`,
          status: sql`'approved'`,
          note: sql`null`,
          decidedBy: sql`${decidedBy}`,
          decidedAt: sql`${seconds}`,
          joinsPhase: sql`${phase}`,
          updatedAt: sql`${seconds}`,
          createdAt: sql`unixepoch()`,
        },
        sql`where exists (select 1 from ${pairs} where ${pairs.id} = ${pair.id} and ${pairs.status} = 'active')
          and (select count(*) from ${users} where ${users.id} in (${a}, ${b}) and ${users.level} is not null) = 2
          and not exists (
            select 1 from season_entries se join pairs p on p.id = se.pair_id
            where se.season_id = ${season.id} and se.status <> 'withdrawn'
              and ((p.player_a = ${a} and p.player_b = ${b}) or (p.player_a = ${b} and p.player_b = ${a}))
          )
          and not exists (
            select 1 from groups g where g.season_id = ${season.id} and g.phase = ${phase} and g.published_at is not null
          )`,
      ),
    )
    .onConflictDoUpdate({
      target: [seasonEntries.seasonId, seasonEntries.pairId],
      set: {
        status: "approved",
        joinsPhase: sql`excluded.joins_phase`,
        decidedBy: sql`excluded.decided_by`,
        decidedAt: sql`excluded.decided_at`,
        updatedAt: sql`excluded.updated_at`,
        note: null,
      },
      setWhere: eq(seasonEntries.status, "withdrawn"),
    })
    .returning({ id: seasonEntries.id });
  const entryId = sql`(select ${seasonEntries.id} from ${seasonEntries} where ${seasonEntries.seasonId} = ${season.id} and ${seasonEntries.pairId} = ${pair.id})`;
  const audit = logged
    ? [
        auditIfChanged({
          actorId: logged.actorId,
          action: "season_entry.enter",
          target: sql`'season_entry:' || ${entryId}`,
          detail: `pair:${pair.id}`,
          leagueId: season.leagueId,
        }),
      ]
    : [];
  // The audit right after the upsert: auditIfChanged reads its changes().
  const start = waiting ? fixStartStatements(season, now) : null;
  const results = start
    ? await db.batch([upsert, ...audit, start.fix, ...start.phases])
    : logged
      ? await db.batch([upsert, ...audit])
      : [await upsert];
  const [row] = results[0] as { id: number }[];
  const started = !!start && (results[1 + audit.length] as { id: number }[]).length > 0;
  if (started) await announceSeasonStart(season.id, start!.startsAt);
  if (!row) return null;
  if (phase === null) return { id: row.id, joins: null, started };
  const startsAt = started
    ? start!.startsAt
    : waiting
      ? // Another entry may have fixed the start between our read and our
        // batch, and announced it before this entry counted: then this
        // pair's own notice carries the date (D124).
        ((await getSeason(season.id))?.phases.find((p) => p.number === phase)?.startsAt ?? null)
      : season.phases.find((p) => p.number === phase)!.startsAt;
  return { id: row.id, joins: { phase, startsAt }, started };
}

// Both players of the pair, with what the notices need.
export async function pairPlayers(pairId: number) {
  const [row] = await db
    .select({
      league: leagues.name,
      a: { id: playerA.id, email: playerA.email, name: playerA.name, phone: playerA.phone },
      b: { id: playerB.id, email: playerB.email, name: playerB.name, phone: playerB.phone },
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
  // The entry that started the season (D124): its players had the start
  // notice with everyone else, so no second email or notice.
  const players = entered.started ? undefined : await pairPlayers(pair!.id);
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

// --- The organizer on Párok (#154) -------------------------------------------

// The active pair of the league, with both players' levels and names.
async function leaguePair(leagueId: number, pairId: number) {
  const [row] = await db
    .select({
      id: pairs.id,
      status: pairs.status,
      a: { id: playerA.id, name: playerA.name, level: playerA.level },
      b: { id: playerB.id, name: playerB.name, level: playerB.level },
    })
    .from(pairs)
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(and(eq(pairs.id, pairId), eq(pairs.leagueId, leagueId)));
  return row;
}

// The entry that counts for these two players in this season (as entryFor):
// the pair's own row, or a not withdrawn one of an earlier pair of the same
// two players.
async function countingEntry(seasonId: number, pairId: number, a: string, b: string) {
  const rows = await db
    .select({ id: seasonEntries.id, pairId: seasonEntries.pairId, status: seasonEntries.status })
    .from(seasonEntries)
    .innerJoin(pairs, eq(pairs.id, seasonEntries.pairId))
    .where(
      and(
        eq(seasonEntries.seasonId, seasonId),
        or(and(eq(pairs.playerA, a), eq(pairs.playerB, b)), and(eq(pairs.playerA, b), eq(pairs.playerB, a))),
      ),
    );
  return rows.find((r) => r.pairId === pairId && r.status !== "withdrawn") ?? rows.find((r) => r.status !== "withdrawn");
}

async function notifyPair(pairId: number, season: Season, event: "entered_by_organizer" | "removed", joins: Joins) {
  const players = await pairPlayers(pairId);
  if (!players) return;
  const message = seasonEntryMessage({ league: players.league, season: season.name, joins }, event);
  // In the app (and by push) only: no email, the organizer tells the players.
  await notifyPlayers("season_entry_decision", [players.a, players.b].map((p) => ({ userId: p.id, message })));
}

// "Benevezés" (#154): the organizer enters an active pair of their league,
// exactly as if one of the players had clicked "Nevezünk" (same checks, same
// joining phase), also a pair taken out before. Both players are told in the
// app only; no email.
export async function enterPairByOrganizer(
  actor: { id: string },
  leagueId: number,
  pairId: number,
  seasonId: number,
  now = new Date(),
): Promise<{ ok: true; joins: Joins } | { ok: false; error: string }> {
  const season = await getSeason(seasonId);
  if (!season || season.leagueId !== leagueId) return { ok: false, error: "Nincs ilyen szezon." };
  const pair = await leaguePair(leagueId, pairId);
  if (!pair || pair.status !== "active") return { ok: false, error: ORGANIZER_ENTRY_REFUSALS.no_pair };
  if (await countingEntry(seasonId, pairId, pair.a.id, pair.b.id)) return { ok: false, error: ORGANIZER_ENTRY_REFUSALS.entered };
  if (!entryOpen(season, now)) return { ok: false, error: ORGANIZER_ENTRY_REFUSALS.closed };
  const missing = [pair.a, pair.b].filter((p) => !p.level).map((p) => p.name || "Névtelen");
  if (missing.length) return { ok: false, error: noLevelRefusal(missing) };
  const entered = await enter(season, { id: pair.id, players: [pair.a.id, pair.b.id] }, actor.id, now, { actorId: actor.id });
  if (!entered) return { ok: false, error: "A pár közben változott. Frissítsd az oldalt." };
  if (!entered.started) await notifyPair(pairId, season, "entered_by_organizer", entered.joins);
  return { ok: true, joins: entered.joins };
}

// "Kivétel a szezonból" (#154): the organizer withdraws an entered pair's
// entry, so it is left out of every group draft made from then on; the pair
// stays a pair. Refused while the pair plays in a running phase (that is
// withdrawPairMidPhase, #34), checked inside the write. Both players are told in the
// app only; no email.
export async function removePairFromSeason(
  actor: { id: string },
  leagueId: number,
  pairId: number,
  seasonId: number,
  now = new Date(),
): Promise<Result> {
  const season = await getSeason(seasonId);
  if (!season || season.leagueId !== leagueId) return { ok: false, error: "Nincs ilyen szezon." };
  const pair = await leaguePair(leagueId, pairId);
  if (!pair) return { ok: false, error: "Nincs ilyen pár." };
  if (await pairInRunningGroup(pairId, now)) return { ok: false, error: IN_RUNNING_PHASE };
  const [updated] = await db.batch([
    db
      .update(seasonEntries)
      .set({ status: "withdrawn", decidedBy: actor.id, decidedAt: now, updatedAt: now })
      .where(
        and(
          eq(seasonEntries.seasonId, seasonId),
          eq(seasonEntries.pairId, pairId),
          inArray(seasonEntries.status, ["approved", "pending"]),
          notInRunningGroup(pairId, now),
        ),
      )
      .returning({ id: seasonEntries.id }),
    auditIfChanged({
      actorId: actor.id,
      action: "season_entry.remove",
      target: sql`'season_entry:' || (select ${seasonEntries.id} from ${seasonEntries} where ${seasonEntries.seasonId} = ${seasonId} and ${seasonEntries.pairId} = ${pairId})`,
      detail: `pair:${pairId}`,
      leagueId,
    }),
  ]);
  if (updated.length === 0) {
    if (await pairInRunningGroup(pairId, now)) return { ok: false, error: IN_RUNNING_PHASE };
    return { ok: false, error: "Ez a pár nem nevezett erre a szezonra. Frissítsd az oldalt." };
  }
  await notifyPair(pairId, season, "removed", null);
  return { ok: true };
}

// "Kivétel a szezonból" while the pair plays in a running round (#34, D87):
// the pair is withdrawn from its group(s) of the season whose phase hasn't
// ended, so every match it has there leaves the table, played or not, and
// takes no more steps; and its entry is withdrawn as after "Kivétel" (no
// next phase, entered again it joins the next one). One batch: the group
// rows, the matches' revision (a step in flight fails its guard), the entry.
// The pair's players and the group's other pairs are told in the app and by
// push only; no email.
export async function withdrawPairMidPhase(
  actor: { id: string },
  leagueId: number,
  pairId: number,
  seasonId: number,
  reason: string,
  now = new Date(),
): Promise<Result> {
  const season = await getSeason(seasonId);
  if (!season || season.leagueId !== leagueId) return { ok: false, error: "Nincs ilyen szezon." };
  const pair = await leaguePair(leagueId, pairId);
  if (!pair) return { ok: false, error: "Nincs ilyen pár." };
  const invalid = withdrawalReasonError(reason);
  if (invalid) return { ok: false, error: invalid };
  const why = reason.trim();
  const running = await db
    .select({ id: groups.id, number: groups.number, phase: groups.phase })
    .from(groupPairs)
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .innerJoin(seasonPhases, and(eq(seasonPhases.seasonId, groups.seasonId), eq(seasonPhases.number, groups.phase)))
    .where(
      and(
        eq(groupPairs.pairId, pairId),
        isNull(groupPairs.withdrawnAt),
        eq(groups.seasonId, seasonId),
        isNotNull(groups.publishedAt),
        gte(seasonPhases.deadline, now),
      ),
    );
  if (running.length === 0) return { ok: false, error: NOT_IN_RUNNING_PHASE };
  const ids = running.map((g) => g.id);
  const [withdrawn] = await db.batch([
    db
      .update(groupPairs)
      .set({ withdrawnAt: now, withdrawalReason: why })
      .where(and(inArray(groupPairs.groupId, ids), eq(groupPairs.pairId, pairId), isNull(groupPairs.withdrawnAt)))
      .returning({ groupId: groupPairs.groupId }),
    auditIfChanged({
      actorId: actor.id,
      action: "season_entry.withdraw",
      target: `pair:${pairId}`,
      detail: `season:${seasonId} groups:${ids.join(",")}`,
      leagueId,
    }),
    db
      .update(matches)
      .set({ revision: sql`${matches.revision} + 1` })
      .where(and(inArray(matches.groupId, ids), or(eq(matches.pairA, pairId), eq(matches.pairB, pairId)))),
    db
      .update(seasonEntries)
      .set({ status: "withdrawn", decidedBy: actor.id, decidedAt: now, updatedAt: now })
      .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.pairId, pairId), inArray(seasonEntries.status, ["approved", "pending"]))),
  ]);
  if (withdrawn.length === 0) return { ok: false, error: NOT_IN_RUNNING_PHASE };
  await notifyWithdrawal(pairId, season, running, why);
  return { ok: true };
}

async function notifyWithdrawal(pairId: number, season: Season, running: { id: number; number: number; phase: number }[], reason: string) {
  const players = await pairPlayers(pairId);
  if (!players) return;
  const others = await db
    .select({ groupId: groupPairs.groupId, a: pairs.playerA, b: pairs.playerB })
    .from(groupPairs)
    .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
    .where(and(inArray(groupPairs.groupId, running.map((g) => g.id)), ne(groupPairs.pairId, pairId), isNull(groupPairs.withdrawnAt)));
  const messages = running.flatMap((g) => {
    const input = { league: players.league, season: season.name, phase: g.phase, group: g.number, reason };
    const own = pairWithdrawnMessage(input, "pair");
    const theirs = pairWithdrawnMessage(input, "group");
    return [
      ...[players.a, players.b].map((p) => ({ userId: p.id, message: own })),
      ...others.filter((o) => o.groupId === g.id).flatMap((o) => [o.a, o.b].map((userId) => ({ userId, message: theirs }))),
    ];
  });
  await notifyPlayers("pair_withdrawn", messages);
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
      eloA: playerA.elo,
      nameB: playerB.name,
      levelB: playerB.level,
      eloB: playerB.elo,
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
    averageElo: averageElo({ elo: r.eloA, level: r.levelA }, { elo: r.eloB, level: r.levelB }),
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
// the next season), also those of a first season still waiting for its
// minimum (D124: no phases yet). For the dissolve batch in pairs.server.ts,
// after the pair's update: it does nothing unless the pair is dissolved by
// then.
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
          ) or not exists (select 1 from season_phases sp where sp.season_id = season_entries.season_id)
          )))`,
      ),
    );
}

// The season of an organizer's entries page, if it belongs to the league.
export async function seasonOfLeague(seasonId: number, leagueId: number): Promise<Season | undefined> {
  const season = await getSeason(seasonId);
  return season && season.leagueId === leagueId ? season : undefined;
}

