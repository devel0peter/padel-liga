import { ArrowDown, ArrowRight, ArrowUp, ChevronRight, RefreshCw, Search, Send, Sparkles, TriangleAlert } from "lucide-react";
import { data, Form, Link, useLocation, useNavigation, useSearchParams, useSubmit } from "react-router";

import type { Route } from "./+types/admin.round";
import { Page, PageHeader, SectionLabel, Segmented, StatusPill as BlockStatusPill } from "~/components/blocks";
import { DeadlineProjectionSection } from "~/components/deadline-projection";
import { StatusPill } from "~/components/my-group";
import { PairNames } from "~/components/person-link";
import { RoundStatusSection } from "~/components/round-status";
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
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { PROJECTION_KINDS, PROJECTION_TITLE, projectionKind, projectionLine, projectionView } from "~/lib/deadline-projection";
import { phaseProjection } from "~/lib/deadline-projection.server";
import { formatDate, formatDateTime, formatDeadline, formatShortDate } from "~/lib/format";
import {
  cannotSplit,
  draftIsStale,
  FIRST_PHASE,
  formatElo,
  groupAverage,
  pairName,
  publishBlocker,
  sizeWarning,
  STALE_DRAFT,
  weekRange,
  withArticle,
} from "~/lib/groups";
import {
  eligiblePairs,
  generateDraft,
  type GroupPair,
  moveDraftPair,
  phaseGroups,
  publishGroups,
  type StoredGroup,
} from "~/lib/groups.server";
import { getLeague } from "~/lib/leagues.server";
import { filterMatches, OVERVIEW_STATUSES, parseFilter, STUCK_TEXT } from "~/lib/match-overview";
import { phaseOverview, type OverviewMatch } from "~/lib/match-overview.server";
import { groupLine } from "~/lib/matches";
import { clubMatchCounts } from "~/lib/organizer-stats.server";
import { article, versusText } from "~/lib/results";
import { LIST_ANCHOR } from "~/lib/round-status";
import {
  BLOCKER_KINDS,
  changeText,
  DISPUTES_BLOCK,
  LEAVE_REASONS,
  type LeaveReason,
  movement,
  NOTHING_TO_DRAFT,
  type Origin,
  originText,
  OUTDATED_DRAFT,
  PREVIEW_TITLE,
  previewText,
  RECOMPUTE_HINT,
  undecidedText,
  waitingText,
} from "~/lib/round-switch";
import { draftOutdated, generateRoundSwitchDraft, publishRoundSwitch, roundSwitch, roundSwitchPreview } from "~/lib/round-switch.server";
import { seasonOfLeague } from "~/lib/season-entries.server";
import { isWaiting, WAITING_NO_GROUPS } from "~/lib/seasons";
import { SITE_NAME } from "~/lib/site";

// Organizer Round page (#377, #437, #378, #401):
// Tabs in URL (?tab=matches|groups|stats): Meccsek, Csoportok, Statisztika.

