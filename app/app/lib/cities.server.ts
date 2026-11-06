import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { cities, clubs, interestSignups, leagues } from "~/db/schema";

import { matchesCity, OTHER_CITY, type City, type CityInput } from "./cities";
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

// Adds a city and files the "Más város" signups that typed its name under it.
// Returns how many signups moved.
export async function createCity(input: CityInput, actorId: string): Promise<number> {
  const others = await db
    .select({ id: interestSignups.id, cityOther: interestSignups.cityOther })
    .from(interestSignups)
    .where(eq(interestSignups.city, OTHER_CITY));
  const ids = others.filter((s) => matchesCity(s.cityOther, input)).map((s) => s.id);
  // One batch: the city, its signups and the audit entry (#225).
  await db.batch([
    db.insert(cities).values(input),
    ...(ids.length ? [db.update(interestSignups).set({ city: input.slug, cityOther: null }).where(inArray(interestSignups.id, ids))] : []),
    auditEntry({ actorId, action: "city.create", target: `city:${input.slug}`, detail: `${input.name}${ids.length ? `; ${ids.length} signups filed` : ""}` }),
  ]);
  return ids.length;
}

export async function updateCity(slug: string, change: Pick<City, "name" | "listed">, actorId: string): Promise<void> {
  await db.batch([
    db.update(cities).set(change).where(eq(cities.slug, slug)),
    auditIfChanged({ actorId, action: "city.update", target: `city:${slug}`, detail: `${change.name}; listed=${change.listed}` }),
  ]);
}

export type CityUsage = { signups: number; clubs: number; leagues: number };

export async function cityUsage(): Promise<Map<string, CityUsage>> {
  const [s, c, l] = await Promise.all([
    db.select({ city: interestSignups.city, n: count() }).from(interestSignups).groupBy(interestSignups.city),
    db.select({ city: clubs.city, n: count() }).from(clubs).groupBy(clubs.city),
    db.select({ city: leagues.city, n: count() }).from(leagues).groupBy(leagues.city),
  ]);
  const out = new Map<string, CityUsage>();
  const entry = (city: string) => out.get(city) ?? out.set(city, { signups: 0, clubs: 0, leagues: 0 }).get(city)!;
  for (const r of s) entry(r.city).signups = r.n;
  for (const r of c) entry(r.city).clubs = r.n;
  for (const r of l) entry(r.city).leagues = r.n;
  return out;
}

// Only a city nothing refers to: signups, clubs and leagues keep a city slug.
export async function deleteCity(slug: string, actorId: string): Promise<boolean> {
  const usage = (await cityUsage()).get(slug);
  if (usage && usage.signups + usage.clubs + usage.leagues > 0) return false;
  await db.batch([
    db.delete(cities).where(eq(cities.slug, slug)),
    auditIfChanged({ actorId, action: "city.delete", target: `city:${slug}` }),
  ]);
  return true;
}
