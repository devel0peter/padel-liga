import type { Route } from "./+types/admin.export";
import { requireAdmin } from "~/lib/access.server";
import { filterSignups, parseFilters, toCsv } from "~/lib/signups-admin";
import { listSignups } from "~/lib/signups-admin.server";

// CSV download of the signups, with the same filters as the admin list.
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const filters = parseFilters(new URL(request.url).searchParams);
  const rows = filterSignups(await listSignups(), filters);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jelentkezok-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
