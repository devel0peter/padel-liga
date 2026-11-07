import { eq } from "drizzle-orm";
import { data, redirect } from "react-router";

import type { ClubsActionData, ClubsData, ClubsScope } from "~/components/clubs-page";
import { db } from "~/db/client.server";
import { clubs as clubsTable } from "~/db/schema";
import { requirePermission } from "~/lib/auth/admin.server";
import { cityName } from "~/lib/cities";
import { listCities } from "~/lib/cities.server";
import { parseClub } from "~/lib/clubs";
import { createClub, deleteClub, listClubs, setClubActive, slugTaken, updateClub } from "~/lib/clubs.server";
import { getLeague } from "~/lib/leagues.server";

// Data and writes behind app/components/clubs-page.tsx. With a league slug:
// that league's city only, for its Szervezők (and the Admin). Without: every
// city, Admin only.

// The scope plus who is acting, for the audit log (#225); the page gets the
// scope only.
export type ServerClubsScope = ClubsScope & { actorId: string };

export async function clubsScope(request: Request, leagueSlug?: string): Promise<ServerClubsScope> {
  if (leagueSlug) {
    const league = await getLeague(leagueSlug);
    if (!league) throw data("Nincs ilyen liga.", { status: 404 });
    const actor = await requirePermission(request, { kind: "clubs.manage", city: league.city });
    return {
      city: league.city,
      cityName: cityName(league.city, await listCities()),
      base: `/admin/leagues/${league.slug}/clubs`,
      actorId: actor.id,
    };
  }
  const actor = await requirePermission(request, { kind: "clubs.manage" });
  return { city: null, cityName: null, base: "/admin/clubs", actorId: actor.id };
}

export async function clubsData({ actorId: _, ...scope }: ServerClubsScope): Promise<ClubsData> {
  const [allClubs, cities] = await Promise.all([listClubs(), listCities()]);
  return {
    scope,
    cities: cities.map(({ slug, name }) => ({ slug, name })),
    clubs: scope.city ? allClubs.filter((c) => c.city === scope.city) : allClubs,
  };
}

// The club being edited or deleted must be in scope: a Szervező can't touch
// another city's club by posting its id.
async function clubInScope(id: number, scope: ClubsScope): Promise<void> {
  const [club] = await db.select({ city: clubsTable.city }).from(clubsTable).where(eq(clubsTable.id, id));
  if (!club) throw data("Nincs ilyen klub.", { status: 404 });
  if (scope.city && club.city !== scope.city) throw data({ forbidden: true }, { status: 403 });
}

export async function clubsAction(request: Request, scope: ServerClubsScope): Promise<ClubsActionData | Response> {
  const form = await request.formData();
  const id = Number(form.get("id") || 0);
  if (!Number.isInteger(id) || id < 0) throw new Response("Hibás azonosító.", { status: 400 });
  if (id) await clubInScope(id, scope);
  // A league's page always writes its own city, whatever the form says.
  if (scope.city) form.set("city", scope.city);

  if (form.get("intent") === "delete") {
    await deleteClub(id, scope.actorId);
    return redirect(scope.base);
  }

  const intent = form.get("intent");
  if (intent === "deactivate" || intent === "activate") {
    if (!id) throw new Response("Hibás azonosító.", { status: 400 });
    await setClubActive(id, intent === "activate", scope.actorId);
    return redirect(scope.base);
  }

  const result = parseClub(form, await listCities());
  if (!result.ok) return { errors: result.errors };
  if (await slugTaken(result.data.slug, id || undefined))
    return { errors: { slug: "Ez az azonosító már egy másik klubé." } };
  if (id) await updateClub(id, result.data, scope.actorId);
  else await createClub(result.data, scope.actorId);
  return redirect(scope.base);
}
