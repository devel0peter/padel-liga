import { movePair, phaseMatches, seedGroups } from "@padel-liga/rules";
import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { groupPairs, groups, leagues, matches, pairs, seasonEntries, seasonPhases, users } from "~/db/schema";
import { queueGroupsPublished } from "~/lib/email/outbox.server";
import { groupsPublishedMessage } from "~/lib/notifications";
import { notifyPlayers } from "~/lib/notifications.server";

import { auditEntry, auditWhen, leagueOfSeason } from "./audit.server";
import { cannotSplit, draftIsStale, FIRST_PHASE, pairWeeks, publishBlocker, weekRange } from "./groups";
import { updateElo } from "./elo.server";
import { averageElo } from "./season-entries";
import { getSeason } from "./seasons.server";

// A phase's groups in D1: the first phase's (#24, D20-D22) and, through
// round-switch.server.ts, every later phase's (#35, D107). The rules are in
// groups.ts and packages/rules (seedGroups, roundSwitchDraft, movePair,
// phaseMatches).

type Result = { ok: true } | { ok: false; error: string };

export { FIRST_PHASE };

const LOCKED = "A csoportok már kint vannak, nem módosíthatók.";
const CHANGED = "A javaslat közben változott. Frissítsd az oldalt.";

const playerA = alias(users, "player_a_user");
const playerB = alias(users, "player_b_user");

// Id and email stay on the server: only the publish notifications use them.
type Player = { id: string; name: string; level: string | null; email: string };

export type GroupPair = {
  pairId: number;
  players: [Player, Player];
  averageElo: number;
  // False once the pair was dissolved after the draft was made.
  active: boolean;
  // Withdrawn mid-phase from a published group (#34): out of its table,
  // with the organizer's reason (for the organizer's pages only).
  withdrawn: boolean;
  withdrawalReason: string | null;
};

export type StoredGroup = { id: number; number: number; revision: number; basis: string | null; publishedAt: Date | null; pairs: GroupPair[] };

const pairColumns = {
  pairId: pairs.id,
  pairStatus: pairs.status,
  idA: playerA.id,
  nameA: playerA.name,
  levelA: playerA.level,
  eloA: playerA.elo,
  emailA: playerA.email,
  idB: playerB.id,
  nameB: playerB.name,
  levelB: playerB.level,
  eloB: playerB.elo,
  emailB: playerB.email,
};

type PairRow = {
  pairId: number;
  pairStatus: "active" | "dissolved";
  idA: string;
  nameA: string;
  levelA: string | null;
  eloA: number | null;
  emailA: string;
  idB: string;
  nameB: string;
  levelB: string | null;
  eloB: number | null;
  emailB: string;
};

function groupPair(r: PairRow): GroupPair {
  return {
    pairId: r.pairId,
    players: [
      { id: r.idA, name: r.nameA, level: r.levelA, email: r.emailA },
      { id: r.idB, name: r.nameB, level: r.levelB, email: r.emailB },
    ],
    // Both levels are required to enter (D18); the pair's rating is the
    // average current Elo (#13), the starting value before a rated match (D20).
    averageElo: averageElo({ elo: r.eloA, level: r.levelA }, { elo: r.eloB, level: r.levelB }) ?? 0,
    active: r.pairStatus === "active",
    withdrawn: false,
    withdrawalReason: null,
  };
}

// The pairs that go into the first phase's groups: approved for phase 1 and
// still active (a pair dissolved after phase 1 started keeps its approved
// entry, D19, but plays no more), both levels set, in approval order, which
// breaks Elo ties (D20).
export async function eligiblePairs(seasonId: number): Promise<GroupPair[]> {
  const rows = await db
    .select(pairColumns)
    .from(seasonEntries)
    .innerJoin(pairs, eq(pairs.id, seasonEntries.pairId))
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(
      and(
        eq(seasonEntries.seasonId, seasonId),
        eq(seasonEntries.status, "approved"),
        eq(seasonEntries.joinsPhase, FIRST_PHASE),
        eq(pairs.status, "active"),
        isNotNull(playerA.level),
        isNotNull(playerB.level),
      ),
    )
    .orderBy(asc(seasonEntries.decidedAt), asc(seasonEntries.id));
  return rows.map(groupPair);
}

