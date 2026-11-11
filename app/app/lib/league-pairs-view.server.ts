import type { Recipient } from "./email/audience";
import { filterPairsRows, PAIRS_FILTERS, rowAccounts, type PairsQuery } from "./league-pairs-view";
import { recipientsOf } from "./league-players.server";
import { leaguePairs } from "./pairs.server";

// "Levél nekik" from Párok (#148, D64): the players of the pairs the search
// and filter show, each address once, with the label the broadcast keeps.
// The players without a pair are on Játékosok since #301 (D155), with their
// own "Levél nekik".
export async function leaguePairsAudience(
  league: { id: number; name: string },
  query: PairsQuery,
): Promise<{ label: string; people: Recipient[] }> {
  const ids = rowAccounts(filterPairsRows(await leaguePairs(league.id), query));
  const parts = [`Párok, ${league.name}`, query.entry ? PAIRS_FILTERS[query.entry] : null, query.q ? `„${query.q}”` : null];
  return { label: parts.filter(Boolean).join(" · "), people: await recipientsOf(ids) };
}
