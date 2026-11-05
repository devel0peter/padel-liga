import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { accountInvites, leagueAdminInvites, leagueAdmins, leagues, users } from "~/db/schema";

import { auditEntry, auditIfChanged } from "./audit.server";
import type { LeagueRef } from "./auth/permissions";
import type { LeagueInput } from "./leagues";

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
  // The new league's id, by its unique slug, inside the same batch.
  const id = sql`(select ${leagues.id} from ${leagues} where ${leagues.slug} = ${input.slug})`;
  await db.batch([
    db.insert(leagues).values(input),
    auditEntry({ actorId, action: "league.create", target: sql`'league:' || ${id}`, detail: input.name, leagueId: id }),
  ]);
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
// without an account is invited (an account_invites row, which only exempts
// it from the daily cap on login codes to new addresses, #113), and becomes
// Szervező when its account is created.
export async function grantOrganizer(league: LeagueRef, email: string, actorId: string): Promise<GrantResult> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) {
    const [inserted] = await db.batch([
      db
        .insert(leagueAdmins)
        .values({ leagueId: league.id, userId: user.id, grantedBy: actorId })
        .onConflictDoNothing()
        .returning({ userId: leagueAdmins.userId }),
      auditIfChanged({ actorId, action: "league_admin.grant", target: `user:${user.id}`, leagueId: league.id }),
    ]);
    return inserted.length === 0 ? "already" : "granted";
  }
  // No account yet, so no id to name: the entry names the league only (no
  // email in the log, #225). Accepting the invite logs the grant by id.
  await db.batch([
    db.insert(leagueAdminInvites).values({ leagueId: league.id, email, invitedBy: actorId }).onConflictDoNothing(),
    auditIfChanged({ actorId, action: "league_admin.invite", target: `league:${league.id}`, leagueId: league.id }),
    db.insert(accountInvites).values({ email, note: `Szervező: ${league.name}` }).onConflictDoNothing(),
  ]);
  return "invited";
}

export async function revokeOrganizer(league: LeagueRef, userId: string, actorId: string): Promise<void> {
  await db.batch([
    db.delete(leagueAdmins).where(and(eq(leagueAdmins.leagueId, league.id), eq(leagueAdmins.userId, userId))),
    auditIfChanged({ actorId, action: "league_admin.revoke", target: `user:${userId}`, leagueId: league.id }),
  ]);
}

export async function cancelOrganizerInvite(league: LeagueRef, email: string, actorId: string): Promise<void> {
  await db.batch([
    db.delete(leagueAdminInvites).where(and(eq(leagueAdminInvites.leagueId, league.id), eq(leagueAdminInvites.email, email))),
    auditIfChanged({ actorId, action: "league_admin.invite_cancel", target: `league:${league.id}`, leagueId: league.id }),
  ]);
}
