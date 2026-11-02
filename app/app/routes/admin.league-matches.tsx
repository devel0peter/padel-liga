import { ChevronRight, TriangleAlert } from "lucide-react";
import { data, Link, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.league-matches";
import { AppPage } from "~/components/app-page";
import { StatusPill } from "~/components/my-group";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDateTime, formatDeadline } from "~/lib/format";
import { weekRange } from "~/lib/groups";
import { filterMatches, OVERVIEW_STATUSES, parseFilter, STUCK_TEXT } from "~/lib/match-overview";
import { runningPhases, type OverviewMatch } from "~/lib/match-overview.server";
import { getLeague } from "~/lib/leagues.server";
import { groupLine } from "~/lib/matches";
import { SITE_NAME } from "~/lib/site";

// Every match of the league's running phase for its Szervező and the Admin
// (#158, D76): status, last step, who has been active, stuck ones first to
// find. Names only here; phones and the log are on one match's page.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Meccsek – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league: { name: league.name, slug: league.slug }, phases: await runningPhases(league.id) };
}

const ALL = "all";

function Filters({ groups, stuckCount }: { groups: number[]; stuckCount: number }) {
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params);
  const set = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { preventScrollReset: true },
    );
  const any = filter.stuck || filter.group !== null || filter.status !== null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Szűrők">
      <Button
        variant={filter.stuck ? "default" : "outline"}
        size="sm"
        aria-pressed={filter.stuck}
        onClick={() => set("stuck", filter.stuck ? null : "1")}
      >
        <TriangleAlert />
        Elakadtak ({stuckCount})
      </Button>
      <Select value={filter.group === null ? ALL : String(filter.group)} onValueChange={(v) => set("group", v === ALL ? null : v)}>
        <SelectTrigger size="sm" aria-label="Csoport" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Minden csoport</SelectItem>
          {groups.map((g) => (
            <SelectItem key={g} value={String(g)}>
              {g}. csoport
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filter.status ?? ALL} onValueChange={(v) => set("status", v === ALL ? null : v)}>
        <SelectTrigger size="sm" aria-label="Állapot" className="w-full max-w-72 sm:w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Minden állapot</SelectItem>
          {OVERVIEW_STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {any && (
        <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams(), { preventScrollReset: true })}>
          Szűrők törlése
        </Button>
      )}
    </div>
  );
}

function MatchRow({ m, slug }: { m: OverviewMatch; slug: string }) {
  return (
    <li className="grid gap-1.5 rounded-md border p-3 text-sm" aria-label={`${m.names.a} – ${m.names.b}`}>
      <p className="grid font-medium break-words">
        <span>{m.names.a}</span>
        <span className="text-xs font-normal text-muted-foreground">ellen</span>
        <span>{m.names.b}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        <StatusPill label={m.label} tone={m.tone} />
        {m.stuck && <Badge variant="destructive">{STUCK_TEXT[m.stuck]}</Badge>}
      </div>
      <p className="text-muted-foreground">
        {m.lastActivity ? `Utolsó lépés: ${formatDateTime(m.lastActivity)}` : "Még nincs lépés"} · {m.activity}
      </p>
      <Link to={`/admin/leagues/${slug}/matches/${m.id}`} className="inline-flex w-fit items-center gap-1 font-semibold underline">
        Napló és telefonszámok
        <ChevronRight className="size-4" />
      </Link>
    </li>
  );
}

export default function LeagueMatches({ loaderData }: Route.ComponentProps) {
  const { league, phases } = loaderData;
  const [params] = useSearchParams();
  const filter = parseFilter(params);
  const everything = phases.flatMap((p) => p.matches);
  const { shown, stuckCount } = filterMatches(everything, filter);
  const visible = new Set(shown.map((m) => m.id));
  const groupNumbers = [...new Set(phases.flatMap((p) => p.groups))].sort((x, y) => x - y);

  return (
    <AppPage
      title="Meccsek"
      description={
        phases.length === 0
          ? `${league.name}: a futó kör meccsei, állapottal, aktivitással és naplóval.`
          : phases.map((p) => `${p.season}, ${p.phase}. kör · határidő: ${formatDeadline(p.deadline)}`).join(" | ")
      }
    >
      {phases.length === 0 ? (
        <p className="text-muted-foreground">Most nincs futó kör. A meccsek a csoportok közzététele után jelennek meg itt.</p>
      ) : (
        <>
          <Filters groups={groupNumbers} stuckCount={stuckCount} />
          {shown.length === 0 && <p className="text-muted-foreground">Nincs ilyen meccs.</p>}
          {phases.map((p) =>
            p.groups.map((g) => {
              const weeks = [1, 2, 3]
                .map((week) => ({ week, matches: p.matches.filter((m) => m.groupNumber === g && m.week === week && visible.has(m.id)) }))
                .filter((w) => w.matches.length > 0);
              if (weeks.length === 0) return null;
              return (
                <section key={`${p.season}:${p.phase}:${g}`} className="grid max-w-3xl gap-3" aria-label={groupLine(g, p.groupCount)}>
                  <h2 className="font-display text-lg font-bold">{groupLine(g, p.groupCount)}</h2>
                  {weeks.map((w) => (
                    <div key={w.week} className="grid gap-2">
                      <h3 className="text-xs font-semibold text-muted-foreground">
                        {w.week}. hét · {weekRange(p.phaseStartsAt, w.week)}
                      </h3>
                      <ul className="grid gap-2">
                        {w.matches.map((m) => (
                          <MatchRow key={m.id} m={m} slug={league.slug} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              );
            }),
          )}
        </>
      )}
    </AppPage>
  );
}
