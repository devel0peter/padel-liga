import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, Link, useFetcher, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.league-players";
import { Page, PageHeader, SectionLabel, Segmented } from "~/components/blocks";
import { CARD_CELL, CARD_ROW, CardLabel } from "~/components/card-table";
import { ChangeDialog, CreateDialog, DissolveButton, EntryCell } from "~/components/pair-actions";
import { PersonLink } from "~/components/person-link";
import { PhoneLink } from "~/components/phone-link";
import { StatusChips } from "~/components/status-chips";
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
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { requirePermission } from "~/lib/auth/admin.server";
import { can } from "~/lib/auth/permissions";
import { formatDateTime, formatDeadline } from "~/lib/format";
import { formatElo } from "~/lib/groups";
import {
  filterPairsRows,
  isFiltered as isPairsFiltered,
  PAIRS_FILTERS,
  pairsFilterCounts,
  pairsQueryString,
  parsePairsQuery,
  type PairsFilter,
} from "~/lib/league-pairs-view";
import {
  filterPlayers,
  isPlayersFiltered,
  parsePlayersQuery,
  PLAYERS_FILTERS,
  playersFilterCounts,
  playersQueryString,
  type PlayersFilter,
} from "~/lib/league-players";
import { leaguePlayerRows, pairUp } from "~/lib/league-players.server";
import { getLeague } from "~/lib/leagues.server";
import { DISSOLVE_REFUSED, SOURCE_LABELS } from "~/lib/pairs";
import { changePartner, dissolvePair, leaguePairs, pairCandidates } from "~/lib/pairs.server";
import { absenceCountText } from "~/lib/partner-changes";
import { pairAbsenceCounts } from "~/lib/partner-changes.server";
import { missingChips } from "~/lib/player-status";
import { ENTRY_STATUS_LABELS, fromPhase } from "~/lib/season-entries";
import { enterPairByOrganizer, removePairFromSeason, withdrawPairMidPhase } from "~/lib/season-entries.server";
import { currentSeason } from "~/lib/seasons";
import { listSeasons } from "~/lib/seasons.server";
import { levelLabel } from "~/lib/signups-admin";
import { SITE_NAME } from "~/lib/site";
import { CANCEL_REASON_MAX } from "~/lib/strikes";
import { cancelStrike, countsBySeason, leagueStrikes } from "~/lib/strikes.server";
import { cn } from "~/lib/utils";
import { leagueWaitingList, type WaitingPair, type WaitingSingle } from "~/lib/waiting-list.server";

// Játékosok (#435, #380, #381, #387): unified organizer people hub with 4 tabs
// in the URL (?tab=waiting|players|pairs|strikes):
// - Várakozók (first tab): pairs waiting for next round / not entered + singles
// - Játékosok (default when no ?tab): every registered player of the league
// - Párok: active & dissolved pairs (partner changes live on Döntések #434)
// - Fekete pontok: season strikes with organizer cancel
// Names, levels and phones (tap to call); never email addresses.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Játékosok – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

type Tab = "waiting" | "players" | "pairs" | "strikes";

function parseTab(raw: string | null): Tab {
  if (raw === "waiting" || raw === "pairs" || raw === "strikes") return raw;
  return "players";
}

