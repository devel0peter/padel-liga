import { eq } from "drizzle-orm";
import { data, redirect } from "react-router";

import type { ClubsActionData, ClubsData, ClubsScope } from "~/components/clubs-page";
import { db } from "~/db/client.server";
import { clubs as clubsTable } from "~/db/schema";
import { requirePermission } from "~/lib/auth/admin.server";
import { can } from "~/lib/auth/permissions";
import { CITIES } from "~/lib/cities";
import { countBy, OTHER_CLUB, parseClub } from "~/lib/clubs";
import { createClub, deleteClub, listClubs, slugTaken, updateClub } from "~/lib/clubs.server";
import { getLeague } from "~/lib/leagues.server";
import { listSignups } from "~/lib/signups-admin.server";

// Data and writes behind app/components/clubs-page.tsx. With a league slug:
// that league's city only, for its Szervezők (and the Admin). Without: every
// city, Admin only.

export async function clubsScope(request: Request, leagueSlug?: string): Promise<ClubsScope> {
  if (leagueSlug) {
    const league = await getLeague(leagueSlug);
    if (!league) throw data("Nincs ilyen liga.", { status: 404 });
    const actor = await requirePermission(request, { kind: "clubs.manage", city: league.city });
    return {
      city: league.city,
      cityName: CITIES.find((c) => c.slug === league.city)?.name ?? league.city,
      base: `/admin/leagues/${league.slug}/clubs`,
      canSeeSignups: can(actor, { kind: "signups.manage" }),
      canPrintGeneral: can(actor, { kind: "signups.manage" }),
    };
  }
  await requirePermission(request, { kind: "clubs.manage" });
  return { city: null, cityName: null, base: "/admin/clubs", canSeeSignups: true, canPrintGeneral: true };
}

export async function clubsData(scope: ClubsScope): Promise<ClubsData> {
  const [allClubs, allSignups] = await Promise.all([listClubs(), listSignups()]);
  const inScope = <T extends { city: string }>(rows: T[]) => (scope.city ? rows.filter((r) => r.city === scope.city) : rows);
  const clubs = inScope(allClubs);
  const signups = inScope(allSignups);
  const refs = countBy(signups, "ref");
  const plays = countBy(signups, "homeClub");
  const clubSlugs = new Set(allClubs.map((c) => c.slug));
  // Refs that aren't a club, e.g. a tournament flyer's "?ref=verseny".
  const otherRefs = Object.entries(refs).filter(([ref]) => ref !== "" && !clubSlugs.has(ref));
  return {
    scope,
    clubs,
    refs,
    plays,
    otherRefs,
    noRef: refs[""] ?? 0,
    playsOther: plays[OTHER_CLUB] ?? 0,
    playsUnknown: plays[""] ?? 0,
  };
}

// The club being edited or deleted must be in scope: a Szervező can't touch
// another city's club by posting its id.
async function clubInScope(id: number, scope: ClubsScope): Promise<void> {
  const [club] = await db.select({ city: clubsTable.city }).from(clubsTable).where(eq(clubsTable.id, id));
  if (!club) throw data("Nincs ilyen klub.", { status: 404 });
  if (scope.city && club.city !== scope.city) throw data({ forbidden: true }, { status: 403 });
}

export async function clubsAction(request: Request, scope: ClubsScope): Promise<ClubsActionData | Response> {
  const form = await request.formData();
  const id = Number(form.get("id") || 0);
  if (!Number.isInteger(id) || id < 0) throw new Response("Hibás azonosító.", { status: 400 });
  if (id) await clubInScope(id, scope);
  // A league's page always writes its own city, whatever the form says.
  if (scope.city) form.set("city", scope.city);

  if (form.get("intent") === "delete") {
    await deleteClub(id);
    return redirect(scope.base);
  }

  const result = parseClub(form);
  if (!result.ok) return { errors: result.errors };
  if (await slugTaken(result.data.slug, id || undefined))
    return { errors: { slug: "Ez az azonosító már egy másik klubé." } };
  if (id) await updateClub(id, result.data);
  else await createClub(result.data);
  return redirect(scope.base);
}
