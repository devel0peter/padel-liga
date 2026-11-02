import type { Route } from "./+types/admin.export";
import { requirePermission } from "~/lib/auth/admin.server";
import { homeClubLabel, refLabel } from "~/lib/clubs";
import { listCities } from "~/lib/cities.server";
import { listClubs } from "~/lib/clubs.server";
import { filterSignups, parseFilters, toCsv } from "~/lib/signups-admin";
import { listSignups } from "~/lib/signups-admin.server";

// CSV download of the signups, with the same filters as the admin list.
export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "signups.manage" });
  const params = new URL(request.url).searchParams;
  // Like the mail (admin.broadcast-new.tsx): not by "Hol tart".
  if (params.has("stage")) throw new Response("A „Hol tart” szűrővel nem tölthetsz le CSV-t.", { status: 400 });
  const filters = parseFilters(params);
  const [signups, clubs, cities] = await Promise.all([listSignups(), listClubs(), listCities()]);
  const rows = filterSignups(signups, filters);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows, { ref: (r) => refLabel(r, clubs), homeClub: (c) => homeClubLabel(c, clubs) }, cities), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jelentkezok-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
