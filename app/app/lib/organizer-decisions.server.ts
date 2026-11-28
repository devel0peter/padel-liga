import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import {
  groups,
  leagues,
  matchDecisions,
  matches,
  noShowReports,
  pairs,
  partnerChanges,
  seasonPhases,
  seasons,
  users,
} from "~/db/schema";
import type { Actor } from "./auth/permissions";
import { leagueMatches } from "./decisions.server";
import { leagueNoShows } from "./no-shows.server";
import { leaguePartnerChanges } from "./partner-changes.server";
import { isWaiting } from "./seasons";

// Organizer decisions, Rád vár queue, sidebar counts, and Kezdőlap card (#434, #438, #440).

export type OpenDecisionItem =
  | {
      kind: "dispute";
      id: string;
      matchId: number;
      seasonId: number;
      phase: number;
      groupNumber: number;
      pairsLabel: string;
      waitingSince: Date;
      url: string;
    }
  | {
      kind: "no_show";
      id: string;
      matchId: number;
      reportId: number;
      seasonId: number;
      phase: number;
      groupNumber: number;
      pairsLabel: string;
      waitingSince: Date;
      url: string;
    }
  | {
      kind: "partner_change";
      id: string;
      changeId: number;
      seasonName: string | null;
      stayingName: string;
      leavingName: string;
      partnerName: string;
      changesThisSeason: number;
      waitingSince: Date;
      url: string;
    };

export type WaitingPublishItem = {
  kind: "publish_round";
  id: string;
  seasonId: number;
  seasonName: string;
  phase: number;
  isFirstRound: boolean;
  waitingSince: Date;
  url: string;
};

export type RadVarItem = OpenDecisionItem | WaitingPublishItem;

export type ClosedDecisionItem = {
  id: string;
  kind: "dispute" | "no_show" | "partner_change";
  title: string;
  outcome: string;
  decidedBy: string | null;
  decidedAt: Date;
  url: string | null;
  // For approved (final) partner changes that have not started yet (#434 req 3).
  undoChangeId?: number;
};

export async function openDecisions(leagueId: number, leagueSlug: string, now = new Date()): Promise<OpenDecisionItem[]> {
  const [{ disputes }, noShows, changes] = await Promise.all([
    leagueMatches(leagueId),
    leagueNoShows(leagueId),
    leaguePartnerChanges(leagueId, now),
  ]);

  const items: OpenDecisionItem[] = [];
  for (const d of disputes) {
    items.push({
      kind: "dispute",
      id: `dispute:${d.matchId}`,
      matchId: d.matchId,
      seasonId: d.seasonId,
      phase: d.phase,
      groupNumber: d.group,
      pairsLabel: `${d.a.name} – ${d.b.name}`,
      waitingSince: d.disputedAt,
      url: `/admin/leagues/${leagueSlug}/matches/${d.matchId}?from=decisions`,
    });
  }
  for (const n of noShows) {
    items.push({
      kind: "no_show",
      id: `no_show:${n.id}`,
      matchId: n.matchId,
      reportId: n.id,
      seasonId: n.seasonId,
      phase: n.phase,
      groupNumber: n.group,
      pairsLabel: `${n.a.name} – ${n.b.name}`,
      waitingSince: n.reportedAt,
      url: `/admin/leagues/${leagueSlug}/matches/${n.matchId}?from=decisions`,
    });
  }
  for (const c of changes) {
    if (c.status !== "accepted") continue;
    items.push({
      kind: "partner_change",
      id: `partner_change:${c.id}`,
      changeId: c.id,
      seasonName: c.seasonName,
      stayingName: c.staying.name,
      leavingName: c.leaving.name,
      partnerName: c.partner.name,
      changesThisSeason: c.pairChangesThisSeason,
      waitingSince: c.acceptedAt ?? c.createdAt,
      url: `/admin/leagues/${leagueSlug}/disputes`,
    });
  }
  return items.sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime());
}

