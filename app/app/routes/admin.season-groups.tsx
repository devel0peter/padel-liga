import { ArrowDown, ArrowUp, RefreshCw, Send, Sparkles } from "lucide-react";
import { data, Form, Link, useNavigation, useSubmit } from "react-router";

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
  FIRST_PHASE,
  STALE_DRAFT,
  withArticle,
} from "~/lib/groups";
import {
  eligiblePairs,
  generateDraft,
  type GroupPair,
  moveDraftPair,
  phaseGroups,
  phasesWithGroups,
  publishGroups,
  type StoredGroup,
} from "~/lib/groups.server";
import { getLeague } from "~/lib/leagues.server";
import {
  BLOCKER_KINDS,
  DISPUTES_BLOCK,
  LAST_PHASE,
  LEAVE_REASONS,
  movement,
  type Origin,
  originText,
  OUTDATED_DRAFT,
  RECOMPUTE_HINT,
  shownPhase,
  waitingText,
} from "~/lib/round-switch";
import { draftOutdated, generateRoundSwitchDraft, publishRoundSwitch, roundSwitch } from "~/lib/round-switch.server";
import { seasonOfLeague } from "~/lib/season-entries.server";
import { SITE_NAME } from "~/lib/site";

// A season's groups for the league's Szervezők, one round at a time.
// Round 1 (#24, D20-D22): a draft from the entered pairs by Elo, moves
// between groups, then publish, which creates the matches, emails every
// player and locks the groups. Every later round (#35, D107): the cron
// drafts it from the ending round's tables after the deadline (promotion,
// relegation, leavers, new pairs); the organizer sees where each pair comes
// from and who leaves, moves pairs, rebuilds it from the current results,
// and publishes once no disputed result is left. Names and Elo only, no
// contact details.

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

