import { and, inArray, isNull } from "drizzle-orm";

import { db } from "~/db/client.server";
import { users } from "~/db/schema";

import type { Recipient } from "./email/audience";
import { filterPairsRows, PAIRS_FILTERS, rowAccounts, type PairsQuery, type PairsRow } from "./league-pairs-view";
import { leaguePairs, pairCandidates, type LeaguePairRow } from "./pairs.server";
import { leagueSeekers } from "./partner-search.server";

// Párok's rows in D1 (#148, D64): every pair of the league, then every
// registered player without an active pair in it, with whether their "Párt
// keresek" switch is on (D59). Names and levels only on the page; the
// addresses are read only for the broadcast page ("Levél nekik").

export type SoloRow = { id: string; name: string; level: string | null; seeking: boolean };
export type LeaguePairsRow = PairsRow<LeaguePairRow, SoloRow>;

export async function leaguePairsRows(league: { id: number; city: string }, now = new Date()): Promise<LeaguePairsRow[]> {
  const [pairList, candidates, seekers] = await Promise.all([leaguePairs(league.id, now), pairCandidates(league.id), leagueSeekers(league)]);
  const seeking = new Set(seekers.map((s) => s.id));
  return [
    ...pairList.map((pair) => ({ kind: "pair" as const, pair })),
    // By name in Hungarian order (SQLite puts "Ákos" after "Zoltán").
    ...[...candidates]
      .sort((a, b) => a.name.localeCompare(b.name, "hu"))
      .map((c) => ({ kind: "solo" as const, player: { ...c, seeking: seeking.has(c.id) } })),
  ];
}

// D1 takes at most 100 bound parameters per statement.
const CHUNK = 90;

// "Levél nekik" from Párok: the players of the rows the search and filter
// show, each address once, with the label the broadcast keeps.
export async function leaguePairsAudience(
  league: { id: number; city: string; name: string },
  query: PairsQuery,
): Promise<{ label: string; people: Recipient[] }> {
  const ids = rowAccounts(filterPairsRows(await leaguePairsRows(league), query));
  const people: Recipient[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      // A deleted account (#152) still has its dissolved pair's row, but no one to write to.
      .where(and(inArray(users.id, ids.slice(i, i + CHUNK)), isNull(users.deletedAt)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids.slice(i, i + CHUNK)) {
      const u = byId.get(id);
      const email = u?.email.toLowerCase();
      if (!u || !email || seen.has(email)) continue;
      seen.add(email);
      people.push({ email, name: u.name });
    }
  }
  const parts = [`Párok, ${league.name}`, query.entry ? PAIRS_FILTERS[query.entry] : null, query.q ? `„${query.q}”` : null];
  return { label: parts.filter(Boolean).join(" · "), people };
}
