import type { Phase } from "@padel-liga/rules";
import { and, asc, count, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";

import { db } from "~/db/client.server";
import { seasonEntries, seasonPhases, seasons } from "~/db/schema";

import { audit } from "./leagues.server";
import { registrationWindow, type Season, type SeasonInput } from "./seasons";

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
  return rows.map((r) => ({
    id: r.id,
    leagueId: r.leagueId,
    name: r.name,
    registrationOpensAt: r.registrationOpensAt,
    registrationClosesAt: r.registrationClosesAt,
    firstPhaseStart: r.firstPhaseStart,
    breaks: r.breaks,
    phases: phases
      .filter((p) => p.seasonId === r.id)
      .map(({ number, startsAt, deadline }) => ({ number, startsAt, deadline })),
  }));
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
  return {
    id: row.id,
    leagueId: row.leagueId,
    name: row.name,
    registrationOpensAt: row.registrationOpensAt,
    registrationClosesAt: row.registrationClosesAt,
    firstPhaseStart: row.firstPhaseStart,
    breaks: row.breaks,
    phases,
  };
}

// Whether the phase 1 groups are published and how many pairs entered (any
// entry but a withdrawn one: a dissolved pair's entry doesn't block deleting).
// Groups don't exist yet (#24): until they do, a season can always be edited.
export async function seasonState(id: number): Promise<{ groupsPublished: boolean; entries: number }> {
  const [row] = await db
    .select({ n: count() })
    .from(seasonEntries)
    .where(and(eq(seasonEntries.seasonId, id), ne(seasonEntries.status, "withdrawn")));
  return { groupsPublished: false, entries: row?.n ?? 0 };
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
  const [[row]] = await db.batch([
    db
      .insert(seasons)
      .values({ leagueId, ...columns(input) })
      .returning({ id: seasons.id }),
    db.insert(seasonPhases).values(phaseRows(sql`(select max(${seasons.id}) from ${seasons})`, phases)),
  ]);
  await audit(actorId, "season.create", `season:${row!.id}`, input.name);
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
  ]);
  await audit(actorId, "season.update", `season:${id}`, input.name);
}

// Only while it has no entry but withdrawn ones, checked in the delete
// itself: an entry made in the meantime isn't deleted with it. False if not.
export async function deleteSeason(id: number, actorId: string): Promise<boolean> {
  const [row] = await db
    .delete(seasons)
    .where(
      and(
        eq(seasons.id, id),
        sql`not exists (select 1 from ${seasonEntries} where ${seasonEntries.seasonId} = ${id} and ${seasonEntries.status} <> 'withdrawn')`,
      ),
    )
    .returning({ name: seasons.name });
  if (!row) return false;
  await audit(actorId, "season.delete", `season:${id}`, row.name);
  return true;
}
