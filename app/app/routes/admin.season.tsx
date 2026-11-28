import { CalendarPlus, ChevronRight } from "lucide-react";
import { useState } from "react";
import { data, Form, Link, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.season";
import { ListCard, ListRow, Page, PageHeader, SectionLabel, Segmented, StatTile, StatusPill } from "~/components/blocks";
import { PersonLink } from "~/components/person-link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDate, formatDateTime, formatDeadline, formatShortDate } from "~/lib/format";
import { formatElo, withArticle } from "~/lib/groups";
import { publishedPhases } from "~/lib/groups.server";
import { getLeague } from "~/lib/leagues.server";
import { seasonStats } from "~/lib/organizer-stats.server";
import { extendableRound, extensionOptions, extensionSummary, planExtension } from "~/lib/round-extension";
import { extendRunningRound } from "~/lib/round-extension.server";
import { fromPhase } from "~/lib/season-entries";
import { listSeasonEntries, seasonOfLeague } from "~/lib/season-entries.server";
import { isWaiting } from "~/lib/seasons";
import { getSeason } from "~/lib/seasons.server";
import { levelLabel } from "~/lib/signups-admin";
import { SITE_NAME } from "~/lib/site";

// Season detail page for organizers (#376, #378, #401):
// Tabs in URL (?tab=rounds|entries|stats): Körök, Nevezések, Statisztika.

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.season.name ?? "Szezon"} – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

type Tab = "rounds" | "entries" | "stats";

function parseTab(raw: string | null): Tab {
  if (raw === "entries" || raw === "stats") return raw;
  return "rounds";
}

async function scope(request: Request, params: Route.LoaderArgs["params"]) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  const id = Number(params.season);
  const season = Number.isInteger(id) && id > 0 ? await seasonOfLeague(id, league.id) : undefined;
  if (!season) throw data("Nincs ilyen szezon.", { status: 404 });
  const full = await getSeason(season.id);
  if (!full) throw data("Nincs ilyen szezon.", { status: 404 });
  return { league, actor, season: full };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, season } = await scope(request, params);
  const now = new Date();
  const [entries, stats, published] = await Promise.all([
    listSeasonEntries(season.id),
    seasonStats(league.id, season.id),
    publishedPhases(),
  ]);
  const pubSet = new Set(published.get(season.id) ?? []);
  const roundByPhase = new Map(stats.rounds.map((r) => [r.phase, r]));

  const rounds = season.phases.map((p) => {
    const isPublished = pubSet.has(p.number);
    const stat = roundByPhase.get(p.number);
    const state: "not_started" | "running" | "finished" = !isPublished
      ? "not_started"
      : p.deadline.getTime() >= now.getTime()
        ? "running"
        : "finished";
    return {
      number: p.number,
      startsAt: p.startsAt,
      deadline: p.deadline,
      state,
      played: stat?.played ?? 0,
      total: stat?.total ?? 0,
    };
  });

  const extRound = extendableRound(season.phases, published.get(season.id) ?? [], now);
  const extension = extRound
    ? {
        phase: extRound.number,
        deadline: extRound.deadline,
        options: extensionOptions(extRound.deadline).map((o) => {
          const plan = planExtension(season, extRound.number, o.day);
          return {
            day: o.day,
            label: `${formatDeadline(plan.phases.find((p) => p.number === extRound.number)!.deadline)} (+${o.weeks} hét)`,
            summary: extensionSummary(extRound.number, extRound.deadline, plan),
          };
        }),
      }
    : null;

  return {
    league: { name: league.name, slug: league.slug },
    season: {
      id: season.id,
      name: season.name,
      waiting: isWaiting(season),
      registrationOpensAt: season.registrationOpensAt,
      registrationClosesAt: season.registrationClosesAt,
    },
    rounds,
    extension,
    entries,
    stats,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { actor, season } = await scope(request, params);
  const form = await request.formData();
  if (form.get("intent") === "extend") {
    const phase = Number(form.get("phase"));
    const result = await extendRunningRound(actor, season.id, phase, form.get("deadline"));
    if (!result.ok) return { error: result.error };
    const updated = await getSeason(season.id);
    const deadline = updated?.phases.find((p) => p.number === phase)?.deadline;
    return {
      notice: `Meghosszabbítottad a kört. Új határidő: ${deadline ? formatDeadline(deadline) : ""}. A játékosok értesítést kapnak.`,
    };
  }
  return { error: "Ismeretlen művelet." };
}