export function meta({ loaderData }: Route.MetaArgs) {
  const label = loaderData ? `${loaderData.phaseNumber}. kör – ${loaderData.season.name}` : "Kör";
  return [{ title: `${label} – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

type Tab = "matches" | "groups" | "stats";

function parseTab(raw: string | null): Tab {
  if (raw === "groups" || raw === "stats") return raw;
  return "matches";
}

async function scope(request: Request, params: Route.LoaderArgs["params"]) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  const seasonId = Number(params.season);
  const season = Number.isInteger(seasonId) && seasonId > 0 ? await seasonOfLeague(seasonId, league.id) : undefined;
  if (!season) throw data("Nincs ilyen szezon.", { status: 404 });
  const phaseNumber = Number(params.round);
  if (!Number.isInteger(phaseNumber) || phaseNumber < 1 || (!isWaiting(season) && !season.phases.some((p) => p.number === phaseNumber))) {
    throw data("Nincs ilyen kör.", { status: 404 });
  }
  return { league, actor, season, phaseNumber };
}

function groupView(
  g: StoredGroup | { number: number; pairs: GroupPair[] },
  origins?: Map<number, Origin>,
  changes?: Map<number, { leaving: string; partner: string }>,
) {
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
        players: p.players.map((x) => ({ id: x.id, name: x.name })),
        elo: formatElo(p.averageElo),
        active: p.active,
        withdrawn: p.withdrawn,
        withdrawalReason: p.withdrawalReason,
        origin: origin ? { text: originText(origin), move: movement(origin, g.number) } : null,
        change: changeText(changes?.get(p.pairId)),
      };
    }),
  };
}

function withChanges(g: StoredGroup, s: { draft: GroupPair[][]; changes: Map<number, unknown> }): StoredGroup {
  const computed = new Map(s.draft.flat().filter((p) => s.changes.has(p.pairId)).map((p) => [p.pairId, p]));
  return { ...g, pairs: g.pairs.map((p) => computed.get(p.pairId) ?? p) };
}

function leavingView(list: readonly { pair: GroupPair; reason: LeaveReason }[]) {
  return list.map((l) => ({
    id: l.pair.pairId,
    players: l.pair.players.map((x) => ({ id: x.id, name: x.name })),
    reason: LEAVE_REASONS[l.reason],
  }));
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, season, phaseNumber } = await scope(request, params);
  const now = new Date();
  const phase = season.phases.find((p) => p.number === phaseNumber) ?? null;
  const running = phase ? phase.deadline.getTime() >= now.getTime() : false;

  const [overview, stored, clubStats] = await Promise.all([
    phaseOverview(league.id, season.id, phaseNumber, now),
    phaseGroups(season.id, phaseNumber),
    clubMatchCounts(season.id, phaseNumber),
  ]);

  const projection = overview && running ? await phaseProjection(season.id, phaseNumber) : null;
  const decisions = new Map(projection?.matches.map((m) => [m.id, m.decision]) ?? []);

  const publishedAt = stored.find((g) => g.publishedAt)?.publishedAt ?? null;
  const draft = stored.length > 0 && !publishedAt;
  const players = stored.reduce((n, g) => n + 2 * g.pairs.length, 0);

  const previewPhase = publishedAt ? phaseNumber + 1 : stored.length === 0 && phaseNumber > FIRST_PHASE ? phaseNumber : null;
  const p =
    previewPhase && season.phases.some((x) => x.number === previewPhase) ? await roundSwitchPreview(season.id, previewPhase, now) : null;
  const preview = p && {
    nextPhase: p.nextPhase,
    endingPhase: p.endingPhase,
    fast: p.fast,
    undecided: p.undecided,
    groups: p.draft.map((pairs, i) => groupView({ number: i + 1, pairs }, p.origins, p.changes)),
    leaving: leavingView(p.leaving),
  };

  let groupsData: {
    publishedAt: Date | null;
    draft: boolean;
    stale: boolean;
    eligibleCount: number;
    splitProblem: string | null;
    blocker: string | null;
    players: number;
    groups: ReturnType<typeof groupView>[];
    switch: null | {
      endingPhase: number;
      state: "running" | "resolving" | "ready";
      fast: boolean;
      leaving: ReturnType<typeof leavingView>;
      disputes: { matchId: number; kind: string; group: number; names: string }[];
    };
    preview: typeof preview;
  };

  if (phaseNumber === FIRST_PHASE) {
    const eligible = await eligiblePairs(season.id);
    const stale =
      draft &&
      draftIsStale(
        stored.flatMap((g) => g.pairs.map((x) => x.pairId)),
        eligible.map((x) => x.pairId),
      );
    groupsData = {
      publishedAt,
      draft,
      stale,
      eligibleCount: eligible.length,
      splitProblem: cannotSplit(eligible.length),
      blocker: draft ? publishBlocker({ sizes: stored.map((g) => g.pairs.length), stale }) : null,
      players,
      groups: stored.map((g) => groupView(g)),
      switch: null,
      preview,
    };
  } else {
    const s = publishedAt ? null : await roundSwitch(season.id, phaseNumber, now);
    const stale = draft && !!s && draftOutdated(stored, s);
    const sizesBlocker = draft ? (stale ? OUTDATED_DRAFT : publishBlocker({ sizes: stored.map((g) => g.pairs.length), stale: false })) : null;
    groupsData = {
      publishedAt,
      draft,
      stale,
      eligibleCount: 0,
      splitProblem: null,
      blocker: sizesBlocker ?? (s && s.disputes.length > 0 ? DISPUTES_BLOCK : null),
      players,
      groups: stored.map((g) => groupView(draft && s ? withChanges(g, s) : g, s?.origins, s?.changes)),
      switch: s && {
        endingPhase: s.endingPhase,
        state: s.state,
        fast: s.fast,
        leaving: leavingView(s.leaving),
        disputes: s.disputes.map((d) => ({
          matchId: d.matchId,
          kind: BLOCKER_KINDS[d.kind],
          group: d.group,
          names: d.pairs.map((x) => pairName(x.players)).join(" – "),
        })),
      },
      preview,
    };
  }

  return {
    league: { name: league.name, slug: league.slug },
    season: { id: season.id, name: season.name, waiting: isWaiting(season) },
    phaseNumber,
    phase: phase ? { startsAt: phase.startsAt, deadline: phase.deadline } : null,
    running,
    published: !!publishedAt,
    overview: overview
      ? {
          ...overview,
          matches: overview.matches.map((m) => {
            const d = decisions.get(m.id);
            return { ...m, deadline: d ? projectionKind(d) : null, projection: d ? projectionLine(d, m.names, overview.setGames) : null };
          }),
          projection: projection && projectionView(projection),
        }
      : null,
    groupsData,
    clubStats,
  };
}

type ActionData = { error?: string; notice?: string };

export async function action({ request, params }: Route.ActionArgs): Promise<ActionData> {
  const { actor, season, phaseNumber } = await scope(request, params);
  const form = await request.formData();
  const intent = form.get("intent");
  if (isWaiting(season)) return { error: WAITING_NO_GROUPS };
  if (intent === "generate") {
    if (phaseNumber === FIRST_PHASE) {
      const result = await generateDraft(season.id, actor.id);
      return result.ok ? { notice: "Kész a javaslat. Áthelyezhetsz párokat, aztán közzéteheted." } : { error: result.error };
    }
    const result = await generateRoundSwitchDraft(season.id, phaseNumber, actor.id);
    return result.ok ? { notice: "Újraszámoltuk a tervezetet a mostani eredményekből." } : { error: result.error };
  }
  if (intent === "move") {
    const pair = Number(form.get("pair") || 0);
    const group = Number(form.get("group") || 0);
    if (!Number.isInteger(pair) || pair <= 0 || !Number.isInteger(group) || group <= 0) {
      throw new Response("Hibás kérés.", { status: 400 });
    }
    const result = await moveDraftPair(season.id, pair, group, actor.id, phaseNumber);
    return result.ok ? {} : { error: result.error };
  }
  if (intent === "publish") {
    const result =
      phaseNumber === FIRST_PHASE ? await publishGroups(season.id, actor.id) : await publishRoundSwitch(season.id, phaseNumber, actor.id);
    return result.ok ? { notice: "Közzétetted a csoportokat. A játékosok most kapják meg az e-mailt." } : { error: result.error };
  }
  throw new Response("Hibás kérés.", { status: 400 });
}

const ALL = "all";

function MatchFilters({
  groups,
  weeks,
  stuckCount,
  running,
}: {
  groups: number[];
  weeks: number[];
  stuckCount: number;
  running: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params);
  const set = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
        return next;
      },
      { preventScrollReset: true },
    );
  const clearFilters = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams();
        const t = prev.get("tab");
        if (t) next.set("tab", t);
        return next;
      },
      { preventScrollReset: true },
    );
  const any =
    (running && filter.stuck) ||
    filter.group !== null ||
    filter.week !== null ||
    filter.status !== null ||
    (running && filter.deadline != null) ||
    Boolean(filter.q);

  return (
    <div className="grid gap-2" role="group" aria-label="Szűrők">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Játékos keresése"
          placeholder="Játékos neve..."
          value={filter.q ?? ""}
          onChange={(e) => set("q", e.target.value || null)}
          className="pl-8"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {running && (
          <Button
            variant={filter.stuck ? "default" : "outline"}
            size="sm"
            aria-pressed={filter.stuck}
            onClick={() => set("stuck", filter.stuck ? null : "1")}
          >
            <TriangleAlert />
            Elakadtak ({stuckCount})
          </Button>
        )}
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
        <Select value={filter.week === null ? ALL : String(filter.week)} onValueChange={(v) => set("week", v === ALL ? null : v)}>
          <SelectTrigger size="sm" aria-label="Hét" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Minden hét</SelectItem>
            {weeks.map((w) => (
              <SelectItem key={w} value={String(w)}>
                {w}. hét
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filter.status ?? ALL} onValueChange={(v) => set("status", v === ALL ? null : v)}>
          <SelectTrigger size="sm" aria-label="Állapot" className="w-full max-w-64 sm:w-64">
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
        {running && (
          <Select value={filter.deadline ?? ALL} onValueChange={(v) => set("deadline", v === ALL ? null : v)}>
            <SelectTrigger size="sm" aria-label="Ha most lenne a határidő" className="w-full max-w-64 sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Határidő most: mind</SelectItem>
              {PROJECTION_KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  Határidő most: {k.label.toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {any && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Szűrők törlése
          </Button>
        )}
      </div>
    </div>
  );
}

function MatchRow({ m, slug, backUrl }: { m: OverviewMatch & { projection: string | null }; slug: string; backUrl: string }) {
  return (
    <li className="grid gap-1.5 rounded-md border p-3 text-sm" aria-label={`${m.names.a} – ${m.names.b}`}>
      <p className="font-medium break-words">
        {m.players.a.length === 0 || m.players.b.length === 0 ? (
          versusText(m.names.a, m.names.b)
        ) : (
          <>
            <PairNames players={m.players.a} /> {article(m.names.b)} <PairNames players={m.players.b} /> ellen
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <StatusPill label={m.label} tone={m.tone} />
        {m.stuck && <Badge variant="destructive">{STUCK_TEXT[m.stuck]}</Badge>}
      </div>
      <p className="text-muted-foreground">
        {m.lastActivity ? `Utolsó lépés: ${formatDateTime(m.lastActivity)}` : "Még nincs lépés"} · {m.activity}
      </p>
      {m.projection && <p className="text-muted-foreground italic">{m.projection}</p>}
      <Link
        to={`/admin/leagues/${slug}/matches/${m.id}?back=${encodeURIComponent(backUrl)}`}
        className="inline-flex w-fit items-center gap-1 font-semibold underline"
      >
        Meccs megnyitása
        <ChevronRight className="size-4" />
      </Link>
    </li>
  );
}

type GroupItem = Route.ComponentProps["loaderData"]["groupsData"]["groups"][number];

function MovePair({ pair, from, groups }: { pair: GroupItem["pairs"][number]; from: number; groups: GroupItem[] }) {
  const submit = useSubmit();
  const busy = useNavigation().state !== "idle";
  return (
    <Select
      value=""
      disabled={busy}
      onValueChange={(group) => submit({ intent: "move", pair: String(pair.id), group }, { method: "post", preventScrollReset: true })}
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

function OriginBadge({ origin }: { origin: NonNullable<GroupItem["pairs"][number]["origin"]> }) {
  return (
    <Badge variant={origin.move === "stay" ? "outline" : "secondary"} className="ml-2">
      {origin.move === "up" && <ArrowUp aria-label="feljutott" />}
      {origin.move === "down" && <ArrowDown aria-label="kiesett" />}
      {origin.move === "stay" && <ArrowRight aria-label="marad" />}
      {origin.text}
    </Badge>
  );
}

function GroupCard({ group, groups, editable }: { group: GroupItem; groups: GroupItem[]; editable: boolean }) {
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
                    <PairNames players={p.players} />
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
                    {p.change && <span className="ml-2">{p.change}</span>}
                    {p.withdrawalReason && <span className="ml-2">({p.withdrawalReason})</span>}
                  </span>
                </div>
                {editable && groups.length > 1 && <MovePair pair={p} from={group.number} groups={groups} />}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminRound({ loaderData, actionData }: Route.ComponentProps) {
  const { league, season, phaseNumber, phase, running, published, overview, groupsData, clubStats } = loaderData;
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const tab = parseTab(params.get("tab"));
  const busy = useNavigation().state !== "idle";
  const backUrl = `${location.pathname}${location.search}`;

  const setTab = (next: string) => {
    const parsed = parseTab(next);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (parsed === "matches") p.delete("tab");
        else p.set("tab", parsed);
        return p;
      },
      { preventScrollReset: true },
    );
  };

  const statePill = !published ? (
    <BlockStatusPill tone="info">Nem indult</BlockStatusPill>
  ) : running ? (
    <BlockStatusPill tone="success">Fut</BlockStatusPill>
  ) : (
    <BlockStatusPill tone="neutral">Lezárult</BlockStatusPill>
  );

  const filter = parseFilter(params);
  const rawMatches = overview?.matches ?? [];
  const { shown, stuckCount } = filterMatches(rawMatches, running ? filter : { ...filter, stuck: false, deadline: null });
  const visible = new Set(shown.map((m) => m.id));
  const groupNumbers = overview ? [...overview.groups].sort((x, y) => x - y) : [];
  const weekNumbers = [...new Set(rawMatches.map((m) => m.week))].sort((x, y) => x - y);

  return (
    <Page>
      <PageHeader
        eyebrow={`${league.name} · ${season.name}`}
        title={`${phaseNumber}. kör`}
        back={{ to: `/admin/leagues/${league.slug}/seasons/${season.id}`, label: season.name }}
        aside={statePill}
      />
      <p className="text-sm text-muted-foreground">
        {phase
          ? `${formatShortDate(phase.startsAt)} – ${formatShortDate(phase.deadline)} · Határidő: ${formatDeadline(phase.deadline)}`
          : "A szezon még nem indult el."}
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
        label="Kör nézetek"
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "matches", label: "Meccsek" },
          { value: "groups", label: groupsData.draft ? "Csoportok (tervezet)" : "Csoportok" },
          { value: "stats", label: "Statisztika" },
        ]}
      />

      {tab === "matches" && (
        <section id={LIST_ANCHOR} className="grid gap-4">
          {!overview ? (
            <div className="grid gap-3 rounded-lg border p-4 text-sm">
              <p className="text-muted-foreground">A kör csoportjai még nincsenek közzétéve. A meccsek a közzététel után jelennek meg itt.</p>
              <div>
                <Button variant="outline" size="sm" onClick={() => setTab("groups")}>
                  Csoportok megnyitása
                </Button>
              </div>
            </div>
          ) : (
            <>
              <MatchFilters groups={groupNumbers} weeks={weekNumbers} stuckCount={stuckCount} running={running} />
              {shown.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nincs a szűrésnek megfelelő meccs.</p>
              ) : (
                overview.groups.map((g) => {
                  const weeks = [...new Set(rawMatches.map((m) => m.week))]
                    .sort((x, y) => x - y)
                    .map((week) => ({
                      week,
                      matches: rawMatches.filter((m) => m.groupNumber === g && m.week === week && visible.has(m.id)),
                    }))
                    .filter((w) => w.matches.length > 0);
                  if (weeks.length === 0) return null;
                  return (
                    <section key={g} className="grid max-w-3xl gap-3" aria-label={groupLine(g, overview.groupCount)}>
                      <h2 className="font-display text-lg font-bold">{groupLine(g, overview.groupCount)}</h2>
                      {weeks.map((w) => (
                        <div key={w.week} className="grid gap-2">
                          <h3 className="text-xs font-semibold text-muted-foreground">
                            {w.week}. hét · {weekRange(overview.phaseStartsAt, w.week)}
                          </h3>
                          <ul className="grid gap-2">
                            {w.matches.map((m) => (
                              <MatchRow key={m.id} m={m} slug={league.slug} backUrl={backUrl} />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </section>
                  );
                })
              )}
            </>
          )}
        </section>
      )}

      {tab === "groups" && (
        <section className="grid gap-4">
          {season.waiting ? (
            <p className="rounded-md border p-4 text-sm text-muted-foreground">{WAITING_NO_GROUPS}</p>
          ) : (
            <>
              {/* Blockers FIRST (#437): open disputes & no-show reports blocking publish */}
              {groupsData.switch && groupsData.switch.disputes.length > 0 && (
                <Card className="border-destructive/50">
                  <CardHeader>
                    <CardTitle className="font-display text-base font-bold text-destructive">
                      Közzététel előtt rendezendő ({groupsData.switch.disputes.length})
                    </CardTitle>
                    <CardDescription>{DISPUTES_BLOCK}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="grid gap-2 text-sm">
                      {groupsData.switch.disputes.map((d) => (
                        <li key={d.matchId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5">
                          <div>
                            <p className="font-medium">{d.names}</p>
                            <p className="text-xs text-muted-foreground">
                              {d.group}. csoport · {d.kind}
                            </p>
                          </div>
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/admin/leagues/${league.slug}/matches/${d.matchId}?decide=1&back=${encodeURIComponent(backUrl)}`}>
                              Döntés
                            </Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {groupsData.publishedAt && (
                <p className="text-sm text-muted-foreground">
                  Közzétéve: {formatDateTime(groupsData.publishedAt)} · {groupsData.groups.length} csoport · {groupsData.players} játékos. A csoportok már nem módosíthatók.
                </p>
              )}

              {groupsData.stale && (
                <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm font-medium text-destructive">
                  {phaseNumber === FIRST_PHASE ? STALE_DRAFT : OUTDATED_DRAFT} {RECOMPUTE_HINT}
                </p>
              )}

              {/* Draft / Generate / Publish controls */}
              {!groupsData.publishedAt && (
                <div className="grid gap-2">
                  {phaseNumber === FIRST_PHASE && (
                    <p className="text-sm text-muted-foreground">{groupsData.eligibleCount} nevezett pár van.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {phaseNumber === FIRST_PHASE ? (
                      <>
                        {groupsData.splitProblem ? (
                          <p className="text-sm text-muted-foreground">{groupsData.splitProblem}</p>
                        ) : (
                          <Form method="post">
                            <input type="hidden" name="intent" value="generate" />
                            <Button type="submit" variant={groupsData.draft ? "outline" : "default"} disabled={busy}>
                              {groupsData.draft ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
                              {groupsData.draft ? "Újragenerálás" : "Csoportok javaslata"}
                            </Button>
                          </Form>
                        )}
                      </>
                    ) : groupsData.switch && (groupsData.switch.state === "running" || groupsData.switch.state === "resolving") ? (
                      <p className="text-sm text-muted-foreground">{waitingText(groupsData.switch.state, groupsData.switch.endingPhase)}</p>
                    ) : !groupsData.switch ? (
                      <p className="text-sm text-muted-foreground">{NOTHING_TO_DRAFT}</p>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="intent" value="generate" />
                        <Button type="submit" variant={groupsData.draft ? "outline" : "default"} disabled={busy}>
                          {groupsData.draft ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
                          {groupsData.draft ? "Tervezet újraszámolása" : "Tervezet elkészítése"}
                        </Button>
                      </Form>
                    )}

                    {groupsData.draft && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button disabled={busy || Boolean(groupsData.blocker)}>
                            <Send className="size-4" />
                            Közzététel
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Közzéteszed a csoportokat?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Létrejönnek {withArticle(phaseNumber)} kör meccsei, és mind a {groupsData.players} játékos most értesítést kap e-mailben. Utána a csoportok már nem módosíthatók.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Mégse</AlertDialogCancel>
                            <Form method="post">
                              <input type="hidden" name="intent" value="publish" />
                              <AlertDialogAction type="submit" disabled={busy}>
                                Közzététel
                              </AlertDialogAction>
                            </Form>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}

                    {groupsData.blocker && <p className="text-sm text-destructive">{groupsData.blocker}</p>}
                  </div>
                </div>
              )}

              {groupsData.groups.length > 0 && (
                <div className="grid gap-4 md:grid-cols-2">
                  {groupsData.groups.map((g) => (
                    <GroupCard key={g.number} group={g} groups={groupsData.groups} editable={groupsData.draft} />
                  ))}
                </div>
              )}

              {groupsData.switch && groupsData.switch.leaving.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display text-base font-bold">Kimaradó párok</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="grid gap-1.5 text-sm">
                      {groupsData.switch.leaving.map((l) => (
                        <li key={l.id}>
                          <PairNames players={l.players} /> — <span className="text-muted-foreground">{l.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {groupsData.preview && (
                <section className="grid gap-3 pt-4" aria-label={PREVIEW_TITLE}>
                  <SectionLabel>{PREVIEW_TITLE}</SectionLabel>
                  <p className="text-sm text-muted-foreground">
                    {previewText(groupsData.preview.nextPhase, groupsData.preview.endingPhase)}{" "}
                    {groupsData.preview.undecided > 0 && undecidedText(groupsData.preview.undecided)}
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {groupsData.preview.groups.map((g) => (
                      <GroupCard key={g.number} group={g} groups={groupsData.preview!.groups} editable={false} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </section>
      )}

      {tab === "stats" && (
        <section className="grid gap-6">
          {!overview ? (
            <p className="text-sm text-muted-foreground">A kör statisztikája a csoportok közzététele után jelenik meg.</p>
          ) : (
            <>
              {running && (
                <>
                  <RoundStatusSection anchor linked round={overview.round} groupCount={overview.groupCount} title="A kör állása" />
                  {overview.projection && (
                    <DeadlineProjectionSection anchor linked view={overview.projection} deadline={overview.deadline} title={PROJECTION_TITLE} />
                  )}
                </>
              )}

              <div className="grid gap-2">
                <SectionLabel>Helyszínek (lejátszott meccsek)</SectionLabel>
                {clubStats.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ebben a körben még nincs lejátszott meccs.</p>
                ) : (
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Helyszín</TableHead>
                          <TableHead className="text-right tabular-nums">Lejátszott meccsek</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {clubStats.rows.map((row) => (
                          <TableRow key={row.clubId ?? "none"}>
                            <TableCell className="font-medium">{row.clubName}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell className="font-semibold">Összesen</TableCell>
                          <TableCell className="text-right font-bold tabular-nums">{clubStats.grandTotal}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </div>

              {phase && !running && (
                <p className="text-xs text-muted-foreground">
                  Lezárult kör ({formatDate(phase.startsAt)} – {formatDate(phase.deadline)}).
                </p>
              )}
            </>
          )}
        </section>
      )}
    </Page>
  );
}