function phaseParam(value: FormDataEntryValue | string | null): number | null {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Only names and ratings leave the server.
function groupView(g: StoredGroup | { number: number; pairs: GroupPair[] }, origins?: Map<number, Origin>) {
  const average = groupAverage(g.pairs);
  return {
    number: g.number,
    average: average === null ? null : formatElo(average),
    warning: sizeWarning(g.pairs.length),
    pairs: g.pairs.map((p) => {
      const origin = origins?.get(p.pairId);
      return {
        id: p.pairId,
        name: pairName(p.players),
        elo: formatElo(p.averageElo),
        active: p.active,
        withdrawn: p.withdrawn,
        withdrawalReason: p.withdrawalReason,
        origin: origin ? { text: originText(origin), move: movement(origin, g.number) } : null,
      };
    }),
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, season } = await scope(request, params);
  const now = new Date();
  const withGroups = await phasesWithGroups(season.id);
  const number = shownPhase(season.phases, withGroups, phaseParam(new URL(request.url).searchParams.get("phase")), now);
  const phase = season.phases.find((p) => p.number === number) ?? null;
  const head = {
    league: { name: league.name, slug: league.slug },
    season: { id: season.id, name: season.name },
    number,
    // Links to every round with groups, and the one shown.
    rounds: [...new Set([...withGroups.map((w) => w.phase), number])].sort((a, b) => a - b),
    phase: phase && { startsAt: phase.startsAt, deadline: phase.deadline },
    lastPhase: number === Math.max(...season.phases.map((p) => p.number)),
  };

  const stored = await phaseGroups(season.id, number);
  const publishedAt = stored.find((g) => g.publishedAt)?.publishedAt ?? null;
  const draft = stored.length > 0 && !publishedAt;
  const players = stored.reduce((n, g) => n + 2 * g.pairs.length, 0);

  if (number === FIRST_PHASE) {
    const eligible = await eligiblePairs(season.id);
    const stale =
      draft &&
      draftIsStale(
        stored.flatMap((g) => g.pairs.map((p) => p.pairId)),
        eligible.map((p) => p.pairId),
      );
    return {
      ...head,
      publishedAt,
      draft,
      stale,
      eligibleCount: eligible.length,
      splitProblem: cannotSplit(eligible.length),
      blocker: draft ? publishBlocker({ sizes: stored.map((g) => g.pairs.length), stale }) : null,
      players,
      groups: stored.map((g) => groupView(g)),
      switch: null,
    };
  }

  // A later round: the switch from the round before it.
  const s = publishedAt ? null : await roundSwitch(season.id, number, now);
  // Outdated: the results or pairs the draft came from have changed.
  const stale = draft && !!s && draftOutdated(stored, s);
  const sizesBlocker = draft ? (stale ? OUTDATED_DRAFT : publishBlocker({ sizes: stored.map((g) => g.pairs.length), stale: false })) : null;
  return {
    ...head,
    publishedAt,
    draft,
    stale,
    eligibleCount: 0,
    splitProblem: null,
    blocker: sizesBlocker ?? (s && s.disputes.length > 0 ? DISPUTES_BLOCK : null),
    players,
    groups: stored.map((g) => groupView(g, s?.origins)),
    switch: s && {
      endingPhase: s.endingPhase,
      state: s.state,
      fast: s.fast,
      leaving: s.leaving.map((l) => ({ id: l.pair.pairId, name: pairName(l.pair.players), reason: LEAVE_REASONS[l.reason] })),
      disputes: s.disputes.map((d) => ({
        matchId: d.matchId,
        kind: BLOCKER_KINDS[d.kind],
        group: d.group,
        names: d.pairs.map((p) => pairName(p.players)).join(" – "),
      })),
    },
  };
}

type ActionData = { error?: string; notice?: string };

export async function action({ request, params }: Route.ActionArgs): Promise<ActionData> {
  const { actor, season } = await scope(request, params);
  const form = await request.formData();
  const intent = form.get("intent");
  const phase = phaseParam(form.get("phase")) ?? FIRST_PHASE;
  if (!season.phases.some((p) => p.number === phase)) throw new Response("Hibás kérés.", { status: 400 });
  if (intent === "generate") {
    if (phase === FIRST_PHASE) {
      const result = await generateDraft(season.id, actor.id);
      return result.ok ? { notice: "Kész a javaslat. Áthelyezhetsz párokat, aztán közzéteheted." } : { error: result.error };
    }
    const result = await generateRoundSwitchDraft(season.id, phase, actor.id);
    return result.ok ? { notice: "Újraszámoltuk a tervezetet a mostani eredményekből." } : { error: result.error };
  }
  if (intent === "move") {
    const pair = Number(form.get("pair") || 0);
    const group = Number(form.get("group") || 0);
    if (!Number.isInteger(pair) || pair <= 0 || !Number.isInteger(group) || group <= 0)
      throw new Response("Hibás kérés.", { status: 400 });
    const result = await moveDraftPair(season.id, pair, group, actor.id, phase);
    return result.ok ? {} : { error: result.error };
  }
  if (intent === "publish") {
    const result = phase === FIRST_PHASE ? await publishGroups(season.id, actor.id) : await publishRoundSwitch(season.id, phase, actor.id);
    return result.ok
      ? { notice: "Közzétetted a csoportokat. A játékosok most kapják meg az e-mailt." }
      : { error: result.error };
  }
  throw new Response("Hibás kérés.", { status: 400 });
}

type LoaderData = Route.ComponentProps["loaderData"];
type Group = LoaderData["groups"][number];

function MovePair({ pair, from, groups, phase }: { pair: Group["pairs"][number]; from: number; groups: Group[]; phase: number }) {
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  return (
    <Select
      value=""
      disabled={busy}
      onValueChange={(group) =>
        submit({ intent: "move", pair: String(pair.id), group, phase: String(phase) }, { method: "post", preventScrollReset: true })
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

function OriginBadge({ origin }: { origin: NonNullable<Group["pairs"][number]["origin"]> }) {
  return (
    <Badge variant={origin.move === "stay" ? "outline" : "secondary"} className="ml-2">
      {origin.move === "up" && <ArrowUp aria-label="feljutott" />}
      {origin.move === "down" && <ArrowDown aria-label="kiesett" />}
      {origin.text}
    </Badge>
  );
}

function GroupCard({ group, groups, editable, phase }: { group: Group; groups: Group[]; editable: boolean; phase: number }) {
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
                    {p.withdrawn && (
                      <Badge variant="outline" className="ml-2">
                        visszalépett
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Elo: {p.elo}
                    {p.origin && <OriginBadge origin={p.origin} />}
                  </span>
                  {p.withdrawalReason && (
                    <span className="text-xs break-words text-muted-foreground">Indok: {p.withdrawalReason}</span>
                  )}
                </div>
                {editable && groups.length > 1 && (
                  <MovePair key={`${p.id}-${group.number}`} pair={p} from={group.number} groups={groups} phase={phase} />
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function PublishDialog({ players, disabled, phase }: { players: number; disabled: boolean; phase: number }) {
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
          <input type="hidden" name="phase" value={phase} />
          <AlertDialogHeader>
            <AlertDialogTitle>Közzéteszed a csoportokat?</AlertDialogTitle>
            <AlertDialogDescription>
              Létrehozzuk a meccseket, és mind a {players} játékos most értesítést kap a csoportjáról, az
              ellenfeleiről és a határidőről (az e-mailt csak az, aki nem kapcsolta ki). Utána a csoportok nem
              módosíthatók.
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

function GenerateButton({ label, variant, phase }: { label: string; variant: "default" | "outline"; phase: number }) {
  const busy = useNavigation().state !== "idle";
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="generate" />
      <input type="hidden" name="phase" value={phase} />
      <Button type="submit" variant={variant} disabled={busy}>
        {variant === "default" ? <Sparkles /> : <RefreshCw />}
        {label}
      </Button>
    </Form>
  );
}

function Actions({ d }: { d: LoaderData }) {
  const busy = useNavigation().state !== "idle";
  if (d.publishedAt) return null;
  const empty = d.groups.length === 0;
  if (d.number === FIRST_PHASE) {
    return empty ? (
      !d.splitProblem && <GenerateButton label="Csoportok javaslata" variant="default" phase={d.number} />
    ) : (
      <>
        <GenerateButton label="Újragenerálás" variant="outline" phase={d.number} />
        <PublishDialog players={d.players} disabled={busy || !!d.blocker} phase={d.number} />
      </>
    );
  }
  if (d.switch?.state !== "ready") return null;
  return empty ? (
    <GenerateButton label="Tervezet készítése" variant="default" phase={d.number} />
  ) : (
    <>
      <GenerateButton label="Tervezet újraszámolása" variant="outline" phase={d.number} />
      <PublishDialog players={d.players} disabled={busy || !!d.blocker} phase={d.number} />
    </>
  );
}

// The ending round's open disputes, which block publishing, and the pairs
// that leave at the switch.
function SwitchPanel({ d }: { d: LoaderData }) {
  const s = d.switch;
  if (!s || d.publishedAt) return null;
  return (
    <div className="grid gap-4">
      {s.disputes.length > 0 && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">{DISPUTES_BLOCK}</p>
          <ul className="mt-2 grid gap-1">
            {s.disputes.map((m) => (
              <li key={m.matchId}>
                <Link to={`/admin/leagues/${d.league.slug}/matches/${m.matchId}/decide`} className="underline underline-offset-2">
                  {m.group}. csoport: {m.names}
                </Link>{" "}
                <span className="text-muted-foreground">({m.kind})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.state === "ready" && d.groups.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {s.fast && <>Gyors körváltás: két 4 páros csoport között 2-2 pár cserél helyet. </>}
          {RECOMPUTE_HINT}
        </p>
      )}
      {s.leaving.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kimaradnak</CardTitle>
            <CardDescription>Ezek a párok {withArticle(s.endingPhase)} kör után nem játszanak tovább.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5">
              {s.leaving.map((l) => (
                <li key={l.id} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{l.name}</span>
                  <span className="text-muted-foreground">{l.reason}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function emptyText(d: LoaderData): string {
  if (d.number === FIRST_PHASE)
    return (
      d.splitProblem ??
      `${d.eligibleCount} nevezett pár van. Kérj javaslatot: Elo szerint osztjuk csoportokba őket, utána áthelyezhetsz párokat.`
    );
  const s = d.switch;
  if (!s) return `${withArticle(d.number - 1).replace(/^a/, "A")} kör csoportjai még nincsenek kint.`;
  if (s.state !== "ready") return waitingText(s.state, s.endingPhase);
  return "Még nincs tervezet. Elkészítheted most a mostani eredményekből.";
}

export default function SeasonGroups({ loaderData: d, actionData }: Route.ComponentProps) {
  const empty = d.groups.length === 0;
  const path = `/admin/leagues/${d.league.slug}/seasons/${d.season.id}/groups`;
  return (
    <AppPage
      title={`Csoportok: ${d.season.name}`}
      description={
        <>
          {d.league.name}: {withArticle(d.number)} kör csoportjai
          {d.phase && (
            <>
              , kezdés {formatDate(new Date(d.phase.startsAt))}, határidő {formatDeadline(new Date(d.phase.deadline))}
            </>
          )}
          .
        </>
      }
      back={{ to: `/admin/leagues/${d.league.slug}/seasons`, label: "Szezonok" }}
      actions={<Actions d={d} />}
    >
      {d.rounds.length > 1 && (
        <nav aria-label="Körök" className="flex flex-wrap gap-2">
          {d.rounds.map((n) => (
            <Button key={n} asChild size="sm" variant={n === d.number ? "secondary" : "outline"}>
              <Link to={`${path}?phase=${n}`} aria-current={n === d.number ? "page" : undefined}>
                {n}. kör
              </Link>
            </Button>
          ))}
        </nav>
      )}
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
          {d.lastPhase && d.number > FIRST_PHASE && <> {LAST_PHASE}</>}
        </p>
      ) : empty ? (
        <p className="py-6 text-center text-muted-foreground">{emptyText(d)}</p>
      ) : (
        d.blocker &&
        d.blocker !== DISPUTES_BLOCK && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm font-medium text-destructive">
            {d.blocker}
            {d.stale && d.blocker === STALE_DRAFT && d.splitProblem && <> {d.splitProblem}</>}
          </p>
        )
      )}

      <SwitchPanel d={d} />

      {!empty && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {d.groups.map((g) => (
            <GroupCard key={g.number} group={g} groups={d.groups} editable={d.draft} phase={d.number} />
          ))}
        </div>
      )}
    </AppPage>
  );
}
