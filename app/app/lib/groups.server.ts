import { movePair, phaseMatches, seedGroups } from "@padel-liga/rules";
import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { groupPairs, groups, leagues, matches, pairs, seasonEntries, seasonPhases, users } from "~/db/schema";
import { queueGroupsPublished } from "~/lib/email/outbox.server";

import { audit } from "./leagues.server";
import { cannotSplit, draftIsStale, pairWeeks, publishBlocker, weekRange } from "./groups";
import { averageStartingElo } from "./season-entries";
import { getSeason } from "./seasons.server";

// First-phase groups in D1 (#24, D20-D22). The rules are in groups.ts and
// packages/rules (seedGroups, movePair, phaseMatches).

type Result = { ok: true } | { ok: false; error: string };

export const FIRST_PHASE = 1;

const LOCKED = "A csoportok már kint vannak, nem módosíthatók.";
const CHANGED = "A javaslat közben változott. Frissítsd az oldalt.";

const playerA = alias(users, "player_a_user");
const playerB = alias(users, "player_b_user");

// Email stays on the server: only the publish emails use it.
type Player = { name: string; level: string | null; email: string };

export type GroupPair = {
  pairId: number;
  players: [Player, Player];
  averageElo: number;
  // False once the pair was dissolved after the draft was made.
  active: boolean;
};

export type StoredGroup = { id: number; number: number; revision: number; publishedAt: Date | null; pairs: GroupPair[] };

const pairColumns = {
  pairId: pairs.id,
  pairStatus: pairs.status,
  nameA: playerA.name,
  levelA: playerA.level,
  emailA: playerA.email,
  nameB: playerB.name,
  levelB: playerB.level,
  emailB: playerB.email,
};

type PairRow = { pairId: number; pairStatus: "active" | "dissolved"; nameA: string; levelA: string | null; emailA: string; nameB: string; levelB: string | null; emailB: string };

function groupPair(r: PairRow): GroupPair {
  return {
    pairId: r.pairId,
    players: [
      { name: r.nameA, level: r.levelA, email: r.emailA },
      { name: r.nameB, level: r.levelB, email: r.emailB },
    ],
    // Both levels are required to enter (D18); until Elo exists the pair's
    // rating is the average starting Elo of its levels (D20).
    averageElo: averageStartingElo(r.levelA, r.levelB) ?? 0,
    active: r.pairStatus === "active",
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

// A phase's groups (draft or published), 1. csoport first, each by seed.
export async function phaseGroups(seasonId: number, phase = FIRST_PHASE): Promise<StoredGroup[]> {
  const list = await db
    .select({ id: groups.id, number: groups.number, revision: groups.revision, publishedAt: groups.publishedAt })
    .from(groups)
    .where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase)))
    .orderBy(asc(groups.number));
  if (list.length === 0) return [];
  const rows = await db
    .select({ groupId: groupPairs.groupId, ...pairColumns })
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
  return list.map((g) => ({ ...g, pairs: rows.filter((r) => r.groupId === g.id).map(groupPair) }));
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

// D1 allows at most 100 bound parameters per statement. Drizzle binds a
// column's default too (revision 0), so count every column it writes.
const GROUP_CHUNK = 20; // 4 per row: season, phase, number, revision
const PAIR_CHUNK = 15; // 5 per row: the group id subquery binds 3
const MATCH_CHUNK = 18; // 5 per row, plus 4 for the claim check

// Whether the pair plays in a published group whose phase hasn't ended:
// such a pair can't be dissolved (D16) or rejected, or the published groups
// and their matches would change.
export async function pairInRunningGroup(pairId: number, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: groupPairs.groupId })
    .from(groupPairs)
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .innerJoin(seasonPhases, and(eq(seasonPhases.seasonId, groups.seasonId), eq(seasonPhases.number, groups.phase)))
    .where(and(eq(groupPairs.pairId, pairId), isNotNull(groups.publishedAt), gte(seasonPhases.deadline, now)))
    .limit(1);
  return !!row;
}

