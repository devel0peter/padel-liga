import { and, asc, eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { accountInvites, auditLog, leagueAdminInvites, leagueAdmins, leagues, users } from "~/db/schema";

import type { LeagueRef } from "./auth/permissions";
import type { LeagueInput } from "./leagues";

export async function audit(actorId: string | null, action: string, target: string, detail?: string): Promise<void> {
  await db.insert(auditLog).values({ actorId, action, target, detail: detail ?? null });
}

export async function listLeagues(): Promise<LeagueRef[]> {
  return db
    .select({ id: leagues.id, slug: leagues.slug, city: leagues.city, name: leagues.name })
    .from(leagues)
    .orderBy(asc(leagues.name));
}

export async function getLeague(slug: string): Promise<LeagueRef | undefined> {
  const [row] = await db
    .select({ id: leagues.id, slug: leagues.slug, city: leagues.city, name: leagues.name })
    .from(leagues)
    .where(eq(leagues.slug, slug));
  return row;
}

export async function leagueSlugTaken(slug: string): Promise<boolean> {
  return !!(await getLeague(slug));
}

export async function createLeague(input: LeagueInput, actorId: string): Promise<void> {
  await db.insert(leagues).values(input);
  await audit(actorId, "league.create", `league:${input.slug}`, input.name);
}

export type Organizer = { userId: string; name: string; email: string };
export type PendingOrganizer = { email: string };

export async function organizersByLeague(): Promise<Map<number, { active: Organizer[]; pending: PendingOrganizer[] }>> {
  const [active, pending] = await Promise.all([
    db
      .select({ leagueId: leagueAdmins.leagueId, userId: users.id, name: users.name, email: users.email })
      .from(leagueAdmins)
      .innerJoin(users, eq(users.id, leagueAdmins.userId))
      .orderBy(asc(users.name)),
    db
      .select({ leagueId: leagueAdminInvites.leagueId, email: leagueAdminInvites.email })
      .from(leagueAdminInvites)
      .orderBy(asc(leagueAdminInvites.email)),
  ]);
  const out = new Map<number, { active: Organizer[]; pending: PendingOrganizer[] }>();
  const entry = (id: number) => out.get(id) ?? out.set(id, { active: [], pending: [] }).get(id)!;
  for (const { leagueId, ...o } of active) entry(leagueId).active.push(o);
  for (const { leagueId, email } of pending) entry(leagueId).pending.push({ email });
  return out;
}

export type GrantResult = "granted" | "already" | "invited";

// Makes the account with this email a Szervező of the league. An email
// without an account is invited: it may sign up before registration opens,
// and becomes Szervező when its account is created.
export async function grantOrganizer(league: LeagueRef, email: string, actorId: string): Promise<GrantResult> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) {
    const inserted = await db
      .insert(leagueAdmins)
      .values({ leagueId: league.id, userId: user.id, grantedBy: actorId })
      .onConflictDoNothing()
      .returning({ userId: leagueAdmins.userId });
    if (inserted.length === 0) return "already";
    await audit(actorId, "league_admin.grant", email, `league:${league.slug}`);
    return "granted";
  }
  await db.insert(leagueAdminInvites).values({ leagueId: league.id, email, invitedBy: actorId }).onConflictDoNothing();
  await db.insert(accountInvites).values({ email, note: `Szervező: ${league.name}` }).onConflictDoNothing();
  await audit(actorId, "league_admin.invite", email, `league:${league.slug}`);
  return "invited";
}

export async function revokeOrganizer(league: LeagueRef, userId: string, actorId: string): Promise<void> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  await db.delete(leagueAdmins).where(and(eq(leagueAdmins.leagueId, league.id), eq(leagueAdmins.userId, userId)));
  await audit(actorId, "league_admin.revoke", user?.email ?? userId, `league:${league.slug}`);
}

export async function cancelOrganizerInvite(league: LeagueRef, email: string, actorId: string): Promise<void> {
  await db
    .delete(leagueAdminInvites)
    .where(and(eq(leagueAdminInvites.leagueId, league.id), eq(leagueAdminInvites.email, email)));
  await audit(actorId, "league_admin.invite_cancel", email, `league:${league.slug}`);
}
