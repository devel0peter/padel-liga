import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { accountInvites, oauthAccounts, users } from "~/db/schema";

import { canCreateAccount, type ProfileInput } from "./rules";

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return row?.id ?? null;
}

export async function isInvited(email: string): Promise<boolean> {
  const [row] = await db.select({ email: accountInvites.email }).from(accountInvites).where(eq(accountInvites.email, email));
  return !!row;
}

// Whether a login with this (normalized) email may go ahead: an existing
// account always can; a new one only when invited or registration is open.
export async function mayLogIn(email: string): Promise<boolean> {
  if (await findUserIdByEmail(email)) return true;
  return canCreateAccount({ invited: await isInvited(email), now: new Date() });
}

export async function createUser(email: string, name = ""): Promise<string> {
  const id = crypto.randomUUID();
  // onConflictDoNothing: two logins racing for a new email end up in one account.
  await db.insert(users).values({ id, email, name }).onConflictDoNothing();
  return (await findUserIdByEmail(email)) ?? id;
}

export async function saveProfile(userId: string, profile: ProfileInput): Promise<void> {
  await db.update(users).set({ name: profile.name, consentAt: new Date() }).where(eq(users.id, userId));
}

export async function hasGoogleLogin(userId: string): Promise<boolean> {
  const [row] = await db.select({ p: oauthAccounts.provider }).from(oauthAccounts).where(eq(oauthAccounts.userId, userId)).limit(1);
  return !!row;
}

export async function setProfileImage(userId: string, imageUrl: string | null): Promise<void> {
  await db.update(users).set({ imageUrl }).where(eq(users.id, userId));
}
