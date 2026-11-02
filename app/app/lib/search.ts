// Free-text search on the admin lists. Case- and accent-insensitive in
// JavaScript, not SQL: SQLite's LIKE ignores case for ASCII only, so "ákos"
// missed "Ákos". Also lets "kovacs" find "Kovács".

export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// Whether any of `values` contains the search term (empty term: everything).
export function matchesSearch(q: string, values: readonly (string | null | undefined)[]): boolean {
  const term = fold(q.trim());
  return !term || values.some((v) => v != null && fold(v).includes(term));
}
