import { and, desc, eq, gte, inArray, like, lte, notInArray, or, type SQL } from "drizzle-orm";

import { db } from "~/db/client.server";
import { auditLog, clubs, users } from "~/db/schema";

// Organizer-scoped Napló (#389): shows only the league's own entries plus
// city-scoped club.* entries for clubs in the league's city. Platform entries
// (accounts, logins, user edits, feedback, other leagues) are always hidden.
// Never returns email addresses.

const HIDDEN_PLATFORM_PREFIXES = ["user.", "feedback.", "superadmin.", "account_invite.", "city.", "interest_list.", "login."];

export function isOrganizerVisibleAction(action: string): boolean {
  return !HIDDEN_PLATFORM_PREFIXES.some((p) => action.startsWith(p));
}

export type OrganizerLogEntry = {
  id: number;
  at: Date;
  action: string;
  actorId: string | null;
  actorName: string | null;
  target: string;
  detail: string | null;
};

export async function leagueAuditLog(
  leagueId: number,
  citySlug: string,
  filters: { action?: string; actorId?: string; from?: Date; to?: Date } = {},
): Promise<{
  entries: OrganizerLogEntry[];
  actors: { id: string; name: string }[];
  actions: string[];
}> {
  const cityClubs = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.city, citySlug));
  const clubTargets = cityClubs.map((c) => `club:${c.id}`);

  const scope: SQL =
    clubTargets.length > 0
      ? or(eq(auditLog.leagueId, leagueId), and(like(auditLog.action, "club.%"), inArray(auditLog.target, clubTargets)))!
      : eq(auditLog.leagueId, leagueId);

  const conditions: (SQL | undefined)[] = [
    scope,
    filters.action ? eq(auditLog.action, filters.action) : undefined,
    filters.actorId ? eq(auditLog.actorId, filters.actorId) : undefined,
    filters.from ? gte(auditLog.at, filters.from) : undefined,
    filters.to ? lte(auditLog.at, filters.to) : undefined,
  ];

  const [rows, allScopedActors, allScopedActions] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        action: auditLog.action,
        actorId: auditLog.actorId,
        actorName: users.name,
        target: auditLog.target,
        detail: auditLog.detail,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(and(...conditions))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(200),
    db
      .selectDistinct({ id: users.id, name: users.name })
      .from(auditLog)
      .innerJoin(users, eq(users.id, auditLog.actorId))
      .where(scope),
    db.selectDistinct({ action: auditLog.action }).from(auditLog).where(scope),
  ]);

  const entries = rows
    .filter((r) => isOrganizerVisibleAction(r.action))
    .map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      actorId: r.actorId,
      actorName: r.actorName ?? null,
      target: r.target,
      detail: r.detail,
    }));

  const actors = allScopedActors
    .map((a) => ({ id: a.id, name: a.name || "Névtelen" }))
    .sort((a, b) => a.name.localeCompare(b.name, "hu"));

  const actions = allScopedActions
    .map((a) => a.action)
    .filter(isOrganizerVisibleAction)
    .sort();

  return { entries, actors, actions };
}
