import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { auditLog, leagueAdminInvites, leagueAdmins, oauthAccounts, users } from "~/db/schema";

import type { ProfileInput, Sex } from "./rules";

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return row?.id ?? null;
}

export async function createUser(email: string, name = ""): Promise<string> {
  const id = crypto.randomUUID();
  // onConflictDoNothing: two logins racing for a new email end up in one account.
  await db.insert(users).values({ id, email, name }).onConflictDoNothing();
  const userId = (await findUserIdByEmail(email)) ?? id;
  await acceptOrganizerInvites(userId, email);
  return userId;
}

// Szervező appointments made before this email had an account
// (leagues.server.ts grantOrganizer).
async function acceptOrganizerInvites(userId: string, email: string): Promise<void> {
  const invites = await db.select().from(leagueAdminInvites).where(eq(leagueAdminInvites.email, email));
  for (const inv of invites) {
    await db
      .insert(leagueAdmins)
      .values({ leagueId: inv.leagueId, userId, grantedBy: inv.invitedBy })
      .onConflictDoNothing();
    await db.insert(auditLog).values({ actorId: inv.invitedBy, action: "league_admin.grant", target: email, detail: `invite:${inv.leagueId}` });
  }
  if (invites.length) await db.delete(leagueAdminInvites).where(eq(leagueAdminInvites.email, email));
}

// First login: the profile and the privacy consent.
export async function saveProfile(userId: string, profile: ProfileInput): Promise<void> {
  await db
    .update(users)
    .set({ name: profile.name, level: profile.level, phone: profile.phone, sex: profile.sex, consentAt: new Date() })
    .where(eq(users.id, userId));
}

// The profile page: the same fields, the consent stays as it was given.
export async function updateProfile(userId: string, profile: Omit<ProfileInput, "consent">): Promise<void> {
  await db
    .update(users)
    .set({ name: profile.name, level: profile.level, phone: profile.phone, sex: profile.sex })
    .where(eq(users.id, userId));
}

// The one-time question to accounts from before it was asked (#133).
export async function saveSex(userId: string, sex: Sex): Promise<void> {
  await db.update(users).set({ sex }).where(eq(users.id, userId));
}

export async function hasGoogleLogin(userId: string): Promise<boolean> {
  const [row] = await db.select({ p: oauthAccounts.provider }).from(oauthAccounts).where(eq(oauthAccounts.userId, userId)).limit(1);
  return !!row;
}

export async function setProfileImage(userId: string, imageUrl: string | null): Promise<void> {
  await db.update(users).set({ imageUrl }).where(eq(users.id, userId));
}
