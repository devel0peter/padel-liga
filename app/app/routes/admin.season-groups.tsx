import { RefreshCw, Send, Sparkles } from "lucide-react";
import { data, Form, useNavigation, useSubmit } from "react-router";

import type { Route } from "./+types/admin.season-groups";
import { AppPage } from "~/components/app-page";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDate, formatDateTime, formatDeadline } from "~/lib/format";
import {
  cannotSplit,
  draftIsStale,
  formatElo,
  groupAverage,
  pairName,
  publishBlocker,
  sizeWarning,
  STALE_DRAFT,
} from "~/lib/groups";
import { eligiblePairs, FIRST_PHASE, generateDraft, moveDraftPair, phaseGroups, publishGroups } from "~/lib/groups.server";
import { getLeague } from "~/lib/leagues.server";
import { seasonOfLeague } from "~/lib/season-entries.server";
import { SITE_NAME } from "~/lib/site";

// The first phase's groups for the league's Szervezők (#24, D20-D22): a
// draft from the approved pairs by Elo, moves between groups, then publish,
// which creates the matches, emails every player and locks the groups.
// Names and Elo only, no contact details.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Csoportok – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

async function scope(request: Request, params: Route.LoaderArgs["params"]) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  const id = Number(params.season);
  // Another league's season can't be reached through this league's URL.
  const season = Number.isInteger(id) && id > 0 ? await seasonOfLeague(id, league.id) : undefined;
  if (!season) throw data("Nincs ilyen szezon.", { status: 404 });
  return { league, actor, season };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, season } = await scope(request, params);
  const [stored, eligible] = await Promise.all([phaseGroups(season.id), eligiblePairs(season.id)]);
  const publishedAt = stored.find((g) => g.publishedAt)?.publishedAt ?? null;
  const draft = stored.length > 0 && !publishedAt;
  const stale =
    draft &&
    draftIsStale(
      stored.flatMap((g) => g.pairs.map((p) => p.pairId)),
      eligible.map((p) => p.pairId),
    );
  const phase = season.phases.find((p) => p.number === FIRST_PHASE) ?? null;
  return {
    league: { name: league.name, slug: league.slug },
    season: { id: season.id, name: season.name },
    phase: phase && { startsAt: phase.startsAt, deadline: phase.deadline },
    publishedAt,
    draft,
    stale,
    eligibleCount: eligible.length,
    splitProblem: cannotSplit(eligible.length),
    blocker: draft ? publishBlocker({ sizes: stored.map((g) => g.pairs.length), stale }) : null,
    players: stored.reduce((n, g) => n + 2 * g.pairs.length, 0),
    // Only names and ratings leave the server.
    groups: stored.map((g) => {
      const average = groupAverage(g.pairs);
      return {
        number: g.number,
        average: average === null ? null : formatElo(average),
        warning: sizeWarning(g.pairs.length),
        pairs: g.pairs.map((p) => ({ id: p.pairId, name: pairName(p.players), elo: formatElo(p.averageElo), active: p.active })),
      };
    }),
  };
}

type ActionData = { error?: string; notice?: string };

export async function action({ request, params }: Route.ActionArgs): Promise<ActionData> {
  const { actor, season } = await scope(request, params);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "generate") {
    const result = await generateDraft(season.id, actor.id);
    return result.ok ? { notice: "Kész a javaslat. Áthelyezhetsz párokat, aztán közzéteheted." } : { error: result.error };
  }
  if (intent === "move") {
    const pair = Number(form.get("pair") || 0);
    const group = Number(form.get("group") || 0);
    if (!Number.isInteger(pair) || pair <= 0 || !Number.isInteger(group) || group <= 0)
      throw new Response("Hibás kérés.", { status: 400 });
    const result = await moveDraftPair(season.id, pair, group, actor.id);
    return result.ok ? {} : { error: result.error };
  }
  if (intent === "publish") {
    const result = await publishGroups(season.id, actor.id);
    return result.ok
      ? { notice: "Közzétetted a csoportokat. A játékosok e-mailjét az Admin küldi ki." }
      : { error: result.error };
  }
  throw new Response("Hibás kérés.", { status: 400 });
}

type LoaderData = Route.ComponentProps["loaderData"];
type Group = LoaderData["groups"][number];