// Every pair entered in the season with an entry that counts (approved,
// with a joining phase), still active, both levels set, in approval order,
// with the phase it joins: the round switch's continuing and new pairs (#35).
export async function enteredPairs(seasonId: number): Promise<(GroupPair & { joinsPhase: number })[]> {
  const rows = await db
    .select({ ...pairColumns, joinsPhase: seasonEntries.joinsPhase })
    .from(seasonEntries)
    .innerJoin(pairs, eq(pairs.id, seasonEntries.pairId))
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(
      and(
        eq(seasonEntries.seasonId, seasonId),
        eq(seasonEntries.status, "approved"),
        isNotNull(seasonEntries.joinsPhase),
        eq(pairs.status, "active"),
        isNotNull(playerA.level),
        isNotNull(playerB.level),
      ),
    )
    .orderBy(asc(seasonEntries.decidedAt), asc(seasonEntries.id));
  return rows.map((r) => ({ ...groupPair(r), joinsPhase: r.joinsPhase! }));
}

// A phase's groups (draft or published), 1. csoport first, each by seed.
export async function phaseGroups(seasonId: number, phase = FIRST_PHASE): Promise<StoredGroup[]> {
  const list = await db
    .select({ id: groups.id, number: groups.number, revision: groups.revision, basis: groups.basis, publishedAt: groups.publishedAt })
    .from(groups)
    .where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase)))
    .orderBy(asc(groups.number));
  if (list.length === 0) return [];
  const rows = await db
    .select({
      groupId: groupPairs.groupId,
      withdrawnAt: groupPairs.withdrawnAt,
      withdrawalReason: groupPairs.withdrawalReason,
      ...pairColumns,
    })
    .from(groupPairs)
    .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(
      inArray(
        groupPairs.groupId,
        db.select({ id: groups.id }).from(groups).where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase))),
      ),
    )
    .orderBy(asc(groupPairs.groupId), asc(groupPairs.seed));
  return list.map((g) => ({
    ...g,
    pairs: rows
      .filter((r) => r.groupId === g.id)
      .map((r) => ({ ...groupPair(r), withdrawn: r.withdrawnAt !== null, withdrawalReason: r.withdrawalReason })),
  }));
}

// Whether a season's first-phase groups are published (seasons.ts seasonActions).
export async function groupsPublished(seasonId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.seasonId, seasonId), isNotNull(groups.publishedAt)))
    .limit(1);
  return !!row;
}

// The rounds whose groups are published, per season (the landing page's
// joining point skips them, landing-league.ts).
export async function publishedPhases(): Promise<Map<number, number[]>> {
  const rows = await db
    .selectDistinct({ seasonId: groups.seasonId, phase: groups.phase })
    .from(groups)
    .where(isNotNull(groups.publishedAt))
    .orderBy(asc(groups.seasonId), asc(groups.phase));
  const out = new Map<number, number[]>();
  for (const { seasonId, phase } of rows) out.set(seasonId, [...(out.get(seasonId) ?? []), phase]);
  return out;
}

// D1 allows at most 100 bound parameters per statement. Drizzle binds a
// column's default too (revision 0), so count every column it writes.
const GROUP_CHUNK = 16; // 5 per row: season, phase, number, basis, revision
const PAIR_CHUNK = 15; // 5 per row: the group id subquery binds 3
const MATCH_CHUNK = 13; // 7 per row (the status and revision defaults are bound), plus 4 for the claim check in the first