export async function closedDecisions(leagueId: number, leagueSlug: string, now = new Date()): Promise<ClosedDecisionItem[]> {
  const cutoff = new Date(now.getTime() - 14 * 86_400_000);
  const decider = alias(users, "decider_user");
  const [decisions, noShows, changes] = await Promise.all([
    db
      .select({
        id: matchDecisions.id,
        matchId: matchDecisions.matchId,
        kind: matchDecisions.kind,
        reason: matchDecisions.reason,
        at: matchDecisions.decidedAt,
        deciderName: decider.name,
        groupNumber: groups.number,
        phase: groups.phase,
      })
      .from(matchDecisions)
      .innerJoin(matches, eq(matches.id, matchDecisions.matchId))
      .innerJoin(groups, eq(groups.id, matches.groupId))
      .innerJoin(seasons, eq(seasons.id, groups.seasonId))
      .leftJoin(decider, eq(decider.id, matchDecisions.decidedBy))
      .where(and(eq(seasons.leagueId, leagueId), gte(matchDecisions.decidedAt, cutoff)))
      .orderBy(desc(matchDecisions.decidedAt))
      .limit(50),
    db
      .select({
        id: noShowReports.id,
        matchId: noShowReports.matchId,
        status: noShowReports.status,
        decidedAt: noShowReports.decidedAt,
        deciderName: decider.name,
        groupNumber: groups.number,
        phase: groups.phase,
      })
      .from(noShowReports)
      .innerJoin(matches, eq(matches.id, noShowReports.matchId))
      .innerJoin(groups, eq(groups.id, matches.groupId))
      .innerJoin(seasons, eq(seasons.id, groups.seasonId))
      .leftJoin(decider, eq(decider.id, noShowReports.decidedBy))
      .where(
        and(
          eq(seasons.leagueId, leagueId),
          or(eq(noShowReports.status, "confirmed"), eq(noShowReports.status, "rejected")),
          isNotNull(noShowReports.decidedAt),
          gte(noShowReports.decidedAt, cutoff),
        ),
      )
      .orderBy(desc(noShowReports.decidedAt))
      .limit(50),
    leaguePartnerChanges(leagueId, now),
  ]);

  const out: ClosedDecisionItem[] = [];
  for (const d of decisions) {
    out.push({
      id: `decision:${d.id}`,
      kind: "dispute",
      title: `${d.phase}. kör · ${d.groupNumber}. csoport`,
      outcome: d.kind === "override" ? "Felülbírálat" : "Vita eldöntve",
      decidedBy: d.deciderName ?? null,
      decidedAt: d.at,
      url: `/admin/leagues/${leagueSlug}/matches/${d.matchId}?from=decisions`,
    });
  }
  for (const n of noShows) {
    if (!n.decidedAt) continue;
    out.push({
      id: `no_show_closed:${n.id}`,
      kind: "no_show",
      title: `${n.phase}. kör · ${n.groupNumber}. csoport (Nem jöttek el)`,
      outcome: n.status === "confirmed" ? "Jóváhagyva (játék nélkül)" : "Elutasítva",
      decidedBy: n.deciderName ?? null,
      decidedAt: n.decidedAt,
      url: `/admin/leagues/${leagueSlug}/matches/${n.matchId}?from=decisions`,
    });
  }
  for (const c of changes) {
    const decidedAt = c.decidedAt ?? c.updatedAt;
    const isFinalPendingStart = c.status === "final";
    const isRecentClosed = (c.status === "rejected" || c.status === "started" || c.status === "undone") && decidedAt >= cutoff;
    if (!isFinalPendingStart && !isRecentClosed) continue;
    out.push({
      id: `pc_closed:${c.id}`,
      kind: "partner_change",
      title: `Partnercsere: ${c.staying.name} (${c.leaving.name} → ${c.partner.name})`,
      outcome:
        c.status === "final"
          ? c.startsPhase
            ? `Jóváhagyva (${c.startsPhase}. körtől indul)`
            : "Jóváhagyva (következő szezontól)"
          : c.status === "started"
            ? "Elindult"
            : c.status === "undone"
              ? "Visszavonva"
              : "Elutasítva",
      decidedBy: null,
      decidedAt,
      url: null,
      undoChangeId: isFinalPendingStart ? c.id : undefined,
    });
  }
  return out.sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime());
}

