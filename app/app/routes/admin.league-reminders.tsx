import { data, redirect } from "react-router";

import type { Route } from "./+types/admin.league-reminders";
import { requirePermission } from "~/lib/auth/admin.server";
import { getLeague } from "~/lib/leagues.server";
import { setReminders } from "~/lib/reminders.server";
import { SITE_NAME } from "~/lib/site";

// Legacy /reminders route (#436): GET redirects to Beállítások → Emlékeztetők;
// POST action remains functional for compatibility.

export function meta() {
  return [{ title: `Emlékeztetők – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

async function scope(request: Request, slug: string) {
  const league = await getLeague(slug);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league, actor };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league } = await scope(request, params.league);
  return redirect(`/admin/leagues/${league.slug}/settings?tab=reminders`);
}

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor } = await scope(request, params.league);
  const form = await request.formData();
  if (form.get("intent") !== "switch") throw new Response("Ismeretlen művelet.", { status: 400 });
  await setReminders(actor.id, league, form.get("on") === "1");
  return { ok: true };
}

export default function AdminLeagueReminders() {
  return null;
}
