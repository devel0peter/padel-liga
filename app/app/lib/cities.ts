// Cities (tenants). Signups, and later leagues and organizers, belong to a city.
// Only cities with an organizer are listed; for now that is Győr alone.

export const CITIES = [{ slug: "gyor", name: "Győr" }] as const;

export type CitySlug = (typeof CITIES)[number]["slug"];

export function isCity(value: string): value is CitySlug {
  return CITIES.some((c) => c.slug === value);
}
