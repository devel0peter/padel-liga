import type { Route } from "./+types/admin.export";
import { requireAdmin } from "~/lib/access.server";
import { homeClubLabel, refLabel } from "~/lib/clubs";
import { listClubs } from "~/lib/clubs.server";
import { filterSignups, parseFilters, toCsv } from "~/lib/signups-admin";
import { listSignups } from "~/lib/signups-admin.server";

// CSV download of the signups, with the same filters as the admin list.
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const filters = parseFilters(new URL(request.url).searchParams);
  const [signups, clubs] = await Promise.all([listSignups(), listClubs()]);
  const rows = filterSignups(signups, filters);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows, { ref: (r) => refLabel(r, clubs), homeClub: (c) => homeClubLabel(c, clubs) }), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jelentkezok-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
