import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, Link, redirect, useFetcher } from "react-router";

import type { Route } from "./+types/admin.league-pairs";
import { AppPage } from "~/components/app-page";
import { CARD_CELL, CARD_ROW, CardLabel } from "~/components/card-table";
import { ChangeDialog, CreateDialog, DissolveButton, EntryCell } from "~/components/pair-actions";
import { PersonLink } from "~/components/person-link";
import { PhoneLink } from "~/components/phone-link";
import { StatusChips } from "~/components/status-chips";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
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
import { cn } from "~/lib/utils";
import {
  filterPairsRows,
  isFiltered,
  PAIRS_FILTERS,
  pairsFilterCounts,
  pairsQueryString,
  parsePairsQuery,
  RETIRED_NO_PAIR,
  type PairsFilter,
} from "~/lib/league-pairs-view";
import { playersPath } from "~/lib/league-players";
import { pairUp } from "~/lib/league-players.server";
import { formatElo } from "~/lib/groups";
import { getLeague } from "~/lib/leagues.server";
import { DISSOLVE_REFUSED, SOURCE_LABELS } from "~/lib/pairs";
import { changePartner, dissolvePair, leaguePairs, pairCandidates } from "~/lib/pairs.server";
import { missingChips } from "~/lib/player-status";
import { ENTRY_STATUS_LABELS } from "~/lib/season-entries";
import { enterPairByOrganizer, removePairFromSeason, withdrawPairMidPhase } from "~/lib/season-entries.server";
import { currentSeason } from "~/lib/seasons";
import { listSeasons } from "~/lib/seasons.server";
import { levelLabel } from "~/lib/signups-admin";
import { SITE_NAME } from "~/lib/site";
import { formatDeadline } from "~/lib/format";
import { CANCEL_REASON_MAX } from "~/lib/strikes";
import { cancelStrike, countsBySeason, leagueStrikes } from "~/lib/strikes.server";

// Párok (#97): the Szervező of the league (or the Admin) creates, dissolves
// and changes pairs, and enters a pair for the season or takes it out (#154).
// The players' strikes (#294) show here, with the organizer's cancel.
// Players can't change their pair themselves. No email goes out: the
// organizer tells the players (an entry change is also an in-app notice).
// The list can be searched by name and filtered by entry, in the address,
// and the Admin can open the broadcast page for the players shown (#148).
// The players without a pair are on Játékosok (#301, D155). Names, levels
// and phone numbers (tap to call, D126); never an email address. The
// Admin's player profile posts its pair actions here too
// (components/pair-actions.tsx).

