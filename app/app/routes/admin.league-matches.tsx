import { data, Link, redirect } from "react-router";

import type { Route } from "./+types/admin.league-matches";
import { Page, PageHeader } from "~/components/blocks";
import { Button } from "~/components/ui/button";
import { requirePermission } from "~/lib/auth/admin.server";
import { getLeague } from "~/lib/leagues.server";
import { runningPhases } from "~/lib/match-overview.server";
import { SITE_NAME } from "~/lib/site";

// Legacy /matches URL (#379): redirects to the running round's page, keeping
// query filters intact. When no round is running, shows a short empty state.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Meccsek – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  await requirePermission(request, { kind: "league.manage", league: league.slug });
  const phases = await runningPhases(league.id);
  const current = phases[0];
  if (current) {
    const url = new URL(request.url);
    const qs = url.searchParams.toString();
    return redirect(`/admin/leagues/${league.slug}/seasons/${current.seasonId}/rounds/${current.phase}${qs ? `?${qs}` : ""}`);
  }
  return { league: { name: league.name, slug: league.slug } };
}

export default function LeagueMatches({ loaderData }: Route.ComponentProps) {
  const { league } = loaderData;
  return (
    <Page>
      <PageHeader eyebrow={league.name} title="Meccsek" />
      <p className="text-sm text-muted-foreground">
        Most nincs futó kör. A meccsek a csoportok közzététele után jelennek meg a kör oldalán.
      </p>
      <div>
        <Button variant="outline" asChild>
          <Link to={`/admin/leagues/${league.slug}/seasons`}>Szezonok megnyitása</Link>
        </Button>
      </div>
    </Page>
  );
}