export async function waitingRoundsToPublish(leagueId: number, leagueSlug: string, now = new Date()): Promise<WaitingPublishItem[]> {
  const [leagueSeasons, leagueGroups] = await Promise.all([
    db.select().from(seasons).where(eq(seasons.leagueId, leagueId)).orderBy(desc(seasons.id)),
    db
      .select({
        seasonId: groups.seasonId,
        phase: groups.phase,
        publishedAt: groups.publishedAt,
        createdAt: groups.createdAt,
      })
      .from(groups)
      .innerJoin(seasons, eq(seasons.id, groups.seasonId))
      .where(eq(seasons.leagueId, leagueId)),
  ]);

  const items: WaitingPublishItem[] = [];
  const seen = new Set<string>();
  for (const s of leagueSeasons) {
    const sGroups = leagueGroups.filter((g) => g.seasonId === s.id);
    // Any unpublished draft (phase 1..4)
    const phases = [...new Set(sGroups.map((g) => g.phase))].sort((a, b) => a - b);
    for (const phase of phases) {
      const pg = sGroups.filter((g) => g.phase === phase);
      if (pg.some((g) => !g.publishedAt)) {
        const key = `${s.id}:${phase}`;
        seen.add(key);
        const oldest = pg.reduce((min, g) => (g.createdAt < min ? g.createdAt : min), pg[0]!.createdAt);
        items.push({
          kind: "publish_round",
          id: `publish:${key}`,
          seasonId: s.id,
          seasonName: s.name,
          phase,
          isFirstRound: phase === 1,
          waitingSince: oldest,
          url: `/admin/leagues/${leagueSlug}/seasons/${s.id}/rounds/${phase}?tab=groups`,
        });
      }
    }
    // Round 1 ready to publish once registration closed (or first season start fixed) and round 1 not published yet
    if (!seen.has(`${s.id}:1`) && !sGroups.some((g) => g.phase === 1 && g.publishedAt)) {
      const waiting = isWaiting(s);
      if (!waiting && s.registrationClosesAt < now) {
        items.push({
          kind: "publish_round",
          id: `publish:${s.id}:1`,
          seasonId: s.id,
          seasonName: s.name,
          phase: 1,
          isFirstRound: true,
          waitingSince: s.registrationClosesAt,
          url: `/admin/leagues/${leagueSlug}/seasons/${s.id}/rounds/1?tab=groups`,
        });
      }
    }
  }
  return items.sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime());
}

export async function radVarItems(leagueId: number, leagueSlug: string, now = new Date()): Promise<RadVarItem[]> {
  const [decisions, publishes] = await Promise.all([
    openDecisions(leagueId, leagueSlug, now),
    waitingRoundsToPublish(leagueId, leagueSlug, now),
  ]);
  return [...decisions, ...publishes].sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime());
}

export type RunningRoundRef = { seasonId: number; phase: number; seasonName: string };

export async function runningRoundForLeague(leagueId: number, now = new Date()): Promise<RunningRoundRef | null> {
  const rows = await db
    .select({
      seasonId: seasons.id,
      seasonName: seasons.name,
      phase: seasonPhases.number,
      startsAt: seasonPhases.startsAt,
      deadline: seasonPhases.deadline,
    })
    .from(seasonPhases)
    .innerJoin(seasons, eq(seasons.id, seasonPhases.seasonId))
    .where(and(eq(seasons.leagueId, leagueId), lte(seasonPhases.startsAt, now), gte(seasonPhases.deadline, now)))
    .orderBy(desc(seasons.id), desc(seasonPhases.number))
    .limit(1);
  const active = rows[0];
  if (active) return { seasonId: active.seasonId, phase: active.phase, seasonName: active.seasonName };

  // Fallback: latest published round of the latest season (e.g. between deadline and next publish)
  const latest = await db
    .select({
      seasonId: seasons.id,
      seasonName: seasons.name,
      phase: groups.phase,
    })
    .from(groups)
    .innerJoin(seasons, eq(seasons.id, groups.seasonId))
    .where(and(eq(seasons.leagueId, leagueId), isNotNull(groups.publishedAt)))
    .orderBy(desc(seasons.id), desc(groups.phase))
    .limit(1);
  return latest[0] ?? null;
}

