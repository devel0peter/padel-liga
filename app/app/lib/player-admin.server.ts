import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { leagueAdmins, leagueMembers, leagues, oauthAccounts, pairs, partnerSearches, seasonEntries, seasons, users } from "~/db/schema";

import { auditEntry } from "./audit.server";
import { roleLabel, type RoleLabel } from "./auth/permissions";
import { leaguePairs, pairCandidates, type LeaguePairRow } from "./pairs.server";
import { changedFields, editDetail, validateAdminProfile, type AdminProfileErrors, type EditableProfile } from "./player-admin";
import { formatPhone } from "./phone";
import { statusChips, type StatusChip } from "./player-status";
import { playerStatuses } from "./player-status.server";
import { hasTakenPartInSeason } from "./profile-level.server";
import { isSeeking } from "./partner-search";
import { setPartnerSearch } from "./partner-search.server";
import { playerLeagues } from "./league-members.server";
import type { EntryStatus } from "./season-entries";
import type { PairSource } from "./pairs";

// The Admin's player profile (/admin/users/:id, #301, D156). Admin only: it
// has the email address and the phone number (never on a public page). An
// anonymized or deleted account (#152) has no profile.

export type ProfileLeague = {
  id: number;
  slug: string;
  name: string;
  // The active pair in the league, with Párok's actions (entry, change,
  // dissolve), or null.
  pair: LeaguePairRow | null;
  // "Párt keresek" (D59), while they have no pair.
  seeking: boolean;
  // Who "Párba teszem" offers: the league's players without a pair (D128).
  candidates: { id: string; name: string; level: string | null }[];
};

export type ProfilePairHistory = {
  id: number;
  league: string;
  partner: { id: string; name: string; deleted: boolean };
  status: "active" | "dissolved";
  source: PairSource;
  createdAt: Date;
  dissolvedAt: Date | null;
  entries: { season: string; status: EntryStatus }[];
};

export type AdminPlayerProfile = {
  id: string;
  name: string;
  email: string;
  // Formatted, "" when none.
  phone: string;
  editable: EditableProfile;
  role: RoleLabel;
  organizes: string[];
  google: boolean;
  registered: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  levelLocked: boolean;
  status: StatusChip[];
  leagues: ProfileLeague[];
  pairs: ProfilePairHistory[];
};

const partner = alias(users, "profile_partner");

