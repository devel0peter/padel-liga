// Párok's rows, search and entry filter (#148, D64). Pure (no I/O) so every
// rule is unit tested. A row is a pair of the league, or a registered player
// without an active pair in it ("Nincs párja"). The filter and the search
// live in the address (?entry=, ?q=), so a reload or a shared link shows the
// same list.

import { ENTRY_STATUS_LABELS, type EntryStatus } from "./season-entries";
import { matchesSearch } from "./search";

// The options, in the order the page shows them. "not_in_league" is the
// shortcut: everyone not in the season (no pair, or a pair without an entry
// that counts).
export const PAIRS_FILTERS = {
  entered: "Nevezett",
  not_entered: "Nem nevezett",
  rejected: "Elutasítva",
  // The same word as the entry badge (ENTRY_STATUS_LABELS, #174).
  withdrawn: ENTRY_STATUS_LABELS.withdrawn,
  no_pair: "Nincs párja",
  dissolved: "Felbontott párok",
  not_in_league: "Nincs a ligában",
} as const;

export type PairsFilter = keyof typeof PAIRS_FILTERS;

type PairLike = {
  status: "active" | "dissolved";
  entry: { status: EntryStatus } | null;
  players: readonly { id: string; name: string }[];
};
type SoloLike = { id: string; name: string };

export type PairsRow<P extends PairLike = PairLike, S extends SoloLike = SoloLike> =
  | { kind: "pair"; pair: P }
  | { kind: "solo"; player: S };

// The filters a row is in. An active pair's entry is the one in the league's
// current (or next) season (homeEntry). "pending" is left from the approval
// step (#153): such a pair is not in the season, and in no other option.
export function rowFilters(row: PairsRow): PairsFilter[] {
  if (row.kind === "solo") return ["no_pair", "not_in_league"];
  if (row.pair.status === "dissolved") return ["dissolved"];
  switch (row.pair.entry?.status) {
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
  return row.kind === "solo" ? [row.player.name] : row.pair.players.map((p) => p.name);
}

export type PairsQuery = { entry: PairsFilter | null; q: string };

export function parsePairsQuery(params: URLSearchParams): PairsQuery {
  const entry = params.get("entry");
  return {
    entry: entry && Object.hasOwn(PAIRS_FILTERS, entry) ? (entry as PairsFilter) : null,
    q: (params.get("q") ?? "").trim(),
  };
}

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
  const ids = rows.flatMap((r) => (r.kind === "solo" ? [r.player.id] : r.pair.players.map((p) => p.id)));
  return [...new Set(ids)];
}

// The counts table at the top of Párok (#237): per state, the pairs and the
// players in them, over the whole league (no search, no filter), so each
// number is what picking that filter with an empty search lists. "Nincs
// párja" has players only; "Felbontott párok" pairs only (those players are
// counted where they are now). Összesen: the active pairs, and the league's
// players in an active pair or without one, each once.
export const SUMMARY_FILTERS = ["entered", "not_entered", "rejected", "withdrawn", "no_pair", "dissolved"] as const satisfies readonly PairsFilter[];

export type PairsSummaryRow = { filter: (typeof SUMMARY_FILTERS)[number]; pairs: number | null; players: number | null };
export type PairsSummary = { rows: PairsSummaryRow[]; total: { pairs: number; players: number } };

export function pairsSummary(rows: readonly PairsRow[]): PairsSummary {
  const inFilter = (f: PairsFilter) => rows.filter((r) => rowFilters(r).includes(f));
  const out = SUMMARY_FILTERS.map((filter) => {
    const shown = inFilter(filter);
    return {
      filter,
      pairs: filter === "no_pair" ? null : shown.length,
      players: filter === "dissolved" ? null : rowAccounts(shown).length,
    };
  });
  const current = rows.filter((r) => r.kind === "solo" || r.pair.status === "active");
  return {
    rows: out,
    total: { pairs: current.filter((r) => r.kind === "pair").length, players: rowAccounts(current).length },
  };
}
