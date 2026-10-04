import { asc, eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { clubs } from "~/db/schema";

import type { Club, ClubInput } from "./clubs";

export async function listClubs(): Promise<Club[]> {
  return db.select().from(clubs).orderBy(asc(clubs.city), asc(clubs.name));
}

export async function getClub(slug: string): Promise<Club | undefined> {
  const [club] = await db.select().from(clubs).where(eq(clubs.slug, slug));
  return club;
}

export async function slugTaken(slug: string, exceptId?: number): Promise<boolean> {
  const [row] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, slug));
  return !!row && row.id !== exceptId;
}

export async function createClub(input: ClubInput): Promise<void> {
  await db.insert(clubs).values(input);
}

export async function updateClub(id: number, input: ClubInput): Promise<void> {
  await db.update(clubs).set({ ...input, updatedAt: new Date() }).where(eq(clubs.id, id));
}

// Signups keep their ref; they then show the raw slug as the source.
export async function deleteClub(id: number): Promise<void> {
  await db.delete(clubs).where(eq(clubs.id, id));
}
