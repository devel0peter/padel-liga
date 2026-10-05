import { data } from "react-router";

import type { Route } from "./+types/admin.league";
import { AppPage } from "~/components/app-page";
import { requirePermission } from "~/lib/auth/admin.server";
import { CITIES } from "~/lib/cities";
import { getLeague, organizersByLeague } from "~/lib/leagues.server";

// A league's home for its Szervezők. Seasons, pairs and groups come here with
// their own tickets (#22–#24).

export async function loader({ request, params }: Route.LoaderArgs) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  await requirePermission(request, { kind: "league.manage", league: league.slug });
  const organizers = (await organizersByLeague()).get(league.id)?.active ?? [];
  return {
    name: league.name,
    city: CITIES.find((c) => c.slug === league.city)?.name ?? league.city,
    // Names only: co-organizers don't need each other's email here.
    organizers: organizers.map((o) => o.name || "Névtelen"),
  };
}

export default function LeagueOverview({ loaderData }: Route.ComponentProps) {
  return (
    <AppPage title={loaderData.name} description={loaderData.city}>
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">Szervezők</h2>
        <p>{loaderData.organizers.length ? loaderData.organizers.join(", ") : "Még nincs szervezője."}</p>
      </div>
      <p className="max-w-xl rounded-lg border border-dashed p-6 text-muted-foreground">
        A szezonok, a nevezések, a párok és a csoportok itt lesznek, amint elkészülnek.
      </p>
    </AppPage>
  );
}
