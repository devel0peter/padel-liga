import { addDays, budapestDay, type Day } from "@padel-liga/rules";
import { and, asc, count, eq, inArray, isNotNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { cities, groupPairs, groups, matches, pairs, seasonEntries, users } from "~/db/schema";

import { formatOnDate, formatShortDay } from "./format";
import { buildLadder, countedOutcome, isValidOutcome, phaseWeek, type LadderBand, type LadderGroupInput } from "./ladder";
import { getLeague, minEntriesByLeague } from "./leagues.server";
import { logWarn } from "./log";
import { averageElo } from "./season-entries";
import { currentSeason, isWaiting, waitingText } from "./seasons";
import { listSeasons } from "./seasons.server";

// What the league page needs (#30; members only since D134). Only names leave
// this module: the queries below select no email, phone or user id.

export type LadderPage = {
  league: { name: string; city: string };
  season: string;
} & (
  // No group of the season is published yet. starting: a first season
  // waiting for its minimum entries (D124), "9 pár nevezett, még 3 kell,
  // utána indul."
  | { kind: "waiting"; next: { round: number; startsOn: string } | null; starting?: string }
  | {
      kind: "ladder";
      phase: number;
      // The phase has started; before that "this week" is its first week.
      started: boolean;
      week: number;
      // "november 9-én": when the phase starts.
      startsOn: string;
      // The week shown, "nov. 9." – "nov. 15.".
      weekFrom: string;
      weekTo: string;
      bands: LadderBand[];
    }
);

const playerA = alias(users, "ladder_player_a");
const playerB = alias(users, "ladder_player_b");

async function phaseInput(seasonId: number, phase: number): Promise<LadderGroupInput[]> {
  const list = await db
    .select({ id: groups.id, number: groups.number })
    .from(groups)
    .where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase), isNotNull(groups.publishedAt)))
    .orderBy(asc(groups.number));
  if (list.length === 0) return [];
  const phaseGroups = db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.seasonId, seasonId), eq(groups.phase, phase), isNotNull(groups.publishedAt)));
  const members = await db
    .select({
      groupId: groupPairs.groupId,
      pairId: pairs.id,
      withdrawnAt: groupPairs.withdrawnAt,
      nameA: playerA.name,
      levelA: playerA.level,
      eloA: playerA.elo,
      nameB: playerB.name,
      levelB: playerB.level,
      eloB: playerB.elo,
    })
    .from(groupPairs)
    .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(inArray(groupPairs.groupId, phaseGroups))
    .orderBy(asc(groupPairs.groupId), asc(groupPairs.seed));
  const played = await db
    .select({
      id: matches.id,
      groupId: matches.groupId,
      a: matches.pairA,
      b: matches.pairB,
      week: matches.week,
      scheduledAt: matches.scheduledAt,
      status: matches.status,
      outcome: matches.outcome,
    })
    .from(matches)
    .where(inArray(matches.groupId, phaseGroups))
    .orderBy(asc(matches.week), asc(matches.id));
  // A stored outcome the rules engine can't count (D115, #190: a bug or a hand
  // edit; every write is validated) is skipped, so one bad row can't take the
  // public page down: the match counts nowhere on it and shows no result.
  const invalid = played.filter((m) => {
    const outcome = countedOutcome(m);
    return outcome !== null && !isValidOutcome(outcome);
  });
  if (invalid.length > 0)
    logWarn("league page skipped invalid outcomes", { count: invalid.length, matchIds: invalid.map((m) => m.id) });
  const skipped = new Set(invalid.map((m) => m.id));
  return list.map((g) => ({
    id: g.id,
    number: g.number,
    pairs: members
      .filter((m) => m.groupId === g.id)
      .map((m) => ({
        id: m.pairId,
        names: [m.nameA || "Névtelen", m.nameB || "Névtelen"] as [string, string],
        // The pair's current Elo (#13), the last tiebreak (D20).
        elo: averageElo({ elo: m.eloA, level: m.levelA }, { elo: m.eloB, level: m.levelB }) ?? 0,
        // Withdrawn mid-phase (#34): buildLadder drops it and its matches.
        withdrawn: m.withdrawnAt !== null,
      })),
    // Only a final outcome counts (#186, countedOutcome): confirmed,
    // auto-accepted or decided by the organizer; an invalid one never (D115).
    matches: played
      .filter((m) => m.groupId === g.id)
      .map((m) => ({
        id: m.id,
        a: m.a,
        b: m.b,
        week: m.week,
        status: m.status,
        scheduledAt: m.scheduledAt,
        outcome: skipped.has(m.id) ? null : countedOutcome(m),
      })),
  }));
}

/** `mine`: the viewer's pairs, marked on the page (D136). */
export async function ladderPage(slug: string, now = new Date(), mine: ReadonlySet<number> = new Set()): Promise<LadderPage | null> {
  const league = await getLeague(slug);
  if (!league) return null;
  // Like the landing page, only leagues of listed cities are public.
  const [city] = await db.select({ listed: cities.listed }).from(cities).where(eq(cities.slug, league.city));
  if (!city?.listed) return null;
  const season = currentSeason(await listSeasons(league.id), now);
  const head = { league: { name: league.name, city: league.city }, season: season?.name ?? "" };
  if (!season) return { ...head, kind: "waiting", next: null };
  if (isWaiting(season)) {
    // Counted as entryCounts (season-entries.server.ts) does, without that
    // module's email imports on a public page.
    const [[entered], minimums] = await Promise.all([
      db
        .select({ n: count() })
        .from(seasonEntries)
        .where(and(eq(seasonEntries.seasonId, season.id), eq(seasonEntries.status, "approved"))),
      minEntriesByLeague([league.id]),
    ]);
    return { ...head, kind: "waiting", next: null, starting: waitingText(entered?.n ?? 0, minimums.get(league.id) ?? 0) };
  }

  const published = await db
    .selectDistinct({ phase: groups.phase })
    .from(groups)
    .where(and(eq(groups.seasonId, season.id), isNotNull(groups.publishedAt)))
    .orderBy(asc(groups.phase));
  const open = new Set(published.map((p) => p.phase));
  const phases = season.phases.filter((p) => open.has(p.number));
  // The latest published phase that has started, else the first one coming.
  const shown = [...phases].reverse().find((p) => p.startsAt <= now) ?? phases[0];
  if (!shown) {
    const next = season.phases.find((p) => p.startsAt > now) ?? season.phases[0];
    return { ...head, kind: "waiting", next: next ? { round: next.number, startsOn: formatOnDate(next.startsAt) } : null };
  }

  const start: Day = budapestDay(shown.startsAt);
  const { week, started } = phaseWeek(start, budapestDay(now));
  return {
    ...head,
    kind: "ladder",
    phase: shown.number,
    started,
    week,
    startsOn: formatOnDate(shown.startsAt),
    weekFrom: formatShortDay(addDays(start, (week - 1) * 7)),
    weekTo: formatShortDay(addDays(start, (week - 1) * 7 + 6)),
    bands: buildLadder(await phaseInput(season.id, shown.number), started && now <= shown.deadline ? week : null, shown.startsAt, mine),
  };
}

/** Every pair the account is or was in: what the league page marks as theirs (D136). */
export async function pairIdsOf(userId: string): Promise<Set<number>> {
  const rows = await db
    .select({ id: pairs.id })
    .from(pairs)
    .where(or(eq(pairs.playerA, userId), eq(pairs.playerB, userId)));
  return new Set(rows.map((r) => r.id));
}
