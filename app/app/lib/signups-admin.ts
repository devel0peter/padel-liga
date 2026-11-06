// What is left of the interest list's admin view since Jelentkezők went
// (#333, D128): the names Napló shows for old signup entries, and the labels
// the landing form's confirmation and the level columns use. Pure.

import { cityName, OTHER_CITY, type City } from "./cities";
import { LEVELS } from "./interest";

export const STATUSES = {
  new: "Új",
  contacted: "Megkeresve",
  paired: "Párosítva",
  withdrawn: "Visszalépett",
} as const;

export type Status = keyof typeof STATUSES;

// `cities`: the known cities (cities.server.ts); an unknown slug shows as is.
export function cityLabel(r: { city: string; cityOther: string | null }, cities: readonly Pick<City, "slug" | "name">[] = []): string {
  if (r.city === OTHER_CITY) return r.cityOther ? `${r.cityOther} (más város)` : "Más város";
  return cityName(r.city, cities);
}

export function levelLabel(level: string): string {
  const label = (LEVELS as Record<string, string>)[level];
  return label ? label.split(" – ")[0] : level;
}