export async function organizerSidebarMeta(leagueId: number, leagueSlug: string, now = new Date()): Promise<{
  radVarCount: number;
  decisionsCount: number;
  runningRound: RunningRoundRef | null;
}> {
  const [decisions, publishes, runningRound] = await Promise.all([
    openDecisions(leagueId, leagueSlug, now),
    waitingRoundsToPublish(leagueId, leagueSlug, now),
    runningRoundForLeague(leagueId, now),
  ]);
  return {
    radVarCount: decisions.length + publishes.length,
    decisionsCount: decisions.length,
    runningRound,
  };
}

// For Kezdőlap card and phone menu badge (#440): batched queries across the
// actor's organized leagues (or all leagues for Admin without explicit league rows).
export async function organizerHomeSummary(
  actor: Actor | null,
  now = new Date(),
): Promise<{ total: number; leagues: { slug: string; name: string; count: number }[] }> {
  if (!actor) return { total: 0, leagues: [] };
  let targetLeagues: { id: number; slug: string; name: string }[] = actor.leagues;
  if (targetLeagues.length === 0 && actor.platformRole === "superadmin") {
    targetLeagues = await db
      .select({ id: leagues.id, slug: leagues.slug, name: leagues.name })
      .from(leagues)
      .orderBy(asc(leagues.name))
      .limit(20);
  }
  if (targetLeagues.length === 0) return { total: 0, leagues: [] };

  const ids = targetLeagues.map((l) => l.id);
  const [disputeRows, noShowRows, changeRows, draftRows] = await Promise.all([
    db
      .select({ leagueId: seasons.leagueId })
      .from(matches)
      .innerJoin(groups, eq(groups.id, matches.groupId))
      .innerJoin(seasons, eq(seasons.id, groups.seasonId))
      .where(and(inArray(seasons.leagueId, ids), eq(matches.status, "disputed"))),
    db
      .select({ leagueId: seasons.leagueId })
      .from(noShowReports)
      .innerJoin(matches, eq(matches.id, noShowReports.matchId))
      .innerJoin(groups, eq(groups.id, matches.groupId))
      .innerJoin(seasons, eq(seasons.id, groups.seasonId))
      .where(and(inArray(seasons.leagueId, ids), eq(noShowReports.status, "open"))),
    db
      .select({ leagueId: partnerChanges.leagueId })
      .from(partnerChanges)
      .where(and(inArray(partnerChanges.leagueId, ids), eq(partnerChanges.status, "accepted"))),
    db
      .selectDistinct({ leagueId: seasons.leagueId, seasonId: groups.seasonId, phase: groups.phase })
      .from(groups)
      .innerJoin(seasons, eq(seasons.id, groups.seasonId))
      .where(and(inArray(seasons.leagueId, ids), isNull(groups.publishedAt))),
  ]);

  const counts = new Map<number, number>();
  const bump = (id: number) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const r of disputeRows) bump(r.leagueId);
  for (const r of noShowRows) bump(r.leagueId);
  for (const r of changeRows) bump(r.leagueId);
  for (const r of draftRows) bump(r.leagueId);

  const nonZero = targetLeagues
    .map((l) => ({ slug: l.slug, name: l.name, count: counts.get(l.id) ?? 0 }))
    .filter((l) => l.count > 0);
  return {
    total: nonZero.reduce((sum, l) => sum + l.count, 0),
    leagues: nonZero,
  };
}
