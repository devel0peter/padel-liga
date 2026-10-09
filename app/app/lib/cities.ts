// Cities (tenants). Signups, clubs, leagues and organizers belong to a city.
// The list lives in the database (cities table, /admin/cities); these helpers
// take it as an argument. Pure (no I/O): cities.server.ts loads the list.

import { isSlug, slugify } from "./slug";

export type City = { slug: string; name: string; listed: boolean };

// "Más város": a signup for a city that isn't listed yet. Stored with the
// typed city name, so we can see where demand is.
export const OTHER_CITY = "other";

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

// Whether `value` is one of `cities` (by slug).
export function isCity(value: string, cities: readonly Pick<City, "slug">[]): boolean {
  return cities.some((c) => c.slug === value);
}

// Maps a typed city name to one of `cities`, e.g. "gyor" -> Győr.
export function findCity(name: string, cities: readonly Pick<City, "slug" | "name">[]): string | null {
  const key = fold(name);
  return cities.find((c) => fold(c.name) === key || c.slug === key)?.slug ?? null;
}

export function cityName(slug: string, cities: readonly Pick<City, "slug" | "name">[]): string {
  return cities.find((c) => c.slug === slug)?.name ?? slug;
}

export type CityInput = City;
export type CityField = "name" | "slug";
export type CityResult = { ok: true; data: CityInput } | { ok: false; errors: Partial<Record<CityField, string>> };

const MAX_NAME = 60;

// The Admin's city form. An empty slug is made from the name ("Győr" -> "gyor").
export function parseCity(form: FormData): CityResult {
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
  const slug = String(form.get("slug") ?? "").trim().toLowerCase() || slugify(name);
  const listed = form.get("listed") === "on";
  const errors: Partial<Record<CityField, string>> = {};
  if (name.length < 2) errors.name = "Add meg a város nevét.";
  else if (name.length > MAX_NAME) errors.name = `Legfeljebb ${MAX_NAME} karakter.`;
  if (!isSlug(slug) || slug === OTHER_CITY) errors.slug = "Csak kisbetű, szám és kötőjel, legfeljebb 40 karakter.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data: { slug, name, listed } };
}

// "Más város" signups whose typed name is this city: filed under it once the
// city is added, so the demand counted there isn't lost.
export function matchesCity(typed: string | null, city: Pick<City, "slug" | "name">): boolean {
  return !!typed && findCity(typed, [city]) === city.slug;
}

// Below this many pairs a city's landing chip says "jelentkezés nyitva"
// instead of a count: a small number puts people off more than none.
export const MIN_SHOWN_PAIRS = 6;

// Pairs signed up per city for the landing page: a pair signup counts one,
// two solos a Szervező paired count one, an unpaired solo none. Withdrawn
// signups don't count. Cities under MIN_SHOWN_PAIRS are left out.
export function pairCounts(
  rows: readonly { city: string; mode: "pair" | "solo"; paired: boolean; n: number }[],
): Map<string, number> {
  const pairs = new Map<string, number>();
  const pairedSolos = new Map<string, number>();
  for (const r of rows) {
    if (r.mode === "pair") pairs.set(r.city, (pairs.get(r.city) ?? 0) + r.n);
    else if (r.paired) pairedSolos.set(r.city, (pairedSolos.get(r.city) ?? 0) + r.n);
  }
  for (const [city, n] of pairedSolos) pairs.set(city, (pairs.get(city) ?? 0) + Math.floor(n / 2));
  for (const [city, n] of pairs) if (n < MIN_SHOWN_PAIRS) pairs.delete(city);
  return pairs;
}
