import { asc, eq, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { clubs } from "~/db/schema";

import { auditEntry, auditIfChanged, auditWhen } from "./audit.server";
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

// Each write with its audit entry in one batch (#225).

export async function createClub(input: ClubInput, actorId: string): Promise<void> {
  const id = sql`(select ${clubs.id} from ${clubs} where ${clubs.slug} = ${input.slug})`;
  await db.batch([
    db.insert(clubs).values(input),
    auditEntry({ actorId, action: "club.create", target: sql`'club:' || ${id}`, detail: input.name }),
  ]);
}

export async function updateClub(id: number, input: ClubInput, actorId: string): Promise<void> {
  await db.batch([
    db.update(clubs).set({ ...input, updatedAt: new Date() }).where(eq(clubs.id, id)),
    auditIfChanged({ actorId, action: "club.update", target: `club:${id}`, detail: input.name }),
  ]);
}

export async function setClubActive(id: number, active: boolean, actorId: string): Promise<void> {
  await db.batch([
    db.update(clubs).set({ active, updatedAt: new Date() }).where(eq(clubs.id, id)),
    auditIfChanged({ actorId, action: active ? "club.activate" : "club.deactivate", target: `club:${id}` }),
  ]);
}

// Signups keep their ref; they then show the raw slug as the source.
export async function deleteClub(id: number, actorId: string): Promise<void> {
  await db.batch([
    auditWhen(sql`exists (select 1 from ${clubs} where ${clubs.id} = ${id})`, {
      actorId,
      action: "club.delete",
      target: `club:${id}`,
      detail: sql`(select ${clubs.name} from ${clubs} where ${clubs.id} = ${id})`,
    }),
    db.delete(clubs).where(eq(clubs.id, id)),
  ]);
}
