import { Mail } from "lucide-react";
import { useState } from "react";
import { data, Form, Link, useFetcher } from "react-router";

import type { Route } from "./+types/admin.league-players";
import { AppPage } from "~/components/app-page";
import { CARD_CELL, CARD_ROW, CardLabel } from "~/components/card-table";
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
import { Input } from "~/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { can } from "~/lib/auth/permissions";
import {
  filterPlayers,
  isPlayersFiltered,
  PLAYERS_FILTERS,
  playersFilterCounts,
  playersQueryString,
  parsePlayersQuery,
  type PlayersFilter,
} from "~/lib/league-players";
import { leaguePlayerRows, pairUp } from "~/lib/league-players.server";
import { getLeague } from "~/lib/leagues.server";
import { levelLabel } from "~/lib/signups-admin";
import { SITE_NAME } from "~/lib/site";
import { cn } from "~/lib/utils";

// Játékosok (#301, D155): every registered player of the league once, with
// pair, "Párt keresek", entry and what's missing. It replaces Párkeresők and
// Párok's rows without a pair; Párok lists the pairs. Two players without a
// pair can be put in one ("Párba teszem"; two seekers make a "search" pair,
// D113). Names, levels and phone numbers (tap to call, D126); never an email
// address. For the Admin each name opens the player's profile, and "Levél
// nekik" opens the broadcast page for the players shown.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Játékosok – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

async function scope(request: Request, slug: string) {
  const league = await getLeague(slug);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league, actor };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, actor } = await scope(request, params.league);
  const query = parsePlayersQuery(new URL(request.url).searchParams);
  const all = await leaguePlayerRows(league);
  return {
    name: league.name,
    slug: league.slug,
    rows: filterPlayers(all, query),
    total: all.length,
    counts: playersFilterCounts(all, query.q),
    query,
    // "Levél nekik" opens the broadcast page, which is the Admin's.
    canMail: can(actor, { kind: "broadcasts.send" }),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor } = await scope(request, params.league);
  const form = await request.formData();
  if (form.get("intent") !== "pair") throw new Response("Hibás kérés.", { status: 400 });
  const [a, b] = form.getAll("user").map(String);
  const result = await pairUp(actor.id, league, a ?? "", b ?? "");
  return result.ok ? { ok: true as const } : { error: result.error };
}

type Row = Route.ComponentProps["loaderData"]["rows"][number];

function Filters({
  query,
  counts,
  slug,
  canMail,
  shown,
}: {
  query: Route.ComponentProps["loaderData"]["query"];
  counts: Record<PlayersFilter, number>;
  slug: string;
  canMail: boolean;
  shown: number;
}) {
  const href = (filter: PlayersFilter | null) => {
    const qs = playersQueryString({ ...query, filter });
    return qs ? `?${qs}` : "?";
  };
  const filtered = isPlayersFiltered(query);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Form method="get" className="w-full sm:w-64">
          {query.filter && <input type="hidden" name="filter" value={query.filter} />}
          {/* Keyed by the search, so clearing it empties the field too. */}
          <Input key={query.q} type="search" name="q" defaultValue={query.q} placeholder="Keresés név szerint…" aria-label="Keresés" />
        </Form>
        {filtered && (
          <Button variant="ghost" asChild>
            <Link to={`/admin/leagues/${slug}/players`}>Szűrők törlése</Link>
          </Button>
        )}
        {filtered && canMail && (
          <Button variant="outline" asChild={shown > 0} disabled={shown === 0}>
            {shown > 0 ? (
              <Link to={`/admin/broadcasts/new?players=${encodeURIComponent(slug)}&${playersQueryString(query)}`}>
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

// "Párba teszem": the two players picked, after a confirmation.
function PairButton({ chosen, onDone }: { chosen: Row[]; onDone: () => void }) {
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
                Rögtön párban lesznek, és nevezhetnek. Az oldalon és e-mailben is szólunk nekik. A Párok oldalon bonthatod
                fel.
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

function PlayerRow({ row, selected, onToggle }: { row: Row; selected: boolean; onToggle: (on: boolean) => void }) {
  return (
    <TableRow className={CARD_ROW} data-state={selected ? "selected" : undefined}>
      <TableCell className={cn("w-10", CARD_CELL)}>
        {!row.pair && (
          <Checkbox aria-label={`${row.name} kijelölése`} checked={selected} onCheckedChange={(on) => onToggle(on === true)} />
        )}
      </TableCell>
      <TableCell className={cn("min-w-56 whitespace-normal", CARD_CELL)}>
        <PersonLink id={row.id} name={row.name} className="font-medium" />
        <span className="text-xs text-muted-foreground"> · {row.level ? levelLabel(row.level) : "nincs szintje"}</span>
        {row.seeking && (
          <Badge variant="outline" className="ml-2">
            Párt keres
          </Badge>
        )}
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

export default function LeaguePlayers({ loaderData }: Route.ComponentProps) {
  const { name, slug, rows, total, counts, query, canMail } = loaderData;
  const [selected, setSelected] = useState<string[]>([]);
  // Only rows still shown and still without a pair count.
  const chosen = rows.filter((r) => !r.pair && selected.includes(r.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => (on ? [...s.filter((x) => x !== id), id].slice(-2) : s.filter((x) => x !== id)));
  return (
    <AppPage
      title="Játékosok"
      description={`${name} · ${total} regisztrált játékos, ${counts.no_pair} pár nélkül, ${counts.seeking} keres párt`}
      actions={<PairButton chosen={chosen} onDone={() => setSelected([])} />}
    >
      <p className="max-w-2xl text-muted-foreground">
        A liga minden játékosa egyszer. Jelölj ki két pár nélküli játékost, és tedd őket párba. A párokat a Párok oldalon
        látod. Az e-mail-címüket nem látod.
      </p>
      <Filters query={query} counts={counts} slug={slug} canMail={canMail} shown={rows.length} />
      {rows.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">
          {isPlayersFiltered(query) ? "Nincs ilyen játékos." : "Ebben a ligában még nincs regisztrált játékos."}
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
              {rows.map((r) => (
                <PlayerRow key={r.id} row={r} selected={selected.includes(r.id)} onToggle={(on) => toggle(r.id, on)} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppPage>
  );
}
