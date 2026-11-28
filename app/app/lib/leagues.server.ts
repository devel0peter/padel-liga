import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { accountInvites, cities, leagueAdminInvites, leagueAdmins, leagues, pairs, users } from "~/db/schema";
import { isSafeAddress } from "~/lib/email/mime";
import { playerLeagues } from "~/lib/league-members.server";

import { auditEntry, auditIfChanged } from "./audit.server";
import type { LeagueRef } from "./auth/permissions";
import type { LeagueInput } from "./leagues";

export async function listLeagues(): Promise<LeagueRef[]> {
  return db
    .select({ id: leagues.id, slug: leagues.slug, city: leagues.city, name: leagues.name })
    .from(leagues)
    .orderBy(asc(leagues.name));
}

/**
 * The league whose table a player's "Tabella" opens (D133, D134): the league
 * of their active pair, else the first of the leagues they belong to (D128);
 * null when they belong to none.
 */
export async function playerLeagueSlug(userId: string): Promise<string | null> {
  const [own] = await db
    .select({ slug: leagues.slug })
    .from(pairs)
    .innerJoin(leagues, eq(leagues.id, pairs.leagueId))
    .where(and(eq(pairs.status, "active"), or(eq(pairs.playerA, userId), eq(pairs.playerB, userId))))
    .orderBy(asc(pairs.id))
    .limit(1);
  if (own) return own.slug;
  return (await playerLeagues(userId))[0]?.slug ?? null;
}

export async function getLeague(slug: string): Promise<LeagueRef | undefined> {
  const [row] = await db
    .select({ id: leagues.id, slug: leagues.slug, city: leagues.city, name: leagues.name })
    .from(leagues)
    .where(eq(leagues.slug, slug));
  return row;
}

// The league's minimum entries for its first season to start (D124), for
// these leagues.
export async function minEntriesByLeague(leagueIds: number[]): Promise<Map<number, number>> {
  if (leagueIds.length === 0) return new Map();
  const rows = await db.select({ id: leagues.id, min: leagues.minEntries }).from(leagues).where(inArray(leagues.id, leagueIds));
  return new Map(rows.map((r) => [r.id, r.min]));
}

export async function leagueSlugTaken(slug: string): Promise<boolean> {
  return !!(await getLeague(slug));
}

export async function createLeague(input: LeagueInput, actorId: string): Promise<void> {
  // The new league's id, by its unique slug, inside the same batch.
  const id = sql`(select ${leagues.id} from ${leagues} where ${leagues.slug} = ${input.slug})`;
  await db.batch([
    db.insert(leagues).values(input),
    auditEntry({ actorId, action: "league.create", target: sql`'league:' || ${id}`, detail: input.name, leagueId: id }),
  ]);
}

export type Organizer = { userId: string; name: string; email: string };
export type PendingOrganizer = { email: string };

export async function organizersByLeague(): Promise<Map<number, { active: Organizer[]; pending: PendingOrganizer[] }>> {
  const [active, pending] = await Promise.all([
    db
      .select({ leagueId: leagueAdmins.leagueId, userId: users.id, name: users.name, email: users.email })
      .from(leagueAdmins)
      .innerJoin(users, eq(users.id, leagueAdmins.userId))
      .orderBy(asc(users.name)),
    db
      .select({ leagueId: leagueAdminInvites.leagueId, email: leagueAdminInvites.email })
      .from(leagueAdminInvites)
      .orderBy(asc(leagueAdminInvites.email)),
  ]);
  const out = new Map<number, { active: Organizer[]; pending: PendingOrganizer[] }>();
  const entry = (id: number) => out.get(id) ?? out.set(id, { active: [], pending: [] }).get(id)!;
  for (const { leagueId, ...o } of active) entry(leagueId).active.push(o);
  for (const { leagueId, email } of pending) entry(leagueId).pending.push({ email });
  return out;
}

export type GrantResult = "granted" | "already" | "invited";

// Makes the account with this email a Szervező of the league. An email
// without an account is invited (an account_invites row, which only exempts
// it from the daily cap on login codes to new addresses, #113), and becomes
// Szervező when its account is created.
export async function grantOrganizer(league: LeagueRef, email: string, actorId: string): Promise<GrantResult> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) {
    const [inserted] = await db.batch([
      db
        .insert(leagueAdmins)
        .values({ leagueId: league.id, userId: user.id, grantedBy: actorId })
        .onConflictDoNothing()
        .returning({ userId: leagueAdmins.userId }),
      auditIfChanged({ actorId, action: "league_admin.grant", target: `user:${user.id}`, leagueId: league.id }),
    ]);
    return inserted.length === 0 ? "already" : "granted";
  }
  // No account yet, so no id to name: the entry names the league only (no
  // email in the log, #225). Accepting the invite logs the grant by id.
  await db.batch([
    db.insert(leagueAdminInvites).values({ leagueId: league.id, email, invitedBy: actorId }).onConflictDoNothing(),
    auditIfChanged({ actorId, action: "league_admin.invite", target: `league:${league.id}`, leagueId: league.id }),
    db.insert(accountInvites).values({ email, note: `Szervező: ${league.name}` }).onConflictDoNothing(),
  ]);
  return "invited";
}

export async function revokeOrganizer(league: LeagueRef, userId: string, actorId: string): Promise<void> {
  await db.batch([
    db.delete(leagueAdmins).where(and(eq(leagueAdmins.leagueId, league.id), eq(leagueAdmins.userId, userId))),
    auditIfChanged({ actorId, action: "league_admin.revoke", target: `user:${userId}`, leagueId: league.id }),
  ]);
}