// Whether the pair plays in a published group whose phase hasn't ended:
// such a pair can't be dissolved (D16) or rejected, or the published groups
// and their matches would change. A pair withdrawn from that group (#34)
// plays there no more.
export async function pairInRunningGroup(pairId: number, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: groupPairs.groupId })
    .from(groupPairs)
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .innerJoin(seasonPhases, and(eq(seasonPhases.seasonId, groups.seasonId), eq(seasonPhases.number, groups.phase)))
    .where(
      and(eq(groupPairs.pairId, pairId), isNull(groupPairs.withdrawnAt), isNotNull(groups.publishedAt), gte(seasonPhases.deadline, now)),
    )
    .limit(1);
  return !!row;
}

// The same check as a condition, for a write that must not run on such a
// pair (checked inside the write, so a publish in the meantime wins).
export function notInRunningGroup(pairId: number, now = new Date()) {
  return sql`not exists (select 1 from group_pairs gp join groups g on g.id = gp.group_id
    join season_phases sp on sp.season_id = g.season_id and sp.number = g.phase
    where gp.pair_id = ${pairId} and gp.withdrawn_at is null and g.published_at is not null and sp.deadline >= ${Math.floor(now.getTime() / 1000)})`;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const groupIdOf = (seasonId: number, phase: number, number: number) =>
  sql`(select ${groups.id} from ${groups} where ${groups.seasonId} = ${seasonId} and ${groups.phase} = ${phase} and ${groups.number} = ${number})`;

// The phases of a season that have groups, and whether each is published
// (the Csoportok page's round links, #35).
export async function phasesWithGroups(seasonId: number): Promise<{ phase: number; published: boolean }[]> {
  const rows = await db
    .select({ phase: groups.phase, published: sql<number>`max(${groups.publishedAt} is not null)` })
    .from(groups)
    .where(eq(groups.seasonId, seasonId))
    .groupBy(groups.phase)
    .orderBy(asc(groups.phase));
  return rows.map((r) => ({ phase: r.phase, published: !!r.published }));
}

// Whether a phase's groups are published.
export async function phasePublished(seasonId: number, phase: number): Promise<boolean> {
  const [row] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase), isNotNull(groups.publishedAt)))
    .limit(1);
  return !!row;
}

/**
 * Replaces a phase's unpublished draft with `drafted` (1. csoport first, each
 * by seed), audited as "groups.draft" (actor null: the cron, #35). Published
 * groups are never deleted; if the phase was published in the meantime, the
 * insert hits the unique group number and the whole batch rolls back.
 */
export async function writeDraft(
  seasonId: number,
  phase: number,
  drafted: readonly (readonly { pairId: number }[])[],
  actorId: string | null,
  at?: Date,
  basis: string | null = null,
): Promise<Result> {
  const groupRows = drafted.map((_, i) => ({ seasonId, phase, number: i + 1, basis }));
  const pairRows = drafted.flatMap((g, i) => g.map((p, seed) => ({ groupId: groupIdOf(seasonId, phase, i + 1), pairId: p.pairId, seed: seed + 1 })));
  const count = drafted.reduce((n, g) => n + g.length, 0);
  // One batch (a transaction in D1).
  const statements: BatchItem<"sqlite">[] = [
    db.delete(groups).where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase), isNull(groups.publishedAt))),
    ...chunks(groupRows, GROUP_CHUNK).map((rows) => db.insert(groups).values(rows)),
    ...chunks(pairRows, PAIR_CHUNK).map((rows) => db.insert(groupPairs).values(rows)),
    auditEntry({
      actorId,
      action: "groups.draft",
      target: `season:${seasonId}`,
      detail: phase === FIRST_PHASE ? `${count} pairs` : `phase ${phase}: ${count} pairs`,
      leagueId: leagueOfSeason(seasonId),
      at,
    }),
  ];
  try {
    const [first, ...rest] = statements;
    await db.batch([first!, ...rest]);
  } catch (e) {
    if (await phasePublished(seasonId, phase)) return { ok: false, error: LOCKED };
    throw e;
  }
  return { ok: true };
}