// The same check as a condition, for a write that must not run on such a
// pair (checked inside the write, so a publish in the meantime wins).
export function notInRunningGroup(pairId: number, now = new Date()) {
  return sql`not exists (select 1 from group_pairs gp join groups g on g.id = gp.group_id
    join season_phases sp on sp.season_id = g.season_id and sp.number = g.phase
    where gp.pair_id = ${pairId} and g.published_at is not null and sp.deadline >= ${Math.floor(now.getTime() / 1000)})`;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const groupIdOf = (seasonId: number, number: number) =>
  sql`(select ${groups.id} from ${groups} where ${groups.seasonId} = ${seasonId} and ${groups.phase} = ${FIRST_PHASE} and ${groups.number} = ${number})`;

// "Csoportok javaslata" and "Újragenerálás": replaces the draft with a fresh
// one from the approved pairs (spec section 10, seedGroups). Earlier moves are
// lost. Nothing is stored when the pairs can't be split (0, 1, 2 or 5).
export async function generateDraft(seasonId: number, actorId: string): Promise<Result> {
  if (await groupsPublished(seasonId)) return { ok: false, error: LOCKED };
  const eligible = await eligiblePairs(seasonId);
  const seeded = seedGroups(eligible);
  if (!seeded.ok) return { ok: false, error: cannotSplit(eligible.length)! };

  const groupRows = seeded.groups.map((_, i) => ({ seasonId, phase: FIRST_PHASE, number: i + 1 }));
  const pairRows = seeded.groups.flatMap((g, i) =>
    g.map((p, seed) => ({ groupId: groupIdOf(seasonId, i + 1), pairId: p.pairId, seed: seed + 1 })),
  );
  // One batch (a transaction in D1). Published groups are never deleted; if
  // some were published in the meantime, the insert hits the unique group
  // number and the whole batch rolls back.
  const statements: BatchItem<"sqlite">[] = [
    db
      .delete(groups)
      .where(and(eq(groups.seasonId, seasonId), eq(groups.phase, FIRST_PHASE), isNull(groups.publishedAt))),
    ...chunks(groupRows, GROUP_CHUNK).map((rows) => db.insert(groups).values(rows)),
    ...chunks(pairRows, PAIR_CHUNK).map((rows) => db.insert(groupPairs).values(rows)),
  ];
  try {
    const [first, ...rest] = statements;
    await db.batch([first!, ...rest]);
  } catch (e) {
    if (await groupsPublished(seasonId)) return { ok: false, error: LOCKED };
    throw e;
  }
  await audit(actorId, "groups.draft", `season:${seasonId}`, `${eligible.length} pairs`);
  return { ok: true };
}

// "Áthelyezés": moves a pair into another group of the draft and re-seeds
// that group by Elo (movePair). Sizes aren't checked here: publishing is
// blocked until every group has 3 or 4 pairs.
export async function moveDraftPair(seasonId: number, pairId: number, toNumber: number, actorId: string): Promise<Result> {
  const draft = await phaseGroups(seasonId);
  if (draft.some((g) => g.publishedAt)) return { ok: false, error: LOCKED };
  const from = draft.findIndex((g) => g.pairs.some((p) => p.pairId === pairId));
  const to = draft.findIndex((g) => g.number === toNumber);
  if (from < 0 || to < 0) return { ok: false, error: CHANGED };
  if (from === to) return { ok: true };

  // Elo ties in the target group go by approval order (D20).
  const approval = new Map((await eligiblePairs(seasonId)).map((p, i) => [p.pairId, i]));
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
  ];
  try {
    await db.batch([first, ...rest]);
  } catch (e) {
    if (await groupsPublished(seasonId)) return { ok: false, error: LOCKED };
    throw e;
  }
  await audit(actorId, "groups.move", `season:${seasonId}`, `pair:${pairId} -> ${toNumber}`);
  return { ok: true };
}

