// Clubs and signup sources. Pure (no I/O); the D1 access lives in
// clubs.server.ts. Clubs are internal: nothing about them is public.
//
// Two signals per club:
// - poster: a club's slug is the `?ref=` on its poster QR code. Any other ref
//   (e.g. "verseny" for a tournament flyer) is kept as typed and shown as is.
// - home club: the optional "where do you play most" answer on the signup form.

import { isCity, type City } from "./cities";
import { SITE_URL } from "./site";

export type Club = {
  id: number;
  slug: string;
  city: string;
  name: string;
  adminNote: string | null;
};

// What the signup form gets: no admin fields.
export type ClubOption = Pick<Club, "slug" | "city" | "name">;

export function toClubOption({ slug, city, name }: Club): ClubOption {
  return { slug, city, name };
}

// "Máshol / vegyesen" answer to "where do you play most".
export const OTHER_CLUB = "other";

export { isSlug, normalizeRef, slugify } from "./slug";
import { isSlug, slugify } from "./slug";

export function posterUrl(slug: string): string {
  return `${SITE_URL}/?ref=${slug}`;
}

export type ClubInput = Omit<Club, "id">;
export type ClubField = "name" | "slug" | "city" | "adminNote";
export type ClubResult =
  | { ok: true; data: ClubInput }
  | { ok: false; errors: Partial<Record<ClubField, string>> };

const MAX_NAME = 100;
const MAX_NOTE = 2000;

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

// Admin club form. An empty slug is made from the name. `cities`: the known
// cities (cities.server.ts listCities).
export function parseClub(form: FormData, cities: readonly Pick<City, "slug">[]): ClubResult {
  const name = str(form, "name");
  const slug = (str(form, "slug") || slugify(name)).toLowerCase();
  const city = str(form, "city");
  const adminNote = str(form, "adminNote");

  const errors: Partial<Record<ClubField, string>> = {};
  if (!name) errors.name = "Add meg a klub nevét.";
  else if (name.length > MAX_NAME) errors.name = "Ez a név túl hosszú.";
  if (!isSlug(slug) || slug === OTHER_CLUB)
    errors.slug = "Csak kisbetű, szám és kötőjel lehet benne, legfeljebb 40 karakter.";
  if (!isCity(city, cities)) errors.city = "Válaszd ki a várost.";
  if (adminNote.length > MAX_NOTE) errors.adminNote = `Legfeljebb ${MAX_NOTE} karakter.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      slug,
      city,
      adminNote: adminNote || null,
    },
  };
}

// Signups per value, e.g. countBy(rows, "ref") -> { "gyor-padel": 3, "": 10 };
// "" is no value.
export function countBy<K extends string>(
  rows: Partial<Record<K, string | null>>[],
  key: K,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const value = r[key] ?? "";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

// How the admin shows a signup's source: the club name for a club ref.
export function refLabel(ref: string | null, clubs: Pick<Club, "slug" | "name">[]): string {
  if (!ref) return "";
  return clubs.find((c) => c.slug === ref)?.name ?? ref;
}

// How the admin shows where a signup plays most.
export function homeClubLabel(homeClub: string | null, clubs: Pick<Club, "slug" | "name">[]): string {
  if (!homeClub) return "";
  if (homeClub === OTHER_CLUB) return "Máshol / vegyesen";
  return clubs.find((c) => c.slug === homeClub)?.name ?? homeClub;
}