export async function adminPlayerProfile(userId: string, now = new Date()): Promise<AdminPlayerProfile | null> {
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt)));
  if (!user) return null;
  const [organized, google, memberships, history, statuses, levelLocked, seeking] = await Promise.all([
    db
      .select({ id: leagues.id, slug: leagues.slug, name: leagues.name, city: leagues.city })
      .from(leagueAdmins)
      .innerJoin(leagues, eq(leagues.id, leagueAdmins.leagueId))
      .where(eq(leagueAdmins.userId, userId)),
    db.select({ userId: oauthAccounts.userId }).from(oauthAccounts).where(eq(oauthAccounts.userId, userId)).limit(1),
    db
      .select({ id: leagues.id, slug: leagues.slug, name: leagues.name })
      .from(leagueMembers)
      .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
      .where(eq(leagueMembers.userId, userId))
      .orderBy(asc(leagues.name)),
    db
      .select({
        id: pairs.id,
        leagueId: pairs.leagueId,
        league: leagues.name,
        partnerId: partner.id,
        partnerName: partner.name,
        partnerDeleted: partner.deletedAt,
        status: pairs.status,
        source: pairs.source,
        createdAt: pairs.createdAt,
        dissolvedAt: pairs.dissolvedAt,
      })
      .from(pairs)
      .innerJoin(leagues, eq(leagues.id, pairs.leagueId))
      .innerJoin(partner, sql`${partner.id} = case when ${pairs.playerA} = ${userId} then ${pairs.playerB} else ${pairs.playerA} end`)
      .where(or(eq(pairs.playerA, userId), eq(pairs.playerB, userId)))
      .orderBy(desc(pairs.createdAt), desc(pairs.id)),
    playerStatuses(now),
    hasTakenPartInSeason(userId),
    db
      .select({ leagueId: partnerSearches.leagueId, seeking: partnerSearches.seeking })
      .from(partnerSearches)
      .where(eq(partnerSearches.userId, userId)),
  ]);
  const pairIds = history.map((p) => p.id);
  const entries =
    pairIds.length === 0
      ? []
      : await db
          .select({ pairId: seasonEntries.pairId, season: seasons.name, status: seasonEntries.status, startsOn: seasons.firstPhaseStart })
          .from(seasonEntries)
          .innerJoin(seasons, eq(seasons.id, seasonEntries.seasonId))
          // A player has a handful of pairs: well under D1's 100 parameters.
          .where(inArray(seasonEntries.pairId, pairIds.slice(0, 90)))
          .orderBy(asc(seasons.firstPhaseStart));

  // Per league: the active pair as Párok shows it (with its actions), or
  // who "Párba teszem" can offer.
  const profileLeagues = await Promise.all(
    memberships.map(async (l): Promise<ProfileLeague> => {
      const hasPair = history.some((p) => p.status === "active" && p.leagueId === l.id);
      const [leaguePairList, free] = await Promise.all([hasPair ? leaguePairs(l.id, now) : [], pairCandidates(l)]);
      const pair = leaguePairList.find((p) => p.status === "active" && p.players.some((x) => x.id === userId)) ?? null;
      return {
        ...l,
        pair,
        seeking: !pair && isSeeking(seeking.find((s) => s.leagueId === l.id)?.seeking),
        candidates: free.map(({ id, name, level }) => ({ id, name, level })).sort((x, y) => x.name.localeCompare(y.name, "hu")),
      };
    }),
  );

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: formatPhone(user.phone),
    editable: { name: user.name, phone: user.phone, level: user.level, sex: user.sex },
    role: roleLabel({ platformRole: user.platformRole, leagues: organized }),
    organizes: organized.map((o) => o.name),
    google: google.length > 0,
    registered: !!user.consentAt,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    levelLocked,
    status: statusChips(statuses.byId.get(user.id), undefined, memberships.length > 1),
    leagues: profileLeagues,
    pairs: history.map((p) => ({
      id: p.id,
      league: p.league,
      partner: { id: p.partnerId, name: p.partnerName, deleted: !!p.partnerDeleted },
      status: p.status,
      source: p.source,
      createdAt: p.createdAt,
      dissolvedAt: p.dissolvedAt,
      entries: entries.filter((e) => e.pairId === p.id).map((e) => ({ season: e.season, status: e.status })),
    })),
  };
}

// "Párt keresek" switched by the Admin on the profile (#301): the player's
// own switch (setPartnerSearch, audited with the Admin as the actor), only
// in a league they joined and while they have no pair in it, as on Párod.
export async function setSeekingByAdmin(actorId: string, userId: string, leagueId: number, seeking: boolean): Promise<boolean> {
  const [user] = await db
    .select({ id: users.id, consentAt: users.consentAt })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  if (!user || !Number.isInteger(leagueId)) return false;
  const [paired] = await db
    .select({ id: pairs.id })
    .from(pairs)
    .where(and(eq(pairs.leagueId, leagueId), eq(pairs.status, "active"), or(eq(pairs.playerA, userId), eq(pairs.playerB, userId))))
    .limit(1);
  if (paired) return false;
  return setPartnerSearch(user, leagueId, seeking, await playerLeagues(userId), actorId);
}

// The Admin saves a player's name, phone, level and sex (#301, D156). One
// audit entry (D91) names the fields that changed, never their values; no
// entry and no write when nothing changed. No email goes out.
export async function updatePlayerByAdmin(
  actorId: string,
  userId: string,
  input: { name: unknown; phone: unknown; level: unknown; sex: unknown },
): Promise<{ ok: true; changed: number } | { ok: false; errors: AdminProfileErrors }> {
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt)));
  if (!user) return { ok: false, errors: { name: "Ez a fiók már nem létezik." } };
  const stored: EditableProfile = { name: user.name, phone: user.phone, level: user.level, sex: user.sex };
  const result = validateAdminProfile(input, stored, await hasTakenPartInSeason(userId));
  if (!result.ok) return result;
  const fields = changedFields(stored, result.value);
  if (fields.length === 0) return { ok: true, changed: 0 };
  await db.batch([
    db
      .update(users)
      .set(result.value)
      .where(and(eq(users.id, userId), isNull(users.deletedAt))),
    auditEntry({ actorId, action: "user.update", target: `user:${userId}`, detail: editDetail(fields) }),
  ]);
  return { ok: true, changed: fields.length };
}