export async function cancelOrganizerInvite(league: LeagueRef, email: string, actorId: string): Promise<void> {
  await db.batch([
    db.delete(leagueAdminInvites).where(and(eq(leagueAdminInvites.leagueId, league.id), eq(leagueAdminInvites.email, email))),
    auditIfChanged({ actorId, action: "league_admin.invite_cancel", target: `league:${league.id}`, leagueId: league.id }),
  ]);
}

export type LeagueSettings = {
  id: number;
  slug: string;
  city: string;
  name: string;
  minEntries: number;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  localRules: string | null;
  registerLinkSharedAt: Date | null;
  cityListed: boolean;
};

export async function getLeagueSettings(slug: string): Promise<LeagueSettings | undefined> {
  const [row] = await db
    .select({
      id: leagues.id,
      slug: leagues.slug,
      city: leagues.city,
      name: leagues.name,
      minEntries: leagues.minEntries,
      contactName: leagues.contactName,
      contactEmail: leagues.contactEmail,
      contactPhone: leagues.contactPhone,
      localRules: leagues.localRules,
      registerLinkSharedAt: leagues.registerLinkSharedAt,
      cityListed: cities.listed,
    })
    .from(leagues)
    .leftJoin(cities, eq(cities.slug, leagues.city))
    .where(eq(leagues.slug, slug));
  if (!row) return undefined;
  return { ...row, cityListed: !!row.cityListed };
}

// Updates a league's contact person (#384). Required for leagues in a listed
// city. Logged without the contact values.
export async function updateLeagueContact(
  leagueId: number,
  input: { name: string; email: string; phone: string },
  actorId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [league] = await db
    .select({ id: leagues.id, listed: cities.listed })
    .from(leagues)
    .leftJoin(cities, eq(cities.slug, leagues.city))
    .where(eq(leagues.id, leagueId));
  if (!league) return { ok: false, error: "Nincs ilyen liga." };
  const name = input.name.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  if (league.listed && (!name || !email)) return { ok: false, error: "Listázott város ligájánál a kapcsolattartó neve és e-mail-címe kötelező." };
  if (name.length > 100) return { ok: false, error: "A név legfeljebb 100 karakter lehet." };
  if (email && !isSafeAddress(email)) return { ok: false, error: "Adj meg érvényes e-mail-címet." };
  if (phone.length > 40) return { ok: false, error: "A telefonszám túl hosszú." };
  await db.batch([
    db
      .update(leagues)
      .set({ contactName: name || null, contactEmail: email || null, contactPhone: phone || null })
      .where(eq(leagues.id, leagueId)),
    auditEntry({ actorId, action: "league.contact", target: `league:${leagueId}`, leagueId }),
  ]);
  return { ok: true };
}

export const LOCAL_RULES_MAX = 4000;

// Updates a league's local rules supplement (#390).
export async function updateLeagueLocalRules(
  leagueId: number,
  raw: string,
  actorId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (text.length > LOCAL_RULES_MAX) return { ok: false, error: `Legfeljebb ${LOCAL_RULES_MAX} karakter lehet.` };
  await db.batch([
    db.update(leagues).set({ localRules: text || null }).where(eq(leagues.id, leagueId)),
    auditEntry({ actorId, action: "league.local_rules", target: `league:${leagueId}`, leagueId }),
  ]);
  return { ok: true };
}

// Launch checklist tick: organizer shared the registration link (#391).
export async function setRegisterLinkShared(leagueId: number, shared: boolean, actorId: string): Promise<void> {
  await db.batch([
    db
      .update(leagues)
      .set({ registerLinkSharedAt: shared ? new Date() : null })
      .where(eq(leagues.id, leagueId)),
    auditEntry({ actorId, action: "league.register_link_shared", target: `league:${leagueId}`, detail: shared ? "on" : "off", leagueId }),
  ]);
}

// Launch checklist tick: Admin recorded privacy agreement for an organizer (#391).
export async function setPrivacyAgreement(leagueId: number, userId: string, agreed: boolean, actorId: string): Promise<void> {
  await db.batch([
    db
      .update(leagueAdmins)
      .set({ privacyAgreementAt: agreed ? new Date() : null })
      .where(and(eq(leagueAdmins.leagueId, leagueId), eq(leagueAdmins.userId, userId))),
    auditEntry({ actorId, action: "league_admin.privacy_agreement", target: `user:${userId}`, detail: agreed ? "on" : "off", leagueId }),
  ]);
}

export type PublicLeagueSupplement = {
  id: number;
  name: string;
  slug: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  localRules: string | null;
};

// For /rules (#384, #390): logged-in players see their own league(s); visitors
// see all listed leagues with a local supplement or contact.
export async function rulesSupplementsFor(userId: string | null): Promise<{ mine: boolean; leagues: PublicLeagueSupplement[] }> {
  if (userId) {
    const mine = await playerLeagues(userId);
    if (mine.length > 0) {
      const rows = await db
        .select({
          id: leagues.id,
          name: leagues.name,
          slug: leagues.slug,
          contactName: leagues.contactName,
          contactEmail: leagues.contactEmail,
          contactPhone: leagues.contactPhone,
          localRules: leagues.localRules,
        })
        .from(leagues)
        .where(inArray(leagues.id, mine.map((l) => l.id)))
        .orderBy(asc(leagues.name));
      return { mine: true, leagues: rows };
    }
  }
  const rows = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      slug: leagues.slug,
      contactName: leagues.contactName,
      contactEmail: leagues.contactEmail,
      contactPhone: leagues.contactPhone,
      localRules: leagues.localRules,
    })
    .from(leagues)
    .innerJoin(cities, and(eq(cities.slug, leagues.city), eq(cities.listed, true)))
    .orderBy(asc(leagues.name));
  return { mine: false, leagues: rows };
}
