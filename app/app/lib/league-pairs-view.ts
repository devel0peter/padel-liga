// Párok's rows, search and entry filter (#148, D64). Pure (no I/O) so every
// rule is unit tested. A row is a pair of the league; the players without a
// pair are on Játékosok since #301 (D155). The filter and the search live in
// the address (?entry=, ?q=), so a reload or a shared link shows the same
// list.

import { ENTRY_STATUS_LABELS, type EntryStatus } from "./season-entries";
import { matchesSearch } from "./search";

// The options, in the order the page shows them. "not_in_league" is the
// shortcut: every pair not in the season (no entry that counts).
export const PAIRS_FILTERS = {
  entered: "Nevezett",
  not_entered: "Nem nevezett",
  rejected: "Elutasítva",
  // The same word as the entry badge (ENTRY_STATUS_LABELS, #174).
  withdrawn: ENTRY_STATUS_LABELS.withdrawn,
  dissolved: "Felbontott párok",
  not_in_league: "Nincs a ligában",
} as const;

export type PairsFilter = keyof typeof PAIRS_FILTERS;

export type PairsRow = {
  status: "active" | "dissolved";
  entry: { status: EntryStatus } | null;
  players: readonly { id: string; name: string }[];
};

// The filters a row is in. An active pair's entry is the one in the league's
// current (or next) season (homeEntry). "pending" is left from the approval
// step (#153): such a pair is not in the season, and in no other option.
export function rowFilters(row: PairsRow): PairsFilter[] {
  if (row.status === "dissolved") return ["dissolved"];
  switch (row.entry?.status) {
    case "approved":
      return ["entered"];
    case undefined:
      return ["not_entered", "not_in_league"];
    case "rejected":
      return ["rejected", "not_in_league"];
    case "withdrawn":
      return ["withdrawn", "not_in_league"];
    case "pending":
      return ["not_in_league"];
  }
}

export function rowNames(row: PairsRow): string[] {
  return row.players.map((p) => p.name);
}

export type PairsQuery = { entry: PairsFilter | null; q: string };

export function parsePairsQuery(params: URLSearchParams): PairsQuery {
  const entry = params.get("entry");
  return {
    entry: entry && Object.hasOwn(PAIRS_FILTERS, entry) ? (entry as PairsFilter) : null,
    q: (params.get("q") ?? "").trim(),
  };
}

// "Nincs párja" (?entry=no_pair) from before #301: those players are on
// Játékosok now, where the old address redirects (requirement 5).
export const RETIRED_NO_PAIR = "no_pair";

// The address of a query: only what is set, so clearing gives the bare page.
export function pairsQueryString(query: PairsQuery): string {
  const params = new URLSearchParams();
  if (query.entry) params.set("entry", query.entry);
  if (query.q) params.set("q", query.q);
  return params.toString();
}

export function isFiltered(query: PairsQuery): boolean {
  return query.entry !== null || query.q !== "";
}

// The rows the search matches (by a player's name, ignoring case and
// accents, as on Jelentkezők), then the filter's.
export function filterPairsRows<R extends PairsRow>(rows: readonly R[], query: PairsQuery): R[] {
  return rows.filter((r) => matchesSearch(query.q, rowNames(r)) && (!query.entry || rowFilters(r).includes(query.entry)));
}

// How many rows each option shows with the current search: the count next to
// an option is the number of rows picking it lists.
export function pairsFilterCounts(rows: readonly PairsRow[], q: string): Record<PairsFilter, number> {
  const counts = Object.fromEntries(Object.keys(PAIRS_FILTERS).map((k) => [k, 0])) as Record<PairsFilter, number>;
  for (const r of rows) if (matchesSearch(q, rowNames(r))) for (const f of rowFilters(r)) counts[f]++;
  return counts;
}

// "Levél nekik": the accounts of the rows shown, each once.
export function rowAccounts(rows: readonly PairsRow[]): string[] {
  return [...new Set(rows.flatMap((r) => r.players.map((p) => p.id)))];
}