export function meta({}: Route.MetaArgs) {
  return [{ title: `Párok – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

async function scope(request: Request, slug: string) {
  const league = await getLeague(slug);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league, actor };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, actor } = await scope(request, params.league);
  const search = new URL(request.url).searchParams;
  // "Nincs párja" lists players, so it moved to Játékosok (#301).
  if (search.get("entry") === RETIRED_NO_PAIR)
    throw redirect(playersPath(league.slug, { filter: "no_pair", q: search.get("q")?.trim() ?? "" }));
  const query = parsePairsQuery(search);
  const [all, free] = await Promise.all([leaguePairs(league.id), pairCandidates(league)]);
  // "Pár létrehozása" and "Csere" offer the league's players without a pair
  // (D128), by name in Hungarian order (SQLite puts "Ákos" after "Zoltán").
  const candidates = free.map(({ id, name, level }) => ({ id, name, level })).sort((x, y) => x.name.localeCompare(y.name, "hu"));
  // The strikes of the league's current season (#294): they reset every
  // season, so a new season shows none, not the last one's.
  const [strikeList, seasons] = await Promise.all([leagueStrikes(league.id), listSeasons(league.id)]);
  const strikeSeason = currentSeason(seasons, new Date())?.id ?? 0;
  const strikes = strikeList.filter((s) => s.seasonId === strikeSeason);
  return {
    strikes,
    strikeCounts: Object.fromEntries(countsBySeason(strikes).get(strikeSeason) ?? []),
    name: league.name,
    slug: league.slug,
    rows: filterPairsRows(all, query),
    counts: pairsFilterCounts(all, query.q),
    query,
    activePairs: all.filter((r) => r.status === "active").length,
    candidates,
    // "Levél nekik" opens the broadcast page, which is the Admin's.
    canMail: can(actor, { kind: "broadcasts.send" }),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor } = await scope(request, params.league);
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  const pairId = Number(field("pair"));
  const seasonId = Number(field("season"));
  const intent = field("intent");
  const valid = (n: number) => Number.isInteger(n) && n > 0;
  let result: { ok: true } | { ok: false; error: string };
  if (intent === "create") result = await pairUp(actor.id, league, field("a"), field("b"));
  else if ((intent === "dissolve" || intent === "change") && valid(pairId))
    result =
      intent === "dissolve"
        ? await dissolvePair(actor.id, league.id, pairId)
        : await changePartner(actor.id, league.id, pairId, field("keep"), field("partner"));
  else if ((intent === "enter" || intent === "remove") && valid(pairId) && valid(seasonId))
    result =
      intent === "enter"
        ? await enterPairByOrganizer(actor, league.id, pairId, seasonId)
        : await removePairFromSeason(actor, league.id, pairId, seasonId);
  else if (intent === "withdraw" && valid(pairId) && valid(seasonId))
    result = await withdrawPairMidPhase(actor, league.id, pairId, seasonId, field("reason"));
  else if (intent === "strike-cancel" && valid(Number(field("strike"))))
    result = await cancelStrike(actor.id, league.id, Number(field("strike")), field("reason"));
  else throw new Response("Hibás kérés.", { status: 400 });
  return result.ok ? { ok: true as const } : { error: result.error };
}

type Pair = Route.ComponentProps["loaderData"]["rows"][number];
type Candidate = Route.ComponentProps["loaderData"]["candidates"][number];

// Search by name and the entry filter, both in the address (#148).
function Filters({ query, counts, slug, canMail, shown }: {
  query: Route.ComponentProps["loaderData"]["query"];
  counts: Record<PairsFilter, number>;
  slug: string;
  canMail: boolean;
  shown: number;
}) {
  const href = (entry: PairsFilter | null) => {
    const qs = pairsQueryString({ ...query, entry });
    return qs ? `?${qs}` : "?";
  };
  const filtered = isFiltered(query);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Form method="get" className="w-full sm:w-64">
          {query.entry && <input type="hidden" name="entry" value={query.entry} />}
          {/* Keyed by the search, so clearing it empties the field too. */}
          <Input key={query.q} type="search" name="q" defaultValue={query.q} placeholder="Keresés név szerint…" aria-label="Keresés" />
        </Form>
        {filtered && (
          <Button variant="ghost" asChild>
            <Link to={`/admin/leagues/${slug}/pairs`}>Szűrők törlése</Link>
          </Button>
        )}
        {filtered && canMail && (
          <Button variant="outline" asChild={shown > 0} disabled={shown === 0}>
            {shown > 0 ? (
              <Link to={`/admin/broadcasts/new?pairs=${encodeURIComponent(slug)}&${pairsQueryString(query)}`}>
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


function PairRow({ pair: p, candidates, strikes }: { pair: Pair; candidates: Candidate[]; strikes: Record<string, number> }) {
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
            {p.status === "active" && (
              <StatusChips chips={missingChips({ registered: true, level: pl.level, phone: !!pl.phone, pairs: [] })} />
            )}
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

type Strike = Route.ComponentProps["loaderData"]["strikes"][number];

const STRIKE_SOURCES = { deadline: "Határidő: nem próbált egyeztetni", no_show: "Nem jelent meg" } as const;

// The season's strikes (#294, spec 8): who, when, why, and the cancel with a
// required reason (audited, D91). A player at 3 leaves with the pair at the
// end of the phase; a cancelled strike no longer counts.
function StrikesSection({ strikes, slug }: { strikes: Strike[]; slug: string }) {
  if (strikes.length === 0) return null;
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="strikes-title">
      <h2 id="strikes-title" className="font-display text-lg font-bold">
        Fekete pontok · {strikes[0]!.season}
      </h2>
      <p className="max-w-2xl text-sm text-muted-foreground">
        A pár mindkét játékosa kap egyet, ha a határidőig nem próbált egyeztetni, vagy nem jelent meg. A 3.-nál a pár a kör
        végén kikerül a ligából. Indokolt esetben (betegség, a klub lemondta a pályát) itt törölheted; a játékost nem
        értesítjük, a számot az oldalán látja.
      </p>
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
                <TableCell className={cn("text-right max-sm:text-left", CARD_CELL)}>{!s.cancelledAt && <CancelStrikeDialog strike={s} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

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
            A fekete pont nem számít tovább, a játékos száma eggyel csökken. Ha emiatt 3 alá kerül, a párja a kör végén mégsem
            esik ki. A törlés a Naplóba kerül az indokkal.
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
            Törlés
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LeaguePairs({ loaderData }: Route.ComponentProps) {
  const { name, slug, rows, counts, query, activePairs, candidates, canMail, strikes, strikeCounts } = loaderData;
  return (
    <AppPage
      title="Párok"
      description={`${name} · ${activePairs} aktív pár, ${candidates.length} regisztrált játékos pár nélkül`}
      actions={<CreateDialog candidates={candidates} />}
    >
      <p className="max-w-2xl text-muted-foreground">
        A játékosok párlinkkel lesznek párok, vagy te teszed őket párba itt vagy a Játékosok oldalon. A kihirdetett csoportban
        játszó pár a kör határidejéig nem bontható fel.
      </p>
      <Filters query={query} counts={counts} slug={slug} canMail={canMail} shown={rows.length} />
      {rows.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">
          {isFiltered(query) ? "Nincs ilyen sor." : "Ebben a ligában még nincs pár."}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table aria-label="Párok listája" className="max-sm:block">
            <TableHeader className="max-sm:hidden">
              <TableRow>
                <TableHead>Játékosok</TableHead>
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
              {rows.map((p) => (
                <PairRow key={p.id} pair={p} candidates={candidates} strikes={strikeCounts} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <StrikesSection strikes={strikes} slug={slug} />
    </AppPage>
  );
}