function stateBadge(state: "not_started" | "running" | "finished") {
  if (state === "running") return <StatusPill tone="success">Fut</StatusPill>;
  if (state === "finished") return <StatusPill tone="neutral">Lezárult</StatusPill>;
  return <StatusPill tone="info">Nem indult</StatusPill>;
}

function ExtendDialog({
  extension,
}: {
  extension: NonNullable<Route.ComponentProps["loaderData"]["extension"]>;
}) {
  const [day, setDay] = useState(extension.options[0]!.day);
  const chosen = extension.options.find((o) => o.day === day) ?? extension.options[0]!;
  const busy = useNavigation().state !== "idle";
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarPlus className="size-4" />
          Határidő hosszabbítása
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <Form method="post" className="grid gap-4">
          <input type="hidden" name="intent" value="extend" />
          <input type="hidden" name="phase" value={extension.phase} />
          <AlertDialogHeader>
            <AlertDialogTitle>Meghosszabbítod {withArticle(extension.phase)} kört?</AlertDialogTitle>
            <AlertDialogDescription>
              A kör meccsei az új határidőig játszhatók, a le nem játszottakról csak utána döntünk. A kör minden játékosa értesítést és e-mailt kap az új határidővel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="season-extend-deadline">Új határidő</Label>
            <Select name="deadline" value={day} onValueChange={setDay}>
              <SelectTrigger id="season-extend-deadline" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {extension.options.map((o) => (
                  <SelectItem key={o.day} value={o.day}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1 rounded-md bg-muted/50 p-3 text-sm" aria-live="polite">
            {chosen.summary.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Mégse</AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={busy}>
              Meghosszabbítom
            </AlertDialogAction>
          </AlertDialogFooter>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function AdminSeason({ loaderData, actionData }: Route.ComponentProps) {
  const { league, season, rounds, extension, entries, stats } = loaderData;
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const base = `/admin/leagues/${league.slug}/seasons/${season.id}`;

  const setTab = (next: string) => {
    const parsed = parseTab(next);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (parsed === "rounds") p.delete("tab");
        else p.set("tab", parsed);
        return p;
      },
      { preventScrollReset: true },
    );
  };

  return (
    <Page>
      <PageHeader
        eyebrow={league.name}
        title={season.name}
        back={{ to: `/admin/leagues/${league.slug}/seasons`, label: "Szezonok" }}
      />
      <p className="text-sm text-muted-foreground">
        {season.registrationClosesAt
          ? `Nevezés: ${formatShortDate(season.registrationOpensAt)} – ${formatShortDate(season.registrationClosesAt)}`
          : `Nevezés: ${formatShortDate(season.registrationOpensAt)} óta nyitva`}
      </p>

      {actionData?.notice && (
        <p role="status" className="rounded-md border border-nav-active bg-nav-active-bg p-3 text-sm font-medium">
          {actionData.notice}
        </p>
      )}
      {actionData?.error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {actionData.error}
        </p>
      )}

      <Segmented
        label="Szezon nézetek"
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "rounds", label: "Körök" },
          { value: "entries", label: `Nevezések (${entries.length})` },
          { value: "stats", label: "Statisztika" },
        ]}
      />

      {tab === "rounds" && (
        <section className="grid gap-4">
          {season.waiting ? (
            <p className="rounded-md border p-4 text-sm text-muted-foreground">
              A szezon még a minimum nevezésre vár. Amint összegyűlik a minimum, automatikusan elkészül a 4 kör naptára.
            </p>
          ) : (
            <>
              <ListCard>
                {rounds.map((r) => (
                  <ListRow
                    key={r.number}
                    to={`${base}/rounds/${r.number}`}
                    description={`${formatShortDate(r.startsAt)} – ${formatShortDate(r.deadline)} · Határidő: ${formatDeadline(r.deadline)}`}
                    trailing={
                      <div className="flex items-center gap-2">
                        {r.total > 0 && (
                          <span className="text-xs font-medium text-muted-foreground tabular-nums">
                            {r.played} / {r.total} meccs
                          </span>
                        )}
                        {stateBadge(r.state)}
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </div>
                    }
                  >
                    {r.number}. kör
                  </ListRow>
                ))}
              </ListCard>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`${base}/rounds/${rounds.find((r) => r.state === "running")?.number ?? 1}?tab=groups`}>
                    Csoportok
                  </Link>
                </Button>
                {extension && <ExtendDialog extension={extension} />}
              </div>
            </>
          )}
        </section>
      )}

      {tab === "entries" && (
        <section className="grid gap-3">
          <p className="text-sm text-muted-foreground">{entries.length} nevezett pár. A nevezett párok kerülnek a csoportokba.</p>
          {entries.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">Még nincs nevezett pár.</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pár</TableHead>
                    <TableHead>Szint</TableHead>
                    <TableHead>Elo (átlag)</TableHead>
                    <TableHead>Nevezett</TableHead>
                    <TableHead>Kezd</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.players.map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && " – "}
                            <PersonLink id={p.id} name={p.name || "Névtelen"} />
                          </span>
                        ))}
                        {!r.pairActive && (
                          <Badge variant="outline" className="ml-2">
                            megszűnt
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{r.players.map((p) => (p.level ? levelLabel(p.level) : "–")).join(" / ")}</TableCell>
                      <TableCell>{r.averageElo === null ? "–" : formatElo(r.averageElo)}</TableCell>
                      <TableCell>{formatDateTime(new Date(r.appliedAt))}</TableCell>
                      <TableCell>{r.joinsPhase === null ? "következő szezon" : fromPhase(r.joinsPhase)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {tab === "stats" && (
        <section className="grid gap-6">
          <div className="grid gap-2">
            <SectionLabel>Körök előrehaladása</SectionLabel>
            {stats.rounds.length === 0 ? (
              <p className="text-sm text-muted-foreground">Még nincsenek körök.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {stats.rounds.map((r) => (
                  <StatTile
                    key={r.phase}
                    label={`${r.phase}. kör`}
                    value={r.published ? `${r.played} / ${r.total}` : "–"}
                    deltaCaption={r.published ? "lejátszott meccs" : "még nem indult"}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <SectionLabel>Jelentkezők (játékosok)</SectionLabel>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Nevezett" value={stats.signups.entered} />
              <StatTile label="Nem nevezett" value={stats.signups.notEntered} />
              <StatTile label="Párt keres" value={stats.signups.seeking} />
              <StatTile label="Nincs párja" value={stats.signups.noPair} />
            </div>
          </div>

          <div className="grid gap-2">
            <SectionLabel>Helyszínek (lejátszott meccsek)</SectionLabel>
            {stats.clubs.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Még nincs lejátszott meccs ebben a szezonban.</p>
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Helyszín</TableHead>
                      {stats.clubs.rounds.map((r) => (
                        <TableHead key={r} className="text-right tabular-nums">
                          {r}. kör
                        </TableHead>
                      ))}
                      <TableHead className="text-right tabular-nums">Összesen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.clubs.rows.map((row) => (
                      <TableRow key={row.clubId ?? "none"}>
                        <TableCell className="font-medium">{row.clubName}</TableCell>
                        {stats.clubs.rounds.map((r) => (
                          <TableCell key={r} className="text-right tabular-nums">
                            {row.byRound[r] ?? 0}
                          </TableCell>
                        ))}
                        <TableCell className="text-right font-semibold tabular-nums">{row.total}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Összesen</TableCell>
                      {stats.clubs.rounds.map((r) => (
                        <TableCell key={r} className="text-right font-semibold tabular-nums">
                          {stats.clubs.totalsByRound[r] ?? 0}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-bold tabular-nums">{stats.clubs.grandTotal}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </div>

          {stats.weeklySignups.length > 0 && (
            <div className="grid gap-2">
              <SectionLabel>Heti regisztrációk</SectionLabel>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Hét kezdete</TableHead>
                      <TableHead className="text-right tabular-nums">Új játékosok</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.weeklySignups.map((w) => (
                      <TableRow key={w.weekStart}>
                        <TableCell>{formatDate(new Date(`${w.weekStart}T12:00:00Z`))}</TableCell>
                        <TableCell className="text-right tabular-nums">{w.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </section>
      )}
    </Page>
  );
}
