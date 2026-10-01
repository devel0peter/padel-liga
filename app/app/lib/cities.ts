// Cities (tenants). Signups, and later leagues and organizers, belong to a city.
// Only cities with an organizer are listed; for now that is Győr alone.

export const CITIES = [{ slug: "gyor", name: "Győr" }] as const;

export type CitySlug = (typeof CITIES)[number]["slug"];

export function isCity(value: string): value is CitySlug {
  return CITIES.some((c) => c.slug === value);
}

// "Más város": a signup for a city without an organizer yet. Stored with the
// typed city name, so we can see where demand is.
export const OTHER_CITY = "other";

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

// Maps a typed city name to a supported city, e.g. "gyor" -> Győr.
export function findCity(name: string): CitySlug | null {
  const key = fold(name);
  return CITIES.find((c) => fold(c.name) === key)?.slug ?? null;
}
