import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "~/db/client.server";
import { cities, clubs, groups, leagueAdmins, leagues, seasons, users } from "~/db/schema";

// Launch checklist for a new town's league (#391): shown on Áttekintés in
// phase A (no season yet) and phase B (first season open, round 1 not started)
// and summarized on Admin's /admin/leagues list.

export type ChecklistItem = {
  id:
    | "city_listed"
    | "league_created"
    | "club"
    | "organizer"
    | "contact"
    | "privacy"
    | "local_rules"
    | "first_season"
    | "register_link";
  label: string;
  done: boolean;
  optional?: boolean;
  href: string;
  // Interactive toggles: only Admin can tick privacy, organizer/Admin can tick register_link.
  toggle?: "register_link" | "privacy";
};

export type LeagueLaunchChecklist = {
  visible: boolean;
  missingRequired: number;
  items: ChecklistItem[];
  // Outside organizers needing privacy agreement tick (for Admin UI).
  organizers: { userId: string; name: string; isSuperadmin: boolean; privacyAgreed: boolean }[];
};

export async function leagueLaunchChecklist(leagueId: number): Promise<LeagueLaunchChecklist> {
  const [league] = await db
    .select({
      id: leagues.id,
      slug: leagues.slug,
      city: leagues.city,
      name: leagues.name,
      contactName: leagues.contactName,
      contactEmail: leagues.contactEmail,
      localRules: leagues.localRules,
      minEntries: leagues.minEntries,
      registerLinkSharedAt: leagues.registerLinkSharedAt,
      cityListed: cities.listed,
    })
    .from(leagues)
    .leftJoin(cities, eq(cities.slug, leagues.city))
    .where(eq(leagues.id, leagueId));
  if (!league) return { visible: false, missingRequired: 0, items: [], organizers: [] };

  const [cityClubs, orgRows, leagueSeasons, publishedGroups] = await Promise.all([
    db.select({ id: clubs.id }).from(clubs).where(and(eq(clubs.city, league.city), eq(clubs.active, true))).limit(1),
    db
      .select({
        userId: leagueAdmins.userId,
        privacyAgreementAt: leagueAdmins.privacyAgreementAt,
        name: users.name,
        platformRole: users.platformRole,
      })
      .from(leagueAdmins)
      .innerJoin(users, eq(users.id, leagueAdmins.userId))
      .where(eq(leagueAdmins.leagueId, leagueId)),
    db.select({ id: seasons.id }).from(seasons).where(eq(seasons.leagueId, leagueId)).limit(1),
    db
      .select({ id: groups.id })
      .from(groups)
      .innerJoin(seasons, eq(seasons.id, groups.seasonId))
      .where(and(eq(seasons.leagueId, leagueId), isNotNull(groups.publishedAt)))
      .limit(1),
  ]);

  // Gone once round 1's groups are published / round 1 runs (#391 req 3).
  const visible = publishedGroups.length === 0;
  const base = `/admin/leagues/${league.slug}`;

  const organizers = orgRows.map((o) => ({
    userId: o.userId,
    name: o.name || "Névtelen",
    isSuperadmin: o.platformRole === "superadmin",
    privacyAgreed: o.platformRole === "superadmin" || o.privacyAgreementAt !== null,
  }));
  const outsideOrganizers = organizers.filter((o) => !o.isSuperadmin);
  const privacyDone = outsideOrganizers.length === 0 ? organizers.length > 0 : outsideOrganizers.every((o) => o.privacyAgreed);

  const items: ChecklistItem[] = [
    { id: "city_listed", label: "Város listázva", done: !!league.cityListed, href: "/admin/cities" },
    { id: "league_created", label: "Liga létrehozva", done: true, href: "/admin/leagues" },
    { id: "club", label: "Legalább egy aktív klub", done: cityClubs.length > 0, href: `${base}/settings?tab=clubs` },
    { id: "organizer", label: "Legalább egy Szervező", done: organizers.length > 0, href: "/admin/leagues" },
    {
      id: "contact",
      label: "Liga kapcsolattartó beállítva",
      done: Boolean(league.contactName && league.contactEmail),
      href: `${base}/settings?tab=league`,
    },
    {
      id: "privacy",
      label: "Adatvédelmi megállapodás rögzítve (külsős Szervezőknél)",
      done: privacyDone,
      href: `${base}`,
      toggle: "privacy",
    },
    {
      id: "local_rules",
      label: "Helyi szabályzat-kiegészítés megírva (opcionális)",
      done: Boolean(league.localRules),
      optional: true,
      href: `${base}/settings?tab=league`,
    },
    {
      id: "first_season",
      label: "Első szezon létrehozva a minimum nevezéssel",
      done: leagueSeasons.length > 0 && league.minEntries > 0,
      href: `${base}/seasons`,
    },
    {
      id: "register_link",
      label: "Regisztrációs link megosztva a játékosokkal",
      done: league.registerLinkSharedAt !== null,
      href: `${base}`,
      toggle: "register_link",
    },
  ];

  const missingRequired = visible ? items.filter((i) => !i.optional && !i.done).length : 0;
  return { visible, missingRequired, items, organizers };
}

// Batch summary for Admin's /admin/leagues list (#391 req 2).
export async function missingChecklistByLeague(leagueIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (const id of leagueIds) {
    const c = await leagueLaunchChecklist(id);
    if (c.visible && c.missingRequired > 0) out.set(id, c.missingRequired);
  }
  return out;
}
