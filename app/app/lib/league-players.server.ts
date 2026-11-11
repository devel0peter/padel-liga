import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

import { db } from "~/db/client.server";
import { pairs, partnerSearches, users } from "~/db/schema";

import type { Recipient } from "./email/audience";
import { memberOf } from "./league-members.server";
import { createPair } from "./pairs.server";
import { leagueSeekers, pairSeekers } from "./partner-search.server";
import { filterPlayers, PLAYERS_FILTERS, type LeaguePlayerRow, type PlayersQuery } from "./league-players";
import { formatPhone } from "./phone";
import { entryChip, missingChips } from "./player-status";
import { playerStatuses } from "./player-status.server";

// Játékosok's rows in D1 (#301, D155): the league's registered players (D128),
// each once, by name. Names, levels and phone numbers on the page (D126); the
// addresses are read only for the broadcast page ("Levél nekik").

export async function leaguePlayerRows(league: { id: number }, now = new Date()): Promise<LeaguePlayerRow[]> {
  const [members, active, seeking, statuses] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, level: users.level, phone: users.phone })
      .from(users)
      .where(and(isNotNull(users.consentAt), isNull(users.deletedAt), memberOf(league.id, users.id)))
      .orderBy(asc(users.name), asc(users.id)),
    db
      .select({ id: pairs.id, a: pairs.playerA, b: pairs.playerB })
      .from(pairs)
      .where(and(eq(pairs.leagueId, league.id), eq(pairs.status, "active"))),
    // "Párt keres": the switch on and no pair in the league (D59).
    leagueSeekers(league),
    playerStatuses(now),
  ]);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const pairOf = new Map<string, { id: number; partnerId: string }>();
  for (const p of active) {
    pairOf.set(p.a, { id: p.id, partnerId: p.b });
    pairOf.set(p.b, { id: p.id, partnerId: p.a });
  }
  const seekers = new Set(seeking.map((s) => s.id));
  return (
    members
      .map((m): LeaguePlayerRow => {
        const status = statuses.byId.get(m.id);
        const pair = pairOf.get(m.id);
        const brief = status?.pairs.find((p) => p.leagueId === league.id);
        return {
          id: m.id,
          name: m.name,
          level: m.level,
          phone: formatPhone(m.phone),
          seeking: !pair && seekers.has(m.id),
          pair: pair ? { ...pair, partner: names.get(pair.partnerId) ?? brief?.partner ?? "" } : null,
          entered: brief?.entry?.status === "approved",
          entryChip: brief ? entryChip(brief) : null,
          missing: missingChips(status),
        };
      })
      // By name in Hungarian order (SQLite puts "Ákos" after "Zoltán").
      .sort((a, b) => a.name.localeCompare(b.name, "hu"))
  );
}

// D1 takes at most 100 bound parameters per statement.
const CHUNK = 90;

// The addresses of these accounts, each once, in order; deleted accounts
// (#152) left out.
export async function recipientsOf(ids: readonly string[]): Promise<Recipient[]> {
  const people: Recipient[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const rows = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(and(inArray(users.id, part), isNull(users.deletedAt)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of part) {
      const u = byId.get(id);
      const email = u?.email.toLowerCase();
      if (!u || !email || seen.has(email)) continue;
      seen.add(email);
      people.push({ email, name: u.name });
    }
  }
  return people;
}

// "Levél nekik" from Játékosok: the players the search and filter show.
export async function leaguePlayersAudience(
  league: { id: number; name: string },
  query: PlayersQuery,
): Promise<{ label: string; people: Recipient[] }> {
  const rows = filterPlayers(await leaguePlayerRows(league), query);
  const parts = [`Játékosok, ${league.name}`, query.filter ? PLAYERS_FILTERS[query.filter] : null, query.q ? `„${query.q}”` : null];
  return { label: parts.filter(Boolean).join(" · "), people: await recipientsOf(rows.map((r) => r.id)) };
}

// "Párba teszem" (Játékosok, the profile) and "Pár létrehozása" (Párok):
// createPair, which checks both players and tells them in the app and by
// email (#260). Two players who both switched "Párt keresek" on make a
// "search" pair (D113), as Párkeresők did before #301.
export async function pairUp(actorId: string, league: { id: number; name: string }, a: string, b: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return (await bothSeeking(league.id, a, b)) ? pairSeekers(actorId, league, a, b) : createPair(actorId, league.id, a, b);
}

// Whether both accounts switched "Párt keresek" on in the league.
async function bothSeeking(leagueId: number, a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ userId: partnerSearches.userId })
    .from(partnerSearches)
    .where(
      and(
        eq(partnerSearches.leagueId, leagueId),
        eq(partnerSearches.seeking, true),
        or(eq(partnerSearches.userId, a), eq(partnerSearches.userId, b)),
      ),
    );
  return a !== b && rows.length === 2;
}