async function scope(request: Request, slug: string) {
  const league = await getLeague(slug);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league, actor };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, actor } = await scope(request, params.league);
  const url = new URL(request.url);
  const tab = parseTab(url.searchParams.get("tab"));
  const playerQuery = parsePlayersQuery(url.searchParams);
  const pairsQuery = parsePairsQuery(url.searchParams);

  const [waiting, allPlayers, allPairs, free, strikeList, seasons, absences] = await Promise.all([
    leagueWaitingList(league.id),
    leaguePlayerRows(league),
    leaguePairs(league.id),
    pairCandidates(league),
    leagueStrikes(league.id),
    listSeasons(league.id),
    pairAbsenceCounts(league.id),
  ]);

  const strikeSeason = currentSeason(seasons, new Date())?.id ?? 0;
  const strikes = strikeList.filter((s) => s.seasonId === strikeSeason);
  const activeStrikesCount = strikes.filter((s) => !s.cancelledAt).length;
  const candidates = free.map(({ id, name, level }) => ({ id, name, level })).sort((x, y) => x.name.localeCompare(y.name, "hu"));

  const playerRows = filterPlayers(allPlayers, playerQuery);
  const playerCounts = playersFilterCounts(allPlayers, playerQuery.q);
  const canAdminBroadcast = can(actor, { kind: "broadcasts.send" });

  return {
    name: league.name,
    slug: league.slug,
    tab,
    canAdminBroadcast,
    canMail: canAdminBroadcast,
    waiting,
    // Játékosok tab (rows/total/counts kept as aliases for existing callers/tests)
    rows: playerRows,
    total: allPlayers.length,
    counts: playerCounts,
    playerRows,
    totalPlayers: allPlayers.length,
    playerCounts,
    playerQuery,
    // Párok tab
    pairRows: filterPairsRows(allPairs, pairsQuery),
    pairCounts: pairsFilterCounts(allPairs, pairsQuery.q),
    pairsQuery,
    activePairsCount: allPairs.filter((r) => r.status === "active").length,
    candidates,
    absenceCounts: Object.fromEntries(absences),
    // Fekete pontok tab
    strikes,
    activeStrikesCount,
    strikeCounts: Object.fromEntries(countsBySeason(strikes).get(strikeSeason) ?? []),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor } = await scope(request, params.league);
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  const intent = field("intent");
  const pairId = Number(field("pair"));
  const seasonId = Number(field("season"));
  const valid = (n: number) => Number.isInteger(n) && n > 0;

  let result: { ok: true } | { ok: false; error: string };
  if (intent === "pair") {
    const [a, b] = form.getAll("user").map(String);
    result = await pairUp(actor.id, league, a ?? "", b ?? "");
  } else if (intent === "create") {
    result = await pairUp(actor.id, league, field("a"), field("b"));
  } else if ((intent === "dissolve" || intent === "change") && valid(pairId)) {
    result =
      intent === "dissolve"
        ? await dissolvePair(actor.id, league.id, pairId)
        : await changePartner(actor.id, league.id, pairId, field("keep"), field("partner"));
  } else if ((intent === "enter" || intent === "remove") && valid(pairId) && valid(seasonId)) {
    result =
      intent === "enter"
        ? await enterPairByOrganizer(actor, league.id, pairId, seasonId)
        : await removePairFromSeason(actor, league.id, pairId, seasonId);
  } else if (intent === "withdraw" && valid(pairId) && valid(seasonId)) {
    result = await withdrawPairMidPhase(actor, league.id, pairId, seasonId, field("reason"));
  } else if (intent === "strike-cancel" && valid(Number(field("strike")))) {
    result = await cancelStrike(actor.id, league.id, Number(field("strike")), field("reason"));
  } else {
    throw new Response("Hibás kérés.", { status: 400 });
  }
  return result.ok ? { ok: true as const } : { error: result.error };
}

type PlayerRowData = Route.ComponentProps["loaderData"]["playerRows"][number];
type PairRowData = Route.ComponentProps["loaderData"]["pairRows"][number];
type Candidate = Route.ComponentProps["loaderData"]["candidates"][number];
type Strike = Route.ComponentProps["loaderData"]["strikes"][number];

function PairButton({ chosen, onDone }: { chosen: { id: string; name: string }[]; onDone: () => void }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const busy = fetcher.state !== "idle";
  const pair = () => {
    const form = new FormData();
    form.set("intent", "pair");
    for (const r of chosen) form.append("user", r.id);
    fetcher.submit(form, { method: "post" });
    onDone();
  };
  return (
    <div className="grid gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button disabled={chosen.length !== 2 || busy}>Párba teszem ({chosen.length}/2)</Button>
        </AlertDialogTrigger>
        {chosen.length === 2 && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {chosen[0]!.name} és {chosen[1]!.name}
              </AlertDialogTitle>
              <AlertDialogDescription>
                Rögtön párban lesznek, és nevezhetnek. Az oldalon és e-mailben is szólunk nekik. A Párok fülön bonthatod fel.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Mégse</AlertDialogCancel>
              <AlertDialogAction onClick={pair}>Párba teszem</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
      {fetcher.data?.error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {fetcher.data.error}
        </p>
      )}
    </div>
  );
}

