import { ChevronRight } from "lucide-react";
import { data, Link } from "react-router";

import type { Route } from "./+types/admin.league-disputes";
import { AppPage } from "~/components/app-page";
import { PairNames } from "~/components/person-link";
import { requirePermission } from "~/lib/auth/admin.server";
import { leagueMatches, type LeagueMatch } from "~/lib/decisions.server";
import { formatDateTime, formatSlot } from "~/lib/format";
import { getLeague } from "~/lib/leagues.server";
import { leagueNoShows } from "~/lib/no-shows.server";
import { article } from "~/lib/results";
import { SITE_NAME } from "~/lib/site";

// Viták (#29): the league's disputed results with both pairs' versions, and
// every match of its published groups, each with a link to decide or
// override it. The league's Szervező and the Admin only. Names only.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Viták – ${SITE_NAME}` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  await requirePermission(request, { kind: "league.manage", league: league.slug });
  const [list, noShows] = await Promise.all([leagueMatches(league.id), leagueNoShows(league.id)]);
  return { league, ...list, noShows };
}

// "X a Y ellen" with each player a link for the Admin (#301).
function Versus({ m }: { m: Pick<LeagueMatch, "b" | "players"> }) {
  return (
    <>
      <PairNames players={m.players.a} /> {article(m.b)} <PairNames players={m.players.b} /> ellen
    </>
  );
}

const where = (m: Pick<LeagueMatch, "season" | "phase" | "groupNumber" | "week">) => `${m.season} · ${m.phase}. kör · ${m.groupNumber}. csoport · ${m.week}. hét`;

export default function LeagueDisputes({ loaderData }: Route.ComponentProps) {
  const { league, disputes, matches, noShows } = loaderData;
  const decide = (id: number) => `/admin/leagues/${league.slug}/matches/${id}/decide`;
  return (
    <AppPage title="Viták" description="Vitatott eredmények, „nem jöttek el” bejelentések, és bármelyik meccs kimenetelének felülbírálása.">
      <section className="grid max-w-3xl gap-3" aria-labelledby="vitatott">
        <h2 id="vitatott" className="font-display text-lg font-bold">
          Vitatott eredmények ({disputes.length})
        </h2>
        {disputes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Most nincs vitatott eredmény.</p>
        ) : (
          <ul className="grid gap-3">
            {disputes.map((d) => (
              <li key={d.id} className="grid gap-1 rounded-lg border p-4 text-sm">
                <p className="text-xs text-muted-foreground">{where(d)}</p>
                <p className="font-medium break-words">
                  <Versus m={d} />
                </p>
                <p className="break-words">
                  <PairNames players={d.players[d.recordedBySide]} /> szerint: <strong>{d.recorded}</strong>
                </p>
                <p className="break-words">
                  <PairNames players={d.players[d.recordedBySide === "a" ? "b" : "a"]} /> szerint:{" "}
                  <strong>{d.counter ?? "nem adott meg eredményt"}</strong> ({formatDateTime(d.disputedAt)})
                </p>
                <p className="text-xs text-muted-foreground">
                  Az eredmények az 1. pár (<PairNames players={d.players.a} />) szemszögéből.
                </p>
                <Link to={decide(d.id)} className="inline-flex w-fit items-center gap-1 font-semibold underline">
                  Döntök
                  <ChevronRight className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid max-w-3xl gap-3" aria-labelledby="nem-jottek-el">
        <h2 id="nem-jottek-el" className="font-display text-lg font-bold">
          Nem jöttek el ({noShows.length})
        </h2>
        {noShows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Most nincs döntésre váró bejelentés.</p>
        ) : (
          <ul className="grid gap-3">
            {noShows.map((n) => (
              <li key={n.id} className="grid gap-1 rounded-lg border p-4 text-sm">
                <p className="text-xs text-muted-foreground">{where(n)}</p>
                <p className="font-medium break-words">
                  <PairNames players={n.reportingPlayers} /> szerint <PairNames players={n.absentPlayers} /> nem jött el
                </p>
                <p className="break-words">
                  {n.slot ? `Időpont: ${formatSlot(n.slot)} · ` : ""}Bejelentve: {formatDateTime(n.reportedAt)}
                </p>
                <Link to={decide(n.matchId)} className="inline-flex w-fit items-center gap-1 font-semibold underline">
                  Döntök
                  <ChevronRight className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid max-w-3xl gap-3" aria-labelledby="minden">
        <h2 id="minden" className="font-display text-lg font-bold">
          Minden meccs
        </h2>
        {matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Még nincs kihirdetett csoport.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Meccsek">
            {matches.map((m) => (
              <li key={m.id} className="grid gap-0.5 rounded-md border p-3 text-sm">
                <p className="text-xs text-muted-foreground">{where(m)}</p>
                <p className="font-medium break-words">
                  <Versus m={m} />
                </p>
                <p className="break-words">{m.label}</p>
                <Link to={decide(m.id)} className="inline-flex w-fit items-center gap-1 underline">
                  Felülbírálom
                  <ChevronRight className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppPage>
  );
}
