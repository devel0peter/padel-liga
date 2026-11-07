import type { Phase } from "@padel-liga/rules";
import { and, asc, count, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";

import { db } from "~/db/client.server";
import { rowSelect } from "~/db/insert-select";
import { groups, seasonEntries, seasonPhases, seasons } from "~/db/schema";

import { auditEntry, auditIfChanged, auditWhen } from "./audit.server";
import { registrationWindow, type Season, type SeasonInput, type WaitingSeasonInput } from "./seasons";

// Seasons of one league (or every league), newest first, each with its phases.
export async function listSeasons(leagueId?: number): Promise<Season[]> {
  const rows = await db
    .select()
    .from(seasons)
    .where(leagueId === undefined ? undefined : eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.firstPhaseStart), desc(seasons.id));
  if (rows.length === 0) return [];
  // A subquery, not a list of ids: D1 allows at most 100 bound parameters.
  const phases = await db
    .select()
    .from(seasonPhases)
    .where(
      leagueId === undefined
        ? undefined
        : inArray(seasonPhases.seasonId, db.select({ id: seasons.id }).from(seasons).where(eq(seasons.leagueId, leagueId))),
    )
    .orderBy(asc(seasonPhases.seasonId), asc(seasonPhases.number));
  return rows.map((r) =>
    toSeason(
      r,
      phases.filter((p) => p.seasonId === r.id).map(({ number, startsAt, deadline }) => ({ number, startsAt, deadline })),
    ),
  );
}

// A stored row as the pages see it. A waiting first season (D124) stores ''
// as its first Monday and its opening as its closing: both read as not set.
function toSeason(row: typeof seasons.$inferSelect, phases: Season["phases"]): Season {
  const waiting = row.startsAtMinimum && row.startFixedAt === null;
  return {
    id: row.id,
    leagueId: row.leagueId,
    name: row.name,
    registrationOpensAt: row.registrationOpensAt,
    registrationClosesAt: waiting ? null : row.registrationClosesAt,
    firstPhaseStart: waiting ? null : row.firstPhaseStart,
    breaks: row.breaks,
    phases,
    startsAtMinimum: row.startsAtMinimum,
    startFixedAt: row.startFixedAt,
  };
}

export async function seasonInLeague(id: number, leagueId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(eq(seasons.id, id), eq(seasons.leagueId, leagueId)));
  return !!row;
}

// One season with its phases.
export async function getSeason(id: number): Promise<Season | undefined> {
  const [row] = await db.select().from(seasons).where(eq(seasons.id, id));
  if (!row) return undefined;
  const phases = await db
    .select({ number: seasonPhases.number, startsAt: seasonPhases.startsAt, deadline: seasonPhases.deadline })
    .from(seasonPhases)
    .where(eq(seasonPhases.seasonId, id))
    .orderBy(asc(seasonPhases.number));
  return toSeason(row, phases);
}

// Whether the phase 1 groups are published (#24) and how many pairs entered
// (any entry but a withdrawn one: a dissolved pair's entry doesn't block
// deleting).
export async function seasonState(id: number): Promise<{ groupsPublished: boolean; entries: number }> {
  const [[row], [published]] = await Promise.all([
    db
      .select({ n: count() })
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, id), ne(seasonEntries.status, "withdrawn"))),
    db
      .select({ n: count() })
      .from(groups)
      .where(and(eq(groups.seasonId, id), sql`${groups.publishedAt} is not null`)),
  ]);
  return { groupsPublished: (published?.n ?? 0) > 0, entries: row?.n ?? 0 };
}

function columns(input: SeasonInput) {
  const { opensAt, closesAt } = registrationWindow(input);
  return {
    name: input.name,
    registrationOpensAt: opensAt,
    registrationClosesAt: closesAt,
    firstPhaseStart: input.firstPhaseStart,
    breaks: input.breaks,
  };
}

const phaseRows = (seasonId: number | SQL, phases: Phase[]) =>
  phases.map((p) => ({ seasonId, number: p.number, startsAt: p.startsAt, deadline: p.deadline }));

// The season and its phases in one batch (one transaction in D1), so a season
// never exists without its phases. Inside the batch nothing else writes, so
// the newest season id is the one just inserted (AUTOINCREMENT only grows).
export async function createSeason(leagueId: number, input: SeasonInput, phases: Phase[], actorId: string): Promise<void> {
  const newest = sql`(select max(${seasons.id}) from ${seasons})`;
  await db.batch([
    db.insert(seasons).values({ leagueId, ...columns(input) }),
    db.insert(seasonPhases).values(phaseRows(newest, phases)),
    auditEntry({ actorId, action: "season.create", target: sql`'season:' || ${newest}`, detail: input.name, leagueId }),
  ]);
}