// "Közzététel" (D22): creates every group's matches (fixture order, deadline
// the end of phase 1), locks the groups and emails each player their group,
// opponents and deadline. Refused while a group isn't 3 or 4 pairs or the
// draft no longer matches the approved pairs.
export async function publishGroups(seasonId: number, actorId: string, now = new Date()): Promise<Result> {
  const season = await getSeason(seasonId);
  const phase = season?.phases.find((p) => p.number === FIRST_PHASE);
  if (!season || !phase) return { ok: false, error: "Nincs ilyen szezon." };
  const draft = await phaseGroups(seasonId);
  if (draft.length === 0) return { ok: false, error: "Még nincs javaslat." };
  if (draft.some((g) => g.publishedAt)) return { ok: false, error: LOCKED };
  const eligible = await eligiblePairs(seasonId);
  const blocker = publishBlocker({
    sizes: draft.map((g) => g.pairs.length),
    stale: draftIsStale(
      draft.flatMap((g) => g.pairs.map((p) => p.pairId)),
      eligible.map((p) => p.pairId),
    ),
  });
  if (blocker) return { ok: false, error: blocker };

  const fixtures = phaseMatches(draft.map((g) => g.pairs));
  const ids = draft.map((g) => g.id);
  const publishedAt = Math.floor(now.getTime() / 1000);
  // The draft as checked above: its groups (the lowest id changes when it is
  // regenerated) and their revisions (bumped by every move).
  const draftOf = sql`${groups.seasonId} = ${seasonId} and ${groups.phase} = ${FIRST_PHASE} and ${groups.publishedAt} is null`;
  const unchanged = sql`(select count(*) || ':' || min(${groups.id}) || ':' || sum(${groups.revision}) from ${groups} where ${draftOf}) = ${`${ids.length}:${Math.min(...ids)}:${draft.reduce((n, g) => n + g.revision, 0)}`}`;
  // Every pair in the draft is still active and approved for phase 1: a
  // dissolve or rejection since the check above stops the publish.
  const pairsStillIn = sql`not exists (select 1 from group_pairs gp join groups dg on dg.id = gp.group_id join pairs p on p.id = gp.pair_id
    where dg.season_id = ${seasonId} and dg.phase = ${FIRST_PHASE} and dg.published_at is null and (p.status <> 'active' or not exists (
      select 1 from season_entries se where se.season_id = dg.season_id and se.pair_id = gp.pair_id and se.status = 'approved' and se.joins_phase = ${FIRST_PHASE})))`;
  // The matches go in only if this publish claimed every group.
  const claimed = sql`(select count(*) from ${groups} where ${groups.seasonId} = ${seasonId} and ${groups.phase} = ${FIRST_PHASE} and ${groups.publishedAt} = ${publishedAt}) = ${ids.length}`;
  const matchRows = fixtures.map((m) => sql`(${draft[m.group]!.id}, ${m.a.pairId}, ${m.b.pairId}, ${m.week}, ${Math.floor(phase.deadline.getTime() / 1000)})`);
  // One batch (a transaction in D1): lock the groups, if the draft is still
  // the one checked, and create their matches. A second publish at the same
  // second hits the matches' unique index and rolls back.
  try {
    await db.batch([
      db.update(groups).set({ publishedAt: now }).where(and(sql`${draftOf}`, unchanged, pairsStillIn)),
      ...chunks(matchRows, MATCH_CHUNK).map((rows) =>
        db.run(
          sql`insert into ${matches} (group_id, pair_a, pair_b, week, deadline) select * from (values ${sql.join(rows, sql`, `)}) where ${claimed}`,
        ),
      ),
    ]);
  } catch (e) {
    if (await groupsPublished(seasonId)) return { ok: false, error: LOCKED };
    throw e;
  }
  const [done] = await db
    .select({ n: sql<number>`count(*)` })
    .from(groups)
    .where(and(inArray(groups.id, ids), eq(groups.publishedAt, now)));
  if ((done?.n ?? 0) !== ids.length) return { ok: false, error: (await groupsPublished(seasonId)) ? LOCKED : CHANGED };
  await audit(actorId, "groups.publish", `season:${seasonId}`, `${draft.length} groups, ${fixtures.length} matches`);

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
          phase: FIRST_PHASE,
          group: g.number,
          weeks,
          deadline: phase.deadline,
        },
      }));
    });
  });
  await queueGroupsPublished(messages);
  return { ok: true };
}