// "Csoportok javaslata" and "Újragenerálás": replaces the draft with a fresh
// one from the approved pairs (spec section 10, seedGroups). Earlier moves are
// lost. Nothing is stored when the pairs can't be split (0, 1, 2 or 5).
export async function generateDraft(seasonId: number, actorId: string): Promise<Result> {
  // Seeding reads the current Elo: a replay first, in case the one after the
  // last final match failed (#13). The round switch draft (#35) does the same.
  await updateElo();
  if (await groupsPublished(seasonId)) return { ok: false, error: LOCKED };
  const eligible = await eligiblePairs(seasonId);
  const seeded = seedGroups(eligible);
  if (!seeded.ok) return { ok: false, error: cannotSplit(eligible.length)! };

  return writeDraft(seasonId, FIRST_PHASE, seeded.groups, actorId);
}

// "Áthelyezés": moves a pair into another group of the draft and re-seeds
// that group by Elo (movePair). Sizes aren't checked here: publishing is
// blocked until every group has 3 or 4 pairs.
export async function moveDraftPair(seasonId: number, pairId: number, toNumber: number, actorId: string, phase = FIRST_PHASE): Promise<Result> {
  const draft = await phaseGroups(seasonId, phase);
  if (draft.some((g) => g.publishedAt)) return { ok: false, error: LOCKED };
  const from = draft.findIndex((g) => g.pairs.some((p) => p.pairId === pairId));
  const to = draft.findIndex((g) => g.number === toNumber);
  if (from < 0 || to < 0) return { ok: false, error: CHANGED };
  if (from === to) return { ok: true };

  // Elo ties in the target group go by approval order (D20).
  const approval = new Map((await enteredPairs(seasonId)).map((p, i) => [p.pairId, i]));
  const moved = movePair(
    draft.map((g) => g.pairs),
    pairId,
    to,
    (p) => p.pairId,
    (p) => approval.get(p.pairId) ?? Number.MAX_SAFE_INTEGER,
  );
  const ids = [draft[from]!.id, draft[to]!.id];
  const rows = [from, to].flatMap((i) => moved[i]!.map((p, seed) => ({ groupId: draft[i]!.id, pairId: p.pairId, seed: seed + 1 })));
  // One batch: only rows of unpublished groups are deleted, so if the groups
  // were published in the meantime the re-insert hits the primary key and
  // the batch rolls back. The revision tells a publish running at the same
  // time that the draft it checked has changed.
  const [first, ...rest] = [
    db
      .update(groups)
      .set({ revision: sql`${groups.revision} + 1` })
      .where(and(inArray(groups.id, ids), isNull(groups.publishedAt))),
    db
      .delete(groupPairs)
      .where(
        inArray(
          groupPairs.groupId,
          db
            .select({ id: groups.id })
            .from(groups)
            .where(and(inArray(groups.id, ids), isNull(groups.publishedAt))),
        ),
      ),
    ...chunks(rows, PAIR_CHUNK).map((r) => db.insert(groupPairs).values(r)),
    auditEntry({
      actorId,
      action: "groups.move",
      target: `season:${seasonId}`,
      detail: phase === FIRST_PHASE ? `pair:${pairId} -> ${toNumber}` : `phase ${phase}: pair:${pairId} -> ${toNumber}`,
      leagueId: leagueOfSeason(seasonId),
    }),
  ];
  try {
    await db.batch([first, ...rest]);
  } catch (e) {
    if (await phasePublished(seasonId, phase)) return { ok: false, error: LOCKED };
    throw e;
  }
  return { ok: true };
}