// A league's first season that starts at the minimum entries (D124): open
// for entries from now, with no deadline, start or phases until the entry
// that reaches the minimum fixes them (season-start.server.ts). Only while
// the league has no season, checked in the insert. False if it has one.
export async function createWaitingSeason(leagueId: number, input: WaitingSeasonInput, actorId: string, now = new Date()): Promise<boolean> {
  const newest = sql`(select max(${seasons.id}) from ${seasons})`;
  const seconds = Math.floor(now.getTime() / 1000);
  const [inserted] = await db.batch([
    db
      .insert(seasons)
      .select(
        rowSelect(
          seasons,
          {
            id: sql`null`,
            leagueId: sql`${leagueId}`,
            name: sql`${input.name}`,
            registrationOpensAt: sql`${seconds}`,
            // Not set while waiting: toSeason reads these as null.
            registrationClosesAt: sql`${seconds}`,
            firstPhaseStart: sql`''`,
            breaks: sql`${JSON.stringify(input.breaks)}`,
            startsAtMinimum: sql`1`,
            startFixedAt: sql`null`,
            updatedAt: sql`null`,
            createdAt: sql`unixepoch()`,
          },
          sql`where not exists (select 1 from ${seasons} where ${seasons.leagueId} = ${leagueId})`,
        ),
      )
      .returning({ id: seasons.id }),
    auditIfChanged({ actorId, action: "season.create", target: sql`'season:' || ${newest}`, detail: input.name, leagueId }),
  ]);
  return inserted.length > 0;
}

// The name and breaks of a first season while it still waits (D124),
// checked in the update. False once its start is fixed.
export async function updateWaitingSeason(id: number, input: WaitingSeasonInput, actorId: string): Promise<boolean> {
  const [updated] = await db.batch([
    db
      .update(seasons)
      .set({ name: input.name, breaks: input.breaks, updatedAt: new Date() })
      .where(and(eq(seasons.id, id), eq(seasons.startsAtMinimum, true), isNull(seasons.startFixedAt)))
      .returning({ id: seasons.id }),
    auditIfChanged({
      actorId,
      action: "season.update",
      target: `season:${id}`,
      detail: input.name,
      leagueId: sql`(select ${seasons.leagueId} from ${seasons} where ${seasons.id} = ${id})`,
    }),
  ]);
  return updated.length > 0;
}

// Rewrites the season and its phases in one batch (one transaction in D1).
export async function updateSeason(id: number, input: SeasonInput, phases: Phase[], actorId: string): Promise<void> {
  await db.batch([
    db
      .update(seasons)
      .set({ ...columns(input), updatedAt: new Date() })
      .where(eq(seasons.id, id)),
    db.delete(seasonPhases).where(eq(seasonPhases.seasonId, id)),
    db.insert(seasonPhases).values(phaseRows(id, phases)),
    auditEntry({
      actorId,
      action: "season.update",
      target: `season:${id}`,
      detail: input.name,
      leagueId: sql`(select ${seasons.leagueId} from ${seasons} where ${seasons.id} = ${id})`,
    }),
  ]);
}

// Only while it has no entry but withdrawn ones and no published groups,
// checked in the delete itself: an entry made in the meantime isn't deleted
// with it. False if not.
export async function deleteSeason(id: number, actorId: string): Promise<boolean> {
  const deletable = and(
    eq(seasons.id, id),
    sql`not exists (select 1 from ${seasonEntries} where ${seasonEntries.seasonId} = ${id} and ${seasonEntries.status} <> 'withdrawn')`,
    sql`not exists (select 1 from ${groups} where ${groups.seasonId} = ${id} and ${groups.publishedAt} is not null)`,
  )!;
  // The entry first, while the season is still there to name: under the same
  // condition as the delete, in the same transaction.
  const [, deleted] = await db.batch([
    auditWhen(sql`exists (select 1 from ${seasons} where ${deletable})`, {
      actorId,
      action: "season.delete",
      target: `season:${id}`,
      detail: sql`(select ${seasons.name} from ${seasons} where ${eq(seasons.id, id)})`,
      leagueId: sql`(select ${seasons.leagueId} from ${seasons} where ${eq(seasons.id, id)})`,
    }),
    db.delete(seasons).where(deletable).returning({ id: seasons.id }),
  ]);
  return deleted.length > 0;
}
