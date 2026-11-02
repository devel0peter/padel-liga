import { data } from "react-router";

import type { Route } from "./+types/admin.season-entries";
import { AppPage } from "~/components/app-page";
import { Badge } from "~/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDateTime } from "~/lib/format";
import { getLeague } from "~/lib/leagues.server";
import { fromPhase } from "~/lib/season-entries";
import { listSeasonEntries, seasonOfLeague } from "~/lib/season-entries.server";
import { levelLabel } from "~/lib/signups-admin";
import { SITE_NAME } from "~/lib/site";

// A season's entered pairs for the league's Szervezők (#23): an entry counts
// at once, there is nothing to approve (#153, D62). Names and levels only, no
// contact details.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Nevezések – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  await requirePermission(request, { kind: "league.manage", league: league.slug });
  const id = Number(params.season);
  // Another league's season can't be reached through this league's URL.
  const season = Number.isInteger(id) && id > 0 ? await seasonOfLeague(id, league.id) : undefined;
  if (!season) throw data("Nincs ilyen szezon.", { status: 404 });
  return {
    league: { name: league.name, slug: league.slug },
    season: { id: season.id, name: season.name },
    rows: await listSeasonEntries(season.id),
  };
}

export default function SeasonEntries({ loaderData: d }: Route.ComponentProps) {
  return (
    <AppPage
      title={`Nevezések: ${d.season.name}`}
      description={
        <>
          {d.league.name} · {d.rows.length} nevezett pár. A nevezett párok kerülnek a csoportokba.
        </>
      }
      back={{ to: `/admin/leagues/${d.league.slug}/seasons`, label: "Szezonok" }}
    >
      {d.rows.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">Még nincs nevezett pár.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pár</TableHead>
                <TableHead>Szint</TableHead>
                <TableHead>Kezdő Elo (átlag)</TableHead>
                <TableHead>Nevezett</TableHead>
                <TableHead>Kezd</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.players.map((p) => p.name || "Névtelen").join(" – ")}
                    {!r.pairActive && (
                      <Badge variant="outline" className="ml-2">
                        megszűnt
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{r.players.map((p) => (p.level ? levelLabel(p.level) : "–")).join(" / ")}</TableCell>
                  <TableCell>{r.averageElo ?? "–"}</TableCell>
                  <TableCell>{formatDateTime(new Date(r.appliedAt))}</TableCell>
                  <TableCell>{r.joinsPhase === null ? "következő szezon" : fromPhase(r.joinsPhase)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppPage>
  );
}
