// URL-safe identifiers (slugs) for clubs, cities and leagues, and the `?ref=` of
// landing page links. Pure.

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
