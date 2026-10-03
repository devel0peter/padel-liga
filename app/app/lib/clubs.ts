// Clubs and signup sources. Pure (no I/O); the D1 access lives in
// clubs.server.ts.
//
// A club's slug is the `?ref=` on its poster QR code, so signups from that
// poster can be counted. Any other ref (e.g. "verseny" for a tournament flyer)
// is kept as typed and shown as is.

import { isCity, type CitySlug } from "./cities";
import { SITE_URL } from "./site";

export type Club = {
  id: number;
  slug: string;
  city: string;
  name: string;
  address: string | null;
  bookingUrl: string | null;
  listed: boolean;
  adminNote: string | null;
};

// What the landing page shows: no admin fields.
export type PublicClub = Pick<Club, "slug" | "name" | "address" | "bookingUrl">;

export function toPublicClub({ slug, name, address, bookingUrl }: Club): PublicClub {
  return { slug, name, address, bookingUrl };
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// Lowercase letters, digits and inner hyphens, at most 40 characters.
export function isSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

// The `?ref=` of a landing page link, or null if missing or malformed.
// Case-insensitive, so a hand-typed "?ref=Klub" still counts.
export function normalizeRef(value: string | null | undefined): string | null {
  const ref = (value ?? "").trim().toLowerCase();
  return isSlug(ref) ? ref : null;
}

// "Győr Padel Klub" -> "gyor-padel-klub"
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function posterUrl(slug: string): string {
  return `${SITE_URL}/?ref=${slug}`;
}

export type ClubInput = Omit<Club, "id">;
export type ClubField = "name" | "slug" | "city" | "address" | "bookingUrl" | "adminNote";
export type ClubResult =
  | { ok: true; data: ClubInput }
  | { ok: false; errors: Partial<Record<ClubField, string>> };

const MAX_NAME = 100;
const MAX_ADDRESS = 200;
const MAX_URL = 500;
const MAX_NOTE = 2000;

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// Admin club form. An empty slug is made from the name.
export function parseClub(form: FormData): ClubResult {
  const name = str(form, "name");
  const slug = (str(form, "slug") || slugify(name)).toLowerCase();
  const city = str(form, "city");
  const address = str(form, "address");
  const bookingUrl = str(form, "bookingUrl");
  const adminNote = str(form, "adminNote");
  const listed = form.get("listed") != null;

  const errors: Partial<Record<ClubField, string>> = {};
  if (!name) errors.name = "Add meg a klub nevét.";
  else if (name.length > MAX_NAME) errors.name = "Ez a név túl hosszú.";
  if (!isSlug(slug))
    errors.slug = "Csak kisbetű, szám és kötőjel lehet benne, legfeljebb 40 karakter.";
  if (!isCity(city)) errors.city = "Válaszd ki a várost.";
  if (address.length > MAX_ADDRESS) errors.address = "Ez a cím túl hosszú.";
  if (bookingUrl && (bookingUrl.length > MAX_URL || !isHttpUrl(bookingUrl)))
    errors.bookingUrl = "Adj meg egy érvényes linket (https://…).";
  if (adminNote.length > MAX_NOTE) errors.adminNote = `Legfeljebb ${MAX_NOTE} karakter.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      slug,
      city: city as CitySlug,
      address: address || null,
      bookingUrl: bookingUrl || null,
      listed,
      adminNote: adminNote || null,
    },
  };
}

// Signups per ref, e.g. { "gyor-padel": 3, "": 10 }; "" is no ref.
export function countByRef(rows: { ref: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.ref ?? ""] = (counts[r.ref ?? ""] ?? 0) + 1;
  return counts;
}

// How the admin shows a signup's source: the club name for a club ref.
export function refLabel(ref: string | null, clubs: Pick<Club, "slug" | "name">[]): string {
  if (!ref) return "";
  return clubs.find((c) => c.slug === ref)?.name ?? ref;
}
