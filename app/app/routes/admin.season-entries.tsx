import { data, redirect } from "react-router";

import type { Route } from "./+types/admin.season-entries";
import { requirePermission } from "~/lib/auth/admin.server";
import { getLeague } from "~/lib/leagues.server";
import { seasonOfLeague } from "~/lib/season-entries.server";
import { SITE_NAME } from "~/lib/site";

// Legacy URL redirected to the Season page's Nevezések tab (#376).

export function meta({}: Route.MetaArgs) {
  return [{ title: `Nevezések – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  await requirePermission(request, { kind: "league.manage", league: league.slug });
  const id = Number(params.season);
  const season = Number.isInteger(id) && id > 0 ? await seasonOfLeague(id, league.id) : undefined;
  if (!season) throw data("Nincs ilyen szezon.", { status: 404 });
  return redirect(`/admin/leagues/${league.slug}/seasons/${season.id}?tab=entries`);
}

export default function SeasonEntries() {
  return null;
}
