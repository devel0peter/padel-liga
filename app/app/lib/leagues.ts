// Leagues (spec section 4): a city's league, e.g. "Padelpárbaj Győr". Pure
// (no I/O); the database side is leagues.server.ts.

import { isCity, type City } from "./cities";
import { isSlug, slugify } from "./slug";

export type LeagueInput = { city: string; name: string; slug: string };
export type LeagueField = keyof LeagueInput;
export type LeagueResult = { ok: true; data: LeagueInput } | { ok: false; errors: Partial<Record<LeagueField, string>> };

const MAX_NAME = 80;

// The slug is the league's address (/admin/leagues/gyor, later the public
// league pages); empty means "made from the name".
export function parseLeague(form: FormData, cities: readonly Pick<City, "slug">[]): LeagueResult {
  const city = String(form.get("city") ?? "");
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
  const rawSlug = String(form.get("slug") ?? "").trim().toLowerCase();
  const slug = rawSlug || slugify(name);
  const errors: Partial<Record<LeagueField, string>> = {};
  if (!isCity(city, cities)) errors.city = "Válassz várost.";
  if (name.length < 2) errors.name = "Add meg a liga nevét.";
  else if (name.length > MAX_NAME) errors.name = `Legfeljebb ${MAX_NAME} karakter.`;
  if (!isSlug(slug)) errors.slug = "Csak kisbetű, szám és kötőjel, legfeljebb 40 karakter.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data: { city, name, slug } };
}

// /admin/leagues/<slug>/… → the slug, for the sidebar's current league.
export function leagueFromPath(pathname: string): string | null {
  return /^\/admin\/leagues\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

// The same page in another league, for the league switcher:
// /admin/leagues/gyor/clubs → /admin/leagues/debrecen/clubs.
export function switchLeaguePath(pathname: string, slug: string): string {
  const current = leagueFromPath(pathname);
  return current ? pathname.replace(`/admin/leagues/${current}`, `/admin/leagues/${slug}`) : `/admin/leagues/${slug}`;
}