// "Közzététel" (D22): creates every group's matches (fixture order, deadline
// the end of phase 1), locks the groups and emails each player their group,
// opponents and deadline. Refused while a group isn't 3 or 4 pairs or the
// draft no longer matches the approved pairs.
export async function publishGroups(seasonId: number, actorId: string, now = new Date()): Promise<Result> {
  const eligible = await eligiblePairs(seasonId);
  return publishPhase(
    seasonId,
    FIRST_PHASE,
    actorId,
    eligible.map((p) => p.pairId),
    now,
  );
}

/**
 * Publishes a phase's draft: phase 1 from publishGroups, a later phase from
 * the round switch (publishRoundSwitch, #35), which checks the ending
 * phase's open disputes first. `eligible`: the pairs the draft must hold
 * exactly. For a later phase, a dispute opened in the ending phase since
 * that check stops the publish too (inside the batch).
 */
export async function publishPhase(seasonId: number, number: number, actorId: string, eligible: readonly number[], now = new Date()): Promise<Result> {
  const season = await getSeason(seasonId);
  const phase = season?.phases.find((p) => p.number === number);
  if (!season || !phase) return { ok: false, error: "Nincs ilyen szezon." };
  const draft = await phaseGroups(seasonId, number);
  if (draft.length === 0) return { ok: false, error: "Még nincs javaslat." };
  if (draft.some((g) => g.publishedAt)) return { ok: false, error: LOCKED };
  const blocker = publishBlocker({
    sizes: draft.map((g) => g.pairs.length),
    stale: draftIsStale(
      draft.flatMap((g) => g.pairs.map((p) => p.pairId)),
      eligible,
    ),
  });
  if (blocker) return { ok: false, error: blocker };

  const fixtures = phaseMatches(draft.map((g) => g.pairs));
  const ids = draft.map((g) => g.id);
  const publishedAt = Math.floor(now.getTime() / 1000);
  // The draft as checked above: its groups (the lowest id changes when it is
  // regenerated) and their revisions (bumped by every move).
  const draftOf = sql`${groups.seasonId} = ${seasonId} and ${groups.phase} = ${number} and ${groups.publishedAt} is null`;
  const unchanged = sql`(select count(*) || ':' || min(${groups.id}) || ':' || sum(${groups.revision}) from ${groups} where ${draftOf}) = ${`${ids.length}:${Math.min(...ids)}:${draft.reduce((n, g) => n + g.revision, 0)}`}`;
  // Every pair in the draft is still active and approved for this phase
  // (phase 1: joining it; later: joining it or before): a dissolve, take-out
  // or rejection since the check above stops the publish.
  const joins = number === FIRST_PHASE ? sql`se.joins_phase = ${FIRST_PHASE}` : sql`se.joins_phase <= ${number}`;
  const pairsStillIn = sql`not exists (select 1 from group_pairs gp join groups dg on dg.id = gp.group_id join pairs p on p.id = gp.pair_id
    where dg.season_id = ${seasonId} and dg.phase = ${number} and dg.published_at is null and (p.status <> 'active' or not exists (
      select 1 from season_entries se where se.season_id = dg.season_id and se.pair_id = gp.pair_id and se.status = 'approved' and ${joins})))`;
  // A later phase: no disputed result or waiting no-show report (#33) left
  // in the ending phase (#35); a withdrawn pair's match doesn't count.
  const noDispute =
    number === FIRST_PHASE
      ? sql`1`
      : sql`not exists (select 1 from matches m join groups eg on eg.id = m.group_id
          where eg.season_id = ${seasonId} and eg.phase = ${number - 1}
            and (m.status = 'disputed' or (m.status <> 'final' and exists (select 1 from no_show_reports nr where nr.match_id = m.id and nr.status = 'open')))
            and not exists (
              select 1 from group_pairs wp where wp.group_id = m.group_id and wp.pair_id in (m.pair_a, m.pair_b) and wp.withdrawn_at is not null))`;
  // The matches go in only if this publish claimed every group.
  const claimed = sql`(select count(*) from ${groups} where ${groups.seasonId} = ${seasonId} and ${groups.phase} = ${number} and ${groups.publishedAt} = ${publishedAt}) = ${ids.length}`;
  // The batch is one transaction, so checking the claim on the first match
  // covers them all: if it fails, group_id comes out null, NOT NULL fails and
  // the whole batch rolls back. (A raw `insert ... select ... where claimed`
  // can't go in a D1 batch; drizzle has no prepared statement for it.)
  const matchRows = fixtures.map((m, i) => {
    const groupId = draft[m.group]!.id;
    return {
      groupId: i === 0 ? sql<number>`(select ${groups.id} from ${groups} where ${groups.id} = ${groupId} and ${claimed})` : groupId,
      pairA: m.a.pairId,
      pairB: m.b.pairId,
      week: m.week,
      deadline: phase.deadline,
    };
  });
  // One batch (a transaction in D1): lock the groups, if the draft is still
  // the one checked, and create their matches. A second publish at the same
  // second hits the matches' unique index and rolls back.
  try {
    await db.batch([
      db.update(groups).set({ publishedAt: now }).where(and(sql`${draftOf}`, unchanged, pairsStillIn, noDispute)),
      ...chunks(matchRows, MATCH_CHUNK).map((rows) => db.insert(matches).values(rows)),
      auditWhen(claimed, {
        actorId,
        action: "groups.publish",
        target: `season:${seasonId}`,
        detail: `${number === FIRST_PHASE ? "" : `phase ${number}: `}${draft.length} groups, ${fixtures.length} matches`,
        leagueId: season.leagueId,
      }),
    ]);
  } catch (e) {
    if (await phasePublished(seasonId, number)) return { ok: false, error: LOCKED };
    if (/NOT NULL constraint failed: matches\.group_id/i.test(`${e} ${(e as Error)?.cause ?? ""}`)) return { ok: false, error: CHANGED };
    throw e;
  }
  const [done] = await db
    .select({ n: sql<number>`count(*)` })
    .from(groups)
    .where(and(inArray(groups.id, ids), eq(groups.publishedAt, now)));
  if ((done?.n ?? 0) !== ids.length) return { ok: false, error: (await phasePublished(seasonId, number)) ? LOCKED : CHANGED };

  const [league] = await db.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, season.leagueId));
  const name = (p: Player) => p.name || "Névtelen";
  const messages = draft.flatMap((g, gi) => {
    const groupFixtures = fixtures.filter((m) => m.group === gi);
    return g.pairs.flatMap((pair) => {
      const weeks = pairWeeks(groupFixtures, pair).map((w) => ({
        week: w.week,
        range: weekRange(phase.startsAt, w.week),
        opponents: w.opponent ? ([name(w.opponent.players[0]), name(w.opponent.players[1])] as [string, string]) : null,
      }));
      return [0, 1].map((i) => ({
        toEmail: pair.players[i]!.email,
        input: {
          to: name(pair.players[i]!),
          partnerName: name(pair.players[1 - i]!),
          league: league?.name ?? "",
          season: season.name,
          phase: number,
          group: g.number,
          weeks,
          deadline: phase.deadline,
        },
      }));
    });
  });
  await queueGroupsPublished(messages);
  // Then in the app for every player, whatever their email switch says
  // (#115). The pushes wait for the cron (queuePush, D150): a whole league's
  // pushes here would use up the invocation's subrequests that the emails,
  // sent after the response, still need.
  await notifyPlayers(
    "groups_published",
    draft.flatMap((g) => {
      const message = groupsPublishedMessage({
        league: league?.name ?? "",
        season: season.name,
        phase: number,
        group: g.number,
        deadline: phase.deadline,
      });
      return g.pairs.flatMap((pair) => pair.players.map((p) => ({ userId: p.id, message })));
    }),
    undefined,
    true,
  );
  return { ok: true };
}