function EnterWaitingPairButton({ pair, seasonId }: { pair: WaitingPair; seasonId: number }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const busy = fetcher.state !== "idle";
  return (
    <div className="grid justify-items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => fetcher.submit({ intent: "enter", pair: String(pair.pairId), season: String(seasonId) }, { method: "post" })}
      >
        Benevezés
      </Button>
      {fetcher.data?.error && (
        <p role="alert" className="text-xs font-semibold text-destructive">
          {fetcher.data.error}
        </p>
      )}
    </div>
  );
}

function WaitingTab({ waiting }: { waiting: Route.ComponentProps["loaderData"]["waiting"] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const allSingles: WaitingSingle[] = [...waiting.seekingSingles, ...waiting.otherSingles];
  const chosen = allSingles.filter((s) => selected.includes(s.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => (on ? [...prev.filter((x) => x !== id), id].slice(-2) : prev.filter((x) => x !== id)));

  if (waiting.counts.total === 0) {
    return <p className="py-10 text-center text-muted-foreground">Jelenleg nincs várakozó pár vagy egyedülálló játékos.</p>;
  }

  return (
    <div className="grid gap-6">
      {waiting.runningRound && waiting.nextRoundPairs.length > 0 && (
        <section className="grid gap-3">
          <SectionLabel>A következő körben kezdenek ({waiting.nextRoundPairs.length})</SectionLabel>
          <ul className="grid gap-2">
            {waiting.nextRoundPairs.map((p) => (
              <li key={p.pairId} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 text-sm">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {p.players.map((pl, i) => (
                      <span key={pl.id}>
                        {i > 0 && " – "}
                        <PersonLink id={pl.id} name={pl.name || "Névtelen"} />
                      </span>
                    ))}
                    {p.isNew && <Badge>új</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.players.map((pl) => (pl.level ? levelLabel(pl.level) : "–")).join(" / ")} · Elo:{" "}
                    {p.averageElo === null ? "–" : formatElo(p.averageElo)} ·{" "}
                    {p.joinsPhase === null ? "következő szezon" : fromPhase(p.joinsPhase)}
                  </p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    {p.players.map((pl) => (
                      <span key={pl.id}>
                        {pl.name}: <PhoneLink phone={pl.phone} />
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting.notEnteredPairs.length > 0 && (
        <section className="grid gap-3">
          <SectionLabel>Nem neveztek ({waiting.notEnteredPairs.length})</SectionLabel>
          <ul className="grid gap-2">
            {waiting.notEnteredPairs.map((p) => (
              <li key={p.pairId} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 text-sm">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {p.players.map((pl, i) => (
                      <span key={pl.id}>
                        {i > 0 && " – "}
                        <PersonLink id={pl.id} name={pl.name || "Névtelen"} />
                      </span>
                    ))}
                    {p.isNew && <Badge>új</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.players.map((pl) => (pl.level ? levelLabel(pl.level) : "–")).join(" / ")} · Elo:{" "}
                    {p.averageElo === null ? "–" : formatElo(p.averageElo)}
                  </p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    {p.players.map((pl) => (
                      <span key={pl.id}>
                        {pl.name}: <PhoneLink phone={pl.phone} />
                      </span>
                    ))}
                  </div>
                </div>
                {waiting.latestSeasonId !== null && <EnterWaitingPairButton pair={p} seasonId={waiting.latestSeasonId} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {allSingles.length > 0 && (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>Egyedül ({allSingles.length})</SectionLabel>
            <PairButton chosen={chosen} onDone={() => setSelected([])} />
          </div>
          <ul className="grid gap-2">
            {allSingles.map((s) => {
              const checked = selected.includes(s.id);
              return (
                <li key={s.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                  <Checkbox
                    aria-label={`${s.name} kijelölése`}
                    checked={checked}
                    onCheckedChange={(on) => toggle(s.id, on === true)}
                    className="mt-0.5"
                  />
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <PersonLink id={s.id} name={s.name} className="font-medium" />
                      <span className="text-xs text-muted-foreground">· {s.level ? levelLabel(s.level) : "nincs szintje"}</span>
                      <Badge variant={s.seeking ? "default" : "outline"}>{s.seeking ? "Párt keres" : "Nincs párja"}</Badge>
                      {s.isNew && <Badge variant="secondary">új</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {s.seeking ? `Párt keres: ${formatDateTime(new Date(s.since))} óta` : `Regisztrált: ${formatDateTime(new Date(s.since))}`}
                    </p>
                    <div>
                      <PhoneLink phone={s.phone} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function PlayerFilters({
  query,
  counts,
  slug,
  canAdminBroadcast,
  shownIds,
}: {
  query: Route.ComponentProps["loaderData"]["playerQuery"];
  counts: Record<PlayersFilter, number>;
  slug: string;
  canAdminBroadcast: boolean;
  shownIds: string[];
}) {
  const href = (filter: PlayersFilter | null) => {
    const qs = playersQueryString({ ...query, filter });
    return qs ? `?${qs}` : "?";
  };
  const filtered = isPlayersFiltered(query);
  const mailHref = canAdminBroadcast
    ? `/admin/broadcasts/new?players=${encodeURIComponent(slug)}&${playersQueryString(query)}`
    : `/admin/leagues/${slug}/mail?ids=${encodeURIComponent(shownIds.join(","))}&audience=${encodeURIComponent(
        query.filter ? PLAYERS_FILTERS[query.filter] : "Szűrt játékosok",
      )}`;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Form method="get" className="w-full sm:w-64">
          {query.filter && <input type="hidden" name="filter" value={query.filter} />}
          <Input key={query.q} type="search" name="q" defaultValue={query.q} placeholder="Keresés név szerint…" aria-label="Keresés" />
        </Form>
        {filtered && (
          <Button variant="ghost" asChild>
            <Link to={`/admin/leagues/${slug}/players`}>Szűrők törlése</Link>
          </Button>
        )}
        {filtered && (
          <Button variant="outline" asChild={shownIds.length > 0} disabled={shownIds.length === 0}>
            {shownIds.length > 0 ? (
              <Link to={mailHref}>
                <Mail /> Levél nekik
              </Link>
            ) : (
              <span>
                <Mail /> Levél nekik
              </span>
            )}
          </Button>
        )}
      </div>
      <nav aria-label="Szűrők" className="flex flex-wrap gap-2">
        {(Object.entries(PLAYERS_FILTERS) as [PlayersFilter, string][]).map(([key, label]) => (
          <Button key={key} variant={query.filter === key ? "default" : "outline"} size="sm" asChild>
            <Link to={href(query.filter === key ? null : key)} aria-current={query.filter === key ? "page" : undefined}>
              {label} ({counts[key]})
            </Link>
          </Button>
        ))}
      </nav>
    </div>
  );
}

function PlayerRow({ row, selected, onToggle }: { row: PlayerRowData; selected: boolean; onToggle: (on: boolean) => void }) {
  return (
    <TableRow className={CARD_ROW} data-state={selected ? "selected" : undefined}>
      <TableCell className={cn("w-10", CARD_CELL)}>
        {!row.pair && <Checkbox aria-label={`${row.name} kijelölése`} checked={selected} onCheckedChange={(on) => onToggle(on === true)} />}
      </TableCell>
      <TableCell className={cn("min-w-56 whitespace-normal", CARD_CELL)}>
        <PersonLink id={row.id} name={row.name} className="font-medium" />
        <span className="text-xs text-muted-foreground"> · {row.level ? levelLabel(row.level) : "nincs szintje"}</span>
        {row.seeking && (
          <Badge variant="outline" className="ml-2">
            Párt keres
          </Badge>
        )}
        {row.seekingSince && <div className="text-xs text-muted-foreground">Párt keres: {formatDateTime(new Date(row.seekingSince))} óta</div>}
        <div>
          <PhoneLink phone={row.phone} />
        </div>
        <StatusChips chips={row.missing} />
      </TableCell>
      <TableCell className={cn("whitespace-normal", CARD_CELL)}>
        <CardLabel>Pár</CardLabel>
        {row.pair ? <PersonLink id={row.pair.partnerId} name={row.pair.partner} /> : <StatusChips chips={[{ text: "Nincs párja", tone: "todo" }]} />}
      </TableCell>
      <TableCell className={cn("whitespace-normal", CARD_CELL)}>
        <CardLabel>Nevezés</CardLabel>
        {row.entryChip ? <StatusChips chips={[row.entryChip]} /> : "–"}
      </TableCell>
    </TableRow>
  );
}

function PairFilters({
  query,
  counts,
  slug,
  canAdminBroadcast,
  shownUserIds,
}: {
  query: Route.ComponentProps["loaderData"]["pairsQuery"];
  counts: Record<PairsFilter, number>;
  slug: string;
  canAdminBroadcast: boolean;
  shownUserIds: string[];
}) {
  const href = (entry: PairsFilter | null) => {
    const qs = pairsQueryString({ ...query, entry });
    return qs ? `?tab=pairs&${qs}` : "?tab=pairs";
  };
  const filtered = isPairsFiltered(query);
  const mailHref = canAdminBroadcast
    ? `/admin/broadcasts/new?pairs=${encodeURIComponent(slug)}&${pairsQueryString(query)}`
    : `/admin/leagues/${slug}/mail?ids=${encodeURIComponent(shownUserIds.join(","))}&audience=${encodeURIComponent(
        query.entry ? PAIRS_FILTERS[query.entry] : "Szűrt párok",
      )}`;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Form method="get" className="w-full sm:w-64">
          <input type="hidden" name="tab" value="pairs" />
          {query.entry && <input type="hidden" name="entry" value={query.entry} />}
          <Input key={query.q} type="search" name="q" defaultValue={query.q} placeholder="Keresés név szerint…" aria-label="Keresés" />
        </Form>
        {filtered && (
          <Button variant="ghost" asChild>
            <Link to={`/admin/leagues/${slug}/players?tab=pairs`}>Szűrők törlése</Link>
          </Button>
        )}
        {filtered && (
          <Button variant="outline" asChild={shownUserIds.length > 0} disabled={shownUserIds.length === 0}>
            {shownUserIds.length > 0 ? (
              <Link to={mailHref}>
                <Mail /> Levél nekik
              </Link>
            ) : (
              <span>
                <Mail /> Levél nekik
              </span>
            )}
          </Button>
        )}
      </div>
      <nav aria-label="Nevezés szerint" className="flex flex-wrap gap-2">
        {(Object.entries(PAIRS_FILTERS) as [PairsFilter, string][]).map(([key, label]) => (
          <Button key={key} variant={query.entry === key ? "default" : "outline"} size="sm" asChild>
            <Link to={href(query.entry === key ? null : key)} aria-current={query.entry === key ? "page" : undefined}>
              {label} ({counts[key]})
            </Link>
          </Button>
        ))}
      </nav>
    </div>
  );
}

function PairRow({
  pair: p,
  candidates,
  strikes,
  absences,
}: {
  pair: PairRowData;
  candidates: Candidate[];
  strikes: Record<string, number>;
  absences: Record<string, number>;
}) {
  return (
    <TableRow className={cn(CARD_ROW, p.status === "dissolved" && "text-muted-foreground")}>
      <TableCell className={cn("min-w-56", CARD_CELL)}>
        {p.players.map((pl) => (
          <div key={pl.id}>
            <PersonLink id={pl.id} name={pl.name} className="font-medium" />
            {pl.level && <span className="text-xs text-muted-foreground"> · {levelLabel(pl.level)}</span>}
            {(strikes[pl.id] ?? 0) > 0 && (
              <Badge variant={(strikes[pl.id] ?? 0) >= 3 ? "destructive" : "outline"} className="ml-2">
                {strikes[pl.id]} fekete pont
              </Badge>
            )}
            <div>
              <PhoneLink phone={pl.phone} />
            </div>
            {p.status === "active" && <StatusChips chips={missingChips({ registered: true, level: pl.level, phone: !!pl.phone, pairs: [] })} />}
          </div>
        ))}
      </TableCell>
      <TableCell className={CARD_CELL}>
        <CardLabel>Elo (átlag)</CardLabel>
        {p.elo === null ? "–" : formatElo(p.elo)}
      </TableCell>
      <TableCell className={CARD_CELL}>
        <CardLabel>Forrás</CardLabel>
        {SOURCE_LABELS[p.source]}
        {absenceCountText(absences[p.id] ?? 0) && <div className="text-xs text-muted-foreground">{absenceCountText(absences[p.id] ?? 0)}</div>}
      </TableCell>
      <TableCell className={CARD_CELL}>
        <Badge variant={p.status === "active" ? "default" : "outline"}>{p.status === "active" ? "Aktív" : "Felbontva"}</Badge>
      </TableCell>
      <TableCell className={cn("text-sm", CARD_CELL)}>
        <CardLabel>Nevezés</CardLabel>
        {p.status === "active" ? <EntryCell pair={p} /> : p.entry ? `${p.entry.season}: ${ENTRY_STATUS_LABELS[p.entry.status]}` : "–"}
      </TableCell>
      <TableCell className={cn("text-right max-sm:text-left", CARD_CELL)}>
        {p.status === "active" && (
          <div className="grid justify-items-end gap-1 max-sm:justify-items-start">
            <div className="flex gap-1">
              <ChangeDialog pair={p} candidates={candidates} />
              <DissolveButton pair={p} />
            </div>
            {p.locked && <p className="max-w-64 text-xs whitespace-normal text-muted-foreground">{DISSOLVE_REFUSED}</p>}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

const STRIKE_SOURCES = { deadline: "Határidő: nem próbált egyeztetni", no_show: "Nem jelent meg" } as const;

function CancelStrikeDialog({ strike }: { strike: Strike }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setOpen(false);
  }, [fetcher.state, fetcher.data]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={busy}>
          Törlés
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fekete pont törlése: {strike.name}</DialogTitle>
          <DialogDescription>
            A fekete pont nem számít tovább, a játékos száma eggyel csökken. Ha emiatt 3 alá kerül, a párja a kör végén mégsem esik ki. A törlés a Naplóba kerül az indokkal.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={`strike-reason-${strike.id}`}>Indok</Label>
          <Textarea
            id={`strike-reason-${strike.id}`}
            value={reason}
            maxLength={CANCEL_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Pl. betegség, a klub lemondta a pályát"
          />
          {fetcher.data?.error && (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {fetcher.data.error}
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Mégse</Button>
          </DialogClose>
          <Button
            disabled={busy || !reason.trim()}
            onClick={() => fetcher.submit({ intent: "strike-cancel", strike: String(strike.id), reason }, { method: "post" })}
          >
            Fekete pont törlése
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LeaguePlayers({ loaderData }: Route.ComponentProps) {
  const {
    name,
    slug,
    canAdminBroadcast,
    waiting,
    playerRows,
    totalPlayers,
    playerCounts,
    playerQuery,
    pairRows,
    pairCounts,
    pairsQuery,
    activePairsCount,
    candidates,
    absenceCounts,
    strikes,
    activeStrikesCount,
    strikeCounts,
  } = loaderData;

  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const [selected, setSelected] = useState<string[]>([]);
  const chosen = playerRows.filter((r) => !r.pair && selected.includes(r.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => (on ? [...s.filter((x) => x !== id), id].slice(-2) : s.filter((x) => x !== id)));

  const setTab = (next: string) => {
    const parsed = parseTab(next);
    setParams(
      () => {
        const p = new URLSearchParams();
        if (parsed !== "players") p.set("tab", parsed);
        return p;
      },
      { preventScrollReset: true },
    );
  };

  const shownPairUserIds = [...new Set(pairRows.flatMap((r) => r.players.map((p) => p.id)))];

  return (
    <Page>
      <PageHeader
        eyebrow={name}
        title="Játékosok"
        aside={
          tab === "players" ? (
            <PairButton chosen={chosen} onDone={() => setSelected([])} />
          ) : tab === "pairs" ? (
            <CreateDialog candidates={candidates} />
          ) : undefined
        }
      />
      <p className="text-sm text-muted-foreground">
        {totalPlayers} regisztrált játékos · {activePairsCount} aktív pár · {waiting.counts.total} várakozó. Az e-mail-címüket nem látod.
      </p>

      <Segmented
        label="Játékosok nézetek"
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "waiting", label: `Várakozók (${waiting.counts.total})` },
          { value: "players", label: "Játékosok" },
          { value: "pairs", label: "Párok" },
          { value: "strikes", label: activeStrikesCount > 0 ? `Fekete pontok (${activeStrikesCount})` : "Fekete pontok" },
        ]}
      />

      {tab === "waiting" && <WaitingTab waiting={waiting} />}

      {tab === "players" && (
        <section className="grid gap-4">
          <PlayerFilters
            query={playerQuery}
            counts={playerCounts}
            slug={slug}
            canAdminBroadcast={canAdminBroadcast}
            shownIds={playerRows.map((r) => r.id)}
          />
          {playerRows.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              {isPlayersFiltered(playerQuery) ? "Nincs ilyen játékos." : "Ebben a ligában még nincs regisztrált játékos."}
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table aria-label="Játékosok listája" className="max-sm:block">
                <TableHeader className="max-sm:hidden">
                  <TableRow>
                    <TableHead className="w-10">
                      <span className="sr-only">Kijelölés</span>
                    </TableHead>
                    <TableHead>Játékos</TableHead>
                    <TableHead>Pár</TableHead>
                    <TableHead>Nevezés</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="max-sm:block">
                  {playerRows.map((r) => (
                    <PlayerRow key={r.id} row={r} selected={selected.includes(r.id)} onToggle={(on) => toggle(r.id, on)} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {tab === "pairs" && (
        <section className="grid gap-4">
          <PairFilters
            query={pairsQuery}
            counts={pairCounts}
            slug={slug}
            canAdminBroadcast={canAdminBroadcast}
            shownUserIds={shownPairUserIds}
          />
          {pairRows.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              {isPairsFiltered(pairsQuery) ? "Nincs ilyen pár." : "Ebben a ligában még nincs pár."}
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table aria-label="Párok listája" className="max-sm:block">
                <TableHeader className="max-sm:hidden">
                  <TableRow>
                    <TableHead>Pár</TableHead>
                    <TableHead>Elo (átlag)</TableHead>
                    <TableHead>Forrás</TableHead>
                    <TableHead>Állapot</TableHead>
                    <TableHead>Nevezés</TableHead>
                    <TableHead>
                      <span className="sr-only">Műveletek</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="max-sm:block">
                  {pairRows.map((p) => (
                    <PairRow key={p.id} pair={p} candidates={candidates} strikes={strikeCounts} absences={absenceCounts} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {tab === "strikes" && (
        <section className="grid gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            A pár mindkét játékosa kap egy fekete pontot, ha a határidőig nem próbált egyeztetni, vagy nem jelent meg. A 3.-nál a pár a kör végén kikerül a ligából. Indokolt esetben itt törölheted.
          </p>
          {strikes.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Nincs fekete pont ebben a szezonban.</p>
          ) : (
            <div className="rounded-lg border">
              <Table aria-label="Fekete pontok" className="max-sm:block">
                <TableHeader className="max-sm:hidden">
                  <TableRow>
                    <TableHead>Játékos</TableHead>
                    <TableHead>Mikor</TableHead>
                    <TableHead>Miért</TableHead>
                    <TableHead>Állapot</TableHead>
                    <TableHead>
                      <span className="sr-only">Műveletek</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="max-sm:block">
                  {strikes.map((s) => (
                    <TableRow key={s.id} className={cn(CARD_ROW, s.cancelledAt && "text-muted-foreground")}>
                      <TableCell className={cn("font-medium", CARD_CELL)}>
                        <PersonLink id={s.userId} name={s.name} />
                      </TableCell>
                      <TableCell className={cn("whitespace-nowrap", CARD_CELL)}>
                        <CardLabel>Mikor</CardLabel>
                        {formatDeadline(new Date(s.at))}
                      </TableCell>
                      <TableCell className={cn("min-w-48 whitespace-normal", CARD_CELL)}>
                        <CardLabel>Miért</CardLabel>
                        {STRIKE_SOURCES[s.source]}
                        {s.matchId && (
                          <>
                            {" · "}
                            <Link to={`/admin/leagues/${slug}/matches/${s.matchId}`} className="underline">
                              meccs
                            </Link>
                          </>
                        )}
                      </TableCell>
                      <TableCell className={cn("min-w-48 whitespace-normal", CARD_CELL)}>
                        <CardLabel>Állapot</CardLabel>
                        {s.cancelledAt ? `Törölve (${s.cancelledBy ?? "szervező"}): ${s.cancelReason ?? ""}` : "Érvényes"}
                      </TableCell>
                      <TableCell className={cn("text-right max-sm:text-left", CARD_CELL)}>
                        {!s.cancelledAt && <CancelStrikeDialog strike={s} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
    </Page>
  );
}
