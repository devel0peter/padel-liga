// Játékosok (#301, D155): one row per registered player of the league, with
// pair, "Párt keresek", entry and what's missing. It replaces Párkeresők and
// Párok's rows without a pair; the filters below cover what those showed.
// Pure (no I/O) so every rule is unit tested. The filter and the search live
// in the address (?filter=, ?q=), so a reload or a shared link shows the same
// list.

import { LEVELS } from "./interest";
import type { StatusChip } from "./player-status";
import { matchesSearch } from "./search";

// The options, in the order the page shows them.
export const PLAYERS_FILTERS = {
  no_pair: "Nincs párja",
  seeking: "Párt keres",
  paired: "Van párja",
  entered: "Nevezett",
  not_entered: "Nem nevezett",
  missing: "Hiányzó adat",
} as const;

export type PlayersFilter = keyof typeof PLAYERS_FILTERS;

export type LeaguePlayerRow = {
  id: string;
  name: string;
  level: string | null;
  // Formatted ("+36 30 123 4567"), "" when none: the organizer calls players
  // from here (D126). Never an email address.
  phone: string;
  // "Párt keresek" is on and they have no active pair in the league (D59),
  // and since when (the organizer sees it, as on Párkeresők); null when not.
  seeking: boolean;
  seekingSince: Date | null;
  // The active pair in the league, if any.
  pair: { id: number; partnerId: string; partner: string } | null;
  // The pair's entry in the league's current or next season: approved.
  entered: boolean;
  // "Nevezés (Tél): Elfogadva" or "Nem nevezett (Tél)", or null.
  entryChip: StatusChip | null;
  // "Nincs szintje", "Nincs telefonszáma".
  missing: StatusChip[];
};

type FilterFacts = Pick<LeaguePlayerRow, "seeking" | "pair" | "entered" | "missing">;

// The filters a row is in. Everyone without an approved entry is "Nem
// nevezett", with or without a pair (as Párok's "Nincs a ligában" was).
export function playerFilters(row: FilterFacts): PlayersFilter[] {
  const out: PlayersFilter[] = [row.pair ? "paired" : "no_pair"];
  if (row.seeking && !row.pair) out.push("seeking");
  out.push(row.entered ? "entered" : "not_entered");
  if (row.missing.length > 0) out.push("missing");
  return out;
}

export type PlayersQuery = { filter: PlayersFilter | null; q: string };

export function parsePlayersQuery(params: URLSearchParams): PlayersQuery {
  const filter = params.get("filter");
  return {
    filter: filter && Object.hasOwn(PLAYERS_FILTERS, filter) ? (filter as PlayersFilter) : null,
    q: (params.get("q") ?? "").trim(),
  };
}

// The address of a query: only what is set, so clearing gives the bare page.
export function playersQueryString(query: PlayersQuery): string {
  const params = new URLSearchParams();
  if (query.filter) params.set("filter", query.filter);
  if (query.q) params.set("q", query.q);
  return params.toString();
}

export function isPlayersFiltered(query: PlayersQuery): boolean {
  return query.filter !== null || query.q !== "";
}

const LEVEL_ORDER: string[] = Object.keys(LEVELS);
const levelRank = (level: string | null) => (level && LEVEL_ORDER.includes(level) ? LEVEL_ORDER.indexOf(level) : LEVEL_ORDER.length);

// The rows the search matches (by the player's or the partner's name,
// ignoring case and accents), then the filter's, in the rows' order (by
// name). "Párt keres" lists them as Párkeresők did: by level, then the
// longest waiting first, so two of a level are next to each other.
export function filterPlayers<R extends FilterFacts & { name: string; level: string | null; seekingSince: Date | string | null }>(
  rows: readonly R[],
  query: PlayersQuery,
): R[] {
  const shown = rows.filter(
    (r) => matchesSearch(query.q, [r.name, r.pair?.partner]) && (!query.filter || playerFilters(r).includes(query.filter)),
  );
  if (query.filter !== "seeking") return shown;
  const since = (r: R) => (r.seekingSince ? new Date(r.seekingSince).getTime() : 0);
  return [...shown].sort((a, b) => levelRank(a.level) - levelRank(b.level) || since(a) - since(b) || a.name.localeCompare(b.name, "hu"));
}

// How many rows each option lists with the current search.
export function playersFilterCounts(rows: readonly (FilterFacts & { name: string })[], q: string): Record<PlayersFilter, number> {
  const counts = Object.fromEntries(Object.keys(PLAYERS_FILTERS).map((k) => [k, 0])) as Record<PlayersFilter, number>;
  for (const r of rows) if (matchesSearch(q, [r.name, r.pair?.partner])) for (const f of playerFilters(r)) counts[f]++;
  return counts;
}

// Where the retired pages' addresses go (#301 requirement 5): Párkeresők
// lists the seekers; Párok's "Nincs párja" rows are here now.
export function playersPath(slug: string, query: Partial<PlayersQuery> = {}): string {
  const qs = playersQueryString({ filter: query.filter ?? null, q: query.q ?? "" });
  return `/admin/leagues/${slug}/players${qs ? `?${qs}` : ""}`;
}
