import { asc, count, eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { cities, clubs, leagues } from "~/db/schema";

import { type City, type CityInput } from "./cities";
import { auditEntry, auditIfChanged } from "./audit.server";

export async function listCities(): Promise<City[]> {
  return db.select({ slug: cities.slug, name: cities.name, listed: cities.listed }).from(cities).orderBy(asc(cities.name));
}

// Offered on the public signup form and the landing page.
export async function listedCities(): Promise<City[]> {
  return (await listCities()).filter((c) => c.listed);
}

export async function getCity(slug: string): Promise<City | undefined> {
  return (await listCities()).find((c) => c.slug === slug);
}

// Adds a city, audited (#225). The interest list's "Más város" signups are
// no longer filed under it (#333, D129).
export async function createCity(input: CityInput, actorId: string): Promise<void> {
  await db.batch([
    db.insert(cities).values(input),
    auditEntry({ actorId, action: "city.create", target: `city:${input.slug}`, detail: input.name }),
  ]);
}

export async function updateCity(slug: string, change: Pick<City, "name" | "listed">, actorId: string): Promise<void> {
  await db.batch([
    db.update(cities).set(change).where(eq(cities.slug, slug)),
    auditIfChanged({ actorId, action: "city.update", target: `city:${slug}`, detail: `${change.name}; listed=${change.listed}` }),
  ]);
}

export type CityUsage = { clubs: number; leagues: number };

export async function cityUsage(): Promise<Map<string, CityUsage>> {
  const [c, l] = await Promise.all([
    db.select({ city: clubs.city, n: count() }).from(clubs).groupBy(clubs.city),
    db.select({ city: leagues.city, n: count() }).from(leagues).groupBy(leagues.city),
  ]);
  const out = new Map<string, CityUsage>();
  const entry = (city: string) => out.get(city) ?? out.set(city, { clubs: 0, leagues: 0 }).get(city)!;
  for (const r of c) entry(r.city).clubs = r.n;
  for (const r of l) entry(r.city).leagues = r.n;
  return out;
}

// Only a city nothing refers to: clubs and leagues keep a city slug. The
// interest list's signups don't count (#333) and the list is deleted (#334),
// so none is left pointing at a deleted city.
export async function deleteCity(slug: string, actorId: string): Promise<boolean> {
  const usage = (await cityUsage()).get(slug);
  if (usage && usage.clubs + usage.leagues > 0) return false;
  await db.batch([
    db.delete(cities).where(eq(cities.slug, slug)),
    auditIfChanged({ actorId, action: "city.delete", target: `city:${slug}` }),
  ]);
  return true;
}
