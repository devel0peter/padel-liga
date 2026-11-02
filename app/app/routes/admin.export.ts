import type { Route } from "./+types/admin.export";
import { requirePermission } from "~/lib/auth/admin.server";
import { homeClubLabel, refLabel } from "~/lib/clubs";
import { listCities } from "~/lib/cities.server";
import { listClubs } from "~/lib/clubs.server";
import { listLeagues } from "~/lib/leagues.server";
import { playerStatuses } from "~/lib/player-status.server";
import { filterByStage, parseStage, progressContext } from "~/lib/signup-progress";
import { filterSignups, parseFilters, toCsv } from "~/lib/signups-admin";
import { listSignups } from "~/lib/signups-admin.server";

// CSV download of the signups, with the same filters as the admin list.
export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "signups.manage" });
  const params = new URL(request.url).searchParams;
  const filters = parseFilters(params);
  const stage = parseStage(params);
  const [signups, clubs, cities, statuses, leagues] = await Promise.all([
    listSignups(),
    listClubs(),
    listCities(),
    playerStatuses(),
    listLeagues(),
  ]);
  // The signups with someone at the "Hol tart" stage, as on the page.
  const rows = filterByStage(filterSignups(signups, filters), stage, progressContext(signups, statuses.byEmail, leagues));
  const date = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows, { ref: (r) => refLabel(r, clubs), homeClub: (c) => homeClubLabel(c, clubs) }, cities), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jelentkezok-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