function MovePair({ pair, from, groups }: { pair: Group["pairs"][number]; from: number; groups: Group[] }) {
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  return (
    <Select
      value=""
      disabled={busy}
      onValueChange={(group) =>
        submit({ intent: "move", pair: String(pair.id), group }, { method: "post", preventScrollReset: true })
      }
    >
      <SelectTrigger size="sm" aria-label={`Áthelyezés: ${pair.name}`} className="w-36">
        <SelectValue placeholder="Áthelyezés" />
      </SelectTrigger>
      <SelectContent>
        {groups
          .filter((g) => g.number !== from)
          .map((g) => (
            <SelectItem key={g.number} value={String(g.number)}>
              {g.number}. csoportba
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

function GroupCard({ group, groups, editable }: { group: Group; groups: Group[]; editable: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg font-bold">{group.number}. csoport</CardTitle>
        <CardDescription>
          {group.pairs.length} pár{group.average !== null && <> · átlag Elo: {group.average}</>}
        </CardDescription>
        {group.warning && (
          <Badge variant="destructive" className="w-fit" role="alert">
            {group.warning}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {group.pairs.length === 0 ? (
          <p className="text-muted-foreground">Üres csoport.</p>
        ) : (
          <ol className="grid gap-3">
            {group.pairs.map((p, i) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="w-5 text-muted-foreground tabular-nums">{i + 1}.</span>
                <div className="grid min-w-0 flex-1 basis-40">
                  <span className="font-medium">
                    {p.name}
                    {!p.active && (
                      <Badge variant="outline" className="ml-2">
                        megszűnt
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">Elo: {p.elo}</span>
                </div>
                {editable && groups.length > 1 && <MovePair key={`${p.id}-${group.number}`} pair={p} from={group.number} groups={groups} />}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function PublishDialog({ players, disabled }: { players: number; disabled: boolean }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={disabled}>
          <Send />
          Közzététel
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <Form method="post" className="grid gap-4">
          <input type="hidden" name="intent" value="publish" />
          <AlertDialogHeader>
            <AlertDialogTitle>Közzéteszed a csoportokat?</AlertDialogTitle>
            <AlertDialogDescription>
              Létrehozzuk a meccseket, és mind a {players} játékosnak e-mail készül a csoportjáról, az ellenfeleiről
              és a határidőről; az Admin küldi ki. Utána a csoportok nem módosíthatók.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Mégse</AlertDialogCancel>
            <AlertDialogAction type="submit">Közzététel</AlertDialogAction>
          </AlertDialogFooter>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function GenerateButton({ label, variant }: { label: string; variant: "default" | "outline" }) {
  const busy = useNavigation().state !== "idle";
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="generate" />
      <Button type="submit" variant={variant} disabled={busy}>
        {variant === "default" ? <Sparkles /> : <RefreshCw />}
        {label}
      </Button>
    </Form>
  );
}

export default function SeasonGroups({ loaderData: d, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const empty = d.groups.length === 0;
  const actions = d.publishedAt ? null : empty ? (
    !d.splitProblem && <GenerateButton label="Csoportok javaslata" variant="default" />
  ) : (
    <>
      <GenerateButton label="Újragenerálás" variant="outline" />
      <PublishDialog players={d.players} disabled={busy || !!d.blocker} />
    </>
  );
  return (
    <AppPage
      title={`Csoportok: ${d.season.name}`}
      description={
        <>
          {d.league.name}: az 1. kör csoportjai
          {d.phase && (
            <>
              , kezdés {formatDate(new Date(d.phase.startsAt))}, határidő {formatDeadline(new Date(d.phase.deadline))}
            </>
          )}
          .
        </>
      }
      back={{ to: `/admin/leagues/${d.league.slug}/seasons`, label: "Szezonok" }}
      actions={actions}
    >
      {actionData?.notice && (
        <p role="status" className="rounded-md border border-nav-active bg-nav-active-bg p-3 text-sm font-medium">
          {actionData.notice}
        </p>
      )}
      {actionData?.error && (
        <p role="alert" className="font-semibold text-destructive">
          {actionData.error}
        </p>
      )}

      {d.publishedAt ? (
        <p className="text-sm text-muted-foreground">
          Közzétéve: {formatDateTime(new Date(d.publishedAt))}. A csoportok már nem módosíthatók.
        </p>
      ) : empty ? (
        <p className="py-6 text-center text-muted-foreground">
          {d.splitProblem ??
            `${d.eligibleCount} jóváhagyott pár van. Kérj javaslatot: Elo szerint osztjuk csoportokba őket, utána áthelyezhetsz párokat.`}
        </p>
      ) : (
        d.blocker && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm font-medium text-destructive">
            {d.blocker}
            {d.stale && d.blocker === STALE_DRAFT && d.splitProblem && <> {d.splitProblem}</>}
          </p>
        )
      )}

      {!empty && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {d.groups.map((g) => (
            <GroupCard key={g.number} group={g} groups={d.groups} editable={d.draft} />
          ))}
        </div>
      )}
    </AppPage>
  );
}
