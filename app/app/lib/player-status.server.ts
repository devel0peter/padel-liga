import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { leagues, pairs, seasonEntries, users } from "~/db/schema";

import { homeEntry } from "./season-entries";
import { homeSeasons } from "./seasons";
import { listSeasons } from "./seasons.server";
import type { PlayerStatus } from "./player-status";

// Where each account stands, for the admin tables (Jelentkezők, Felhasználók,
// Párkeresők): first-login page done, the active pair per league and its
// entry in the league's current or next season. Whole tables, joined and
// filtered here, never a long list of ids (D1: at most 100 bound parameters
// per statement); the volumes are small (hundreds of accounts).
//
// Personal data: the result has no email or phone number, only whether a
// phone number was given. The email map's keys stay on the server.

const a = alias(users, "status_player_a");
const b = alias(users, "status_player_b");

export type PlayerStatuses = {
  byId: Map<string, PlayerStatus>;
  // Lowercased email -> status, to match interest signups to accounts.
  byEmail: Map<string, PlayerStatus>;
};

// The entry as the badges need it: season name and status.
const brief = (e: ReturnType<typeof homeEntry>) => (e ? { season: e.season, status: e.status } : null);

export async function playerStatuses(now = new Date()): Promise<PlayerStatuses> {
  const [accounts, active, entries, seasonList] = await Promise.all([
    db
      .select({ id: users.id, email: users.email, consentAt: users.consentAt, level: users.level, phone: users.phone })
      .from(users),
    db
      .select({
        id: pairs.id,
        leagueId: pairs.leagueId,
        league: leagues.name,
        city: leagues.city,
        aId: pairs.playerA,
        aName: a.name,
        bId: pairs.playerB,
        bName: b.name,
      })
      .from(pairs)
      .innerJoin(leagues, eq(leagues.id, pairs.leagueId))
      .innerJoin(a, eq(a.id, pairs.playerA))
      .innerJoin(b, eq(b.id, pairs.playerB))
      .where(eq(pairs.status, "active"))
      .orderBy(asc(leagues.name), asc(pairs.id)),
    db
      .select({ pairId: seasonEntries.pairId, seasonId: seasonEntries.seasonId, status: seasonEntries.status })
      .from(seasonEntries)
      .innerJoin(pairs, eq(pairs.id, seasonEntries.pairId))
      .where(eq(pairs.status, "active")),
    listSeasons(),
  ]);
  const home = homeSeasons(seasonList, now);
  const byId = new Map<string, PlayerStatus>();
  const byEmail = new Map<string, PlayerStatus>();
  for (const u of accounts) {
    const status: PlayerStatus = { registered: !!u.consentAt, level: u.level, phone: !!u.phone, pairs: [] };
    byId.set(u.id, status);
    byEmail.set(u.email.toLowerCase(), status);
  }
  for (const p of active) {
    const seasons = home.filter((s) => s.leagueId === p.leagueId);
    const common = {
      leagueId: p.leagueId,
      league: p.league,
      city: p.city,
      entry: brief(homeEntry(seasons, entries, p.id)),
      season: seasons[0]?.name ?? null,
    };
    byId.get(p.aId)?.pairs.push({ ...common, partner: p.bName });
    byId.get(p.bId)?.pairs.push({ ...common, partner: p.aName });
  }
  return { byId, byEmail };
}
