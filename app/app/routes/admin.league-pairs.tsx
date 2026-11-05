import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, Link, useFetcher } from "react-router";

import type { Route } from "./+types/admin.league-pairs";
import { AppPage } from "~/components/app-page";
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
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { requirePermission } from "~/lib/auth/admin.server";
import { can } from "~/lib/auth/permissions";
import {
  filterPairsRows,
  isFiltered,
  PAIRS_FILTERS,
  pairsFilterCounts,
  pairsSummary,
  type PairsSummary,
  pairsQueryString,
  parsePairsQuery,
  type PairsFilter,
} from "~/lib/league-pairs-view";
import { leaguePairsRows } from "~/lib/league-pairs-view.server";
import { getLeague } from "~/lib/leagues.server";
import { DISSOLVE_REFUSED, SOURCE_LABELS } from "~/lib/pairs";
import { changePartner, createPair, dissolvePair } from "~/lib/pairs.server";
import { entryChip, missingChips } from "~/lib/player-status";
import { ENTRY_STATUS_LABELS, fromPhase, WITHDRAWAL_REASON_MAX } from "~/lib/season-entries";
import { enterPairByOrganizer, removePairFromSeason, withdrawPairMidPhase } from "~/lib/season-entries.server";
import { levelLabel } from "~/lib/signups-admin";
import { SITE_NAME } from "~/lib/site";

// Párok (#97): the Szervező of the league (or the Admin) creates, dissolves
// and changes pairs, and enters a pair for the season or takes it out (#154).
// Players can't change their pair themselves. No email goes out: the
// organizer tells the players (an entry change is also an in-app notice).
// Registered players without a pair are rows too; the list can be searched
// by name and filtered by entry, in the address, and the Admin can open the
// broadcast page for the players shown (#148). Names and levels only, never
// an email address or phone number.

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
  const query = parsePairsQuery(new URL(request.url).searchParams);
  const all = await leaguePairsRows(league);
  // "Pár létrehozása" and "Csere" offer the same players as the rows without
  // a pair: the league's (D93).
  const candidates = all.flatMap((r) => (r.kind === "solo" ? [{ id: r.player.id, name: r.player.name, level: r.player.level }] : []));
  return {
    name: league.name,
    slug: league.slug,
    rows: filterPairsRows(all, query),
    counts: pairsFilterCounts(all, query.q),
    summary: pairsSummary(all),
    query,
    activePairs: all.filter((r) => r.kind === "pair" && r.pair.status === "active").length,
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
  if (intent === "create") result = await createPair(actor.id, league.id, field("a"), field("b"));
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
  else throw new Response("Hibás kérés.", { status: 400 });
  return result.ok ? { ok: true as const } : { error: result.error };
}

type Row = Route.ComponentProps["loaderData"]["rows"][number];
type Pair = Extract<Row, { kind: "pair" }>["pair"];
type Solo = Extract<Row, { kind: "solo" }>["player"];
type Candidate = Route.ComponentProps["loaderData"]["candidates"][number];

const who = (p: { name: string; level: string | null }) => (p.level ? `${p.name} (${levelLabel(p.level)})` : p.name);

// An active pair's entry in the current or next season (with the round it
// starts in), or that it hasn't entered one that is there; and "Benevezés" or
// "Kivétel a szezonból" (#154).
function EntryCell({ pair }: { pair: Pair }) {
  const chip = entryChip(pair);
  const starts =
    pair.entry?.status === "approved" ? (pair.entry.joinsPhase === null ? "a következő szezontól" : fromPhase(pair.entry.joinsPhase)) : null;
  return (
    <div className="grid justify-items-start gap-1">
      {chip ? <StatusChips chips={[chip]} /> : "–"}
      {starts && <span className="text-xs text-muted-foreground">{starts}</span>}
      {pair.entryAction?.kind === "remove" && pair.lockedIn.includes(pair.entryAction.seasonId) ? (
        <WithdrawDialog pair={pair} action={pair.entryAction} />
      ) : (
        pair.entryAction && <EntryActionButton pair={pair} action={pair.entryAction} />
      )}
    </div>
  );
}

// "Kivétel a szezonból" while the pair plays in the running round (#34): a
// mid-round withdrawal, with a required reason.
function WithdrawDialog({ pair, action }: { pair: Pair; action: NonNullable<Pair["entryAction"]> }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [a, b] = pair.players;
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setOpen(false);
  }, [fetcher.state, fetcher.data]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={busy}>
          Kivétel a szezonból
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Visszaléptetés a csoportból: {a.name} – {b.name}
          </DialogTitle>
          <DialogDescription>
            A pár kihirdetett csoportban játszik. Ha visszalépteted, minden meccse kikerül a csoport tabellájából, a
            lejátszottak is, a többi meccse elmarad, és a pár a szezonból is kikerül ({action.season}). Később újra
            benevezheted: a következő körtől játszik. A pár és a csoport többi párja értesítést kap az oldalon; e-mailt nem.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={`withdraw-reason-${pair.id}`}>Indok</Label>
          <Textarea
            id={`withdraw-reason-${pair.id}`}
            value={reason}
            maxLength={WITHDRAWAL_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Pl. sérülés, költözés"
          />
          <p className="text-xs text-muted-foreground">Csak te és a pár látja, a csoport többi párja nem.</p>
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
            variant="destructive"
            disabled={busy || !reason.trim()}
            onClick={() =>
              fetcher.submit({ intent: "withdraw", pair: String(pair.id), season: String(action.seasonId), reason }, { method: "post" })
            }
          >
            Visszaléptetés
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntryActionButton({ pair, action }: { pair: Pair; action: NonNullable<Pair["entryAction"]> }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const [a, b] = pair.players;
  const enter = action.kind === "enter";
  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant={enter ? "outline" : "ghost"} size="sm" disabled={fetcher.state !== "idle"}>
            {enter ? "Benevezés" : "Kivétel a szezonból"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {enter ? "Benevezed" : "Kiveszed a szezonból"}: {a.name} – {b.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {enter
                ? `A pár nevezése azonnal érvényes erre a szezonra (${action.season}), mintha ők nyomták volna meg a „Nevezünk” gombot. Ha a szezon már elindult, a következő körtől játszanak.`
                : `A pár nevezése visszavonódik (${action.season}), és kimarad minden ezután készülő csoportbeosztásból. A pár megmarad, később újra benevezheted.`}{" "}
              Mindkét játékos értesítést kap az oldalon; e-mailt nem, szólj nekik te.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Mégse</AlertDialogCancel>
            <AlertDialogAction
              variant={enter ? "default" : "destructive"}
              onClick={() =>
                fetcher.submit({ intent: action.kind, pair: String(pair.id), season: String(action.seasonId) }, { method: "post" })
              }
            >
              {enter ? "Benevezés" : "Kivétel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {fetcher.data?.error && (
        <p role="alert" className="max-w-64 text-xs font-semibold whitespace-normal text-destructive">
          {fetcher.data.error}
        </p>
      )}
    </>
  );
}

function PlayerSelect({
  name,
  label,
  candidates,
  value,
  onChange,
}: {
  name: string;
  label: string;
  candidates: Candidate[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Select name={name} value={value} onValueChange={onChange}>
        <SelectTrigger id={name} className="w-full">
          <SelectValue placeholder="Válassz játékost" />
        </SelectTrigger>
        <SelectContent>
          {candidates.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {who(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CreateDialog({ candidates }: { candidates: Candidate[] }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const [open, setOpen] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const busy = fetcher.state !== "idle";
  // Closes once the pair is made; stays open with the reason otherwise.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.ok) return;
    setOpen(false);
    setA("");
    setB("");
  }, [fetcher.state, fetcher.data]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={candidates.length < 2}>Pár létrehozása</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pár létrehozása</DialogTitle>
          <DialogDescription>
            Két regisztrált játékos, akinek még nincs párja ebben a ligában. Az oldalon és e-mailben is szólunk nekik.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <PlayerSelect name="a" label="Első játékos" candidates={candidates.filter((c) => c.id !== b)} value={a} onChange={setA} />
          <PlayerSelect name="b" label="Második játékos" candidates={candidates.filter((c) => c.id !== a)} value={b} onChange={setB} />
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
          <Button onClick={() => fetcher.submit({ intent: "create", a, b }, { method: "post" })} disabled={!a || !b || busy}>
            Létrehozás
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DissolveButton({ pair }: { pair: Pair }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const [a, b] = pair.players;
  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" disabled={pair.locked || fetcher.state !== "idle"}>
            Felbontás
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Felbontod a párt?</AlertDialogTitle>
            <AlertDialogDescription>
              {a.name} és {b.name} nem lesznek többé pár. A nevezésük visszavonódik, ha még nem kezdtek el játszani. Nem
              kapnak róla e-mailt; szólj nekik te.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Mégse</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => fetcher.submit({ intent: "dissolve", pair: String(pair.id) }, { method: "post" })}
            >
              Felbontás
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {fetcher.data?.error && (
        <p role="alert" className="text-xs font-semibold text-destructive">
          {fetcher.data.error}
        </p>
      )}
    </>
  );
}

function ChangeDialog({ pair, candidates }: { pair: Pair; candidates: Candidate[] }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState(pair.players[0].id);
  const [partner, setPartner] = useState("");
  const busy = fetcher.state !== "idle";
  const leaving = pair.players.find((p) => p.id !== keep)!;
  const kept = pair.players.find((p) => p.id === keep)!;
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setOpen(false);
  }, [fetcher.state, fetcher.data]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pair.locked || candidates.length === 0}>
          Partner cseréje
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Partner cseréje</DialogTitle>
          <DialogDescription>
            A mostani pár felbomlik, és {kept.name} új párt alkot. Az új párnak az oldalon és e-mailben is szólunk.{" "}
            {leaving.name} pár nélkül marad, és nem kap értesítést: neki szólj te.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Ki marad?</Label>
            <RadioGroup value={keep} onValueChange={setKeep}>
              {pair.players.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <RadioGroupItem id={`keep-${pair.id}-${p.id}`} value={p.id} />
                  <Label htmlFor={`keep-${pair.id}-${p.id}`} className="font-normal">
                    {who(p)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          <PlayerSelect name="partner" label="Új partner" candidates={candidates} value={partner} onChange={setPartner} />
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
            onClick={() => fetcher.submit({ intent: "change", pair: String(pair.id), keep, partner }, { method: "post" })}
            disabled={!partner || busy}
          >
            Csere
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The counts at the top (#237): the whole league, whatever the search or the
// filter; a label opens the list with that filter (and no search).
function SummaryTable({ summary }: { summary: PairsSummary }) {
  const num = (n: number | null) => (n === null ? "–" : n);
  return (
    <div className="w-full rounded-lg border sm:w-fit">
      <Table className="tabular-nums">
        <caption className="sr-only">Párok és játékosok állapot szerint</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Állapot</TableHead>
            <TableHead className="text-right">Párok</TableHead>
            <TableHead className="text-right">Játékosok</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.rows.map((r) => (
            <TableRow key={r.filter}>
              <TableCell>
                <Link to={`?entry=${r.filter}`} className="underline-offset-4 hover:underline">
                  {PAIRS_FILTERS[r.filter]}
                </Link>
              </TableCell>
              <TableCell className="text-right">{num(r.pairs)}</TableCell>
              <TableCell className="text-right">{num(r.players)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="font-medium">
            <TableCell>Összesen</TableCell>
            <TableCell className="text-right">{summary.total.pairs}</TableCell>
            <TableCell className="text-right">{summary.total.players}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

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

function SoloRow({ player }: { player: Solo }) {
  return (
    <TableRow>
      <TableCell className="min-w-56">
        <span className="font-medium">{player.name}</span>
        {player.level && <span className="text-xs text-muted-foreground"> · {levelLabel(player.level)}</span>}
        {player.seeking && (
          <Badge variant="outline" className="ml-2">
            Párt keres
          </Badge>
        )}
      </TableCell>
      <TableCell>–</TableCell>
      <TableCell>–</TableCell>
      <TableCell>
        <StatusChips chips={[{ text: "Nincs párja", tone: "todo" }]} />
      </TableCell>
      <TableCell>–</TableCell>
      <TableCell />
    </TableRow>
  );
}

function PairRow({ pair: p, candidates }: { pair: Pair; candidates: Candidate[] }) {
  return (
    <TableRow className={p.status === "dissolved" ? "text-muted-foreground" : undefined}>
      <TableCell className="min-w-56">
        {p.players.map((pl) => (
          <div key={pl.id}>
            <span className="font-medium">{pl.name}</span>
            {pl.level && <span className="text-xs text-muted-foreground"> · {levelLabel(pl.level)}</span>}
            {p.status === "active" && (
              <StatusChips chips={missingChips({ registered: true, level: pl.level, phone: pl.phone, pairs: [] })} />
            )}
          </div>
        ))}
      </TableCell>
      <TableCell>{p.elo ?? "–"}</TableCell>
      <TableCell>{SOURCE_LABELS[p.source]}</TableCell>
      <TableCell>
        <Badge variant={p.status === "active" ? "default" : "outline"}>{p.status === "active" ? "Aktív" : "Felbontva"}</Badge>
      </TableCell>
      <TableCell className="text-sm">
        {p.status === "active" ? <EntryCell pair={p} /> : p.entry ? `${p.entry.season}: ${ENTRY_STATUS_LABELS[p.entry.status]}` : "–"}
      </TableCell>
      <TableCell className="text-right">
        {p.status === "active" && (
          <div className="grid justify-items-end gap-1">
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

export default function LeaguePairs({ loaderData }: Route.ComponentProps) {
  const { name, slug, rows, counts, summary, query, activePairs, candidates, canMail } = loaderData;
  return (
    <AppPage
      title="Párok"
      description={`${name} · ${activePairs} aktív pár, ${candidates.length} regisztrált játékos pár nélkül`}
      actions={<CreateDialog candidates={candidates} />}
    >
      <p className="max-w-2xl text-muted-foreground">
        A játékosok a jelentkezésükben megadott párral indulnak. Minden más változás itt történik. A kihirdetett csoportban
        játszó pár a kör határidejéig nem bontható fel.
      </p>
      <SummaryTable summary={summary} />
      <Filters query={query} counts={counts} slug={slug} canMail={canMail} shown={rows.length} />
      {rows.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">
          {isFiltered(query) ? "Nincs ilyen sor." : "Ebben a ligában még nincs pár."}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table aria-label="Párok listája">
            <TableHeader>
              <TableRow>
                <TableHead>Játékosok</TableHead>
                <TableHead>Kezdő Elo (átlag)</TableHead>
                <TableHead>Forrás</TableHead>
                <TableHead>Állapot</TableHead>
                <TableHead>Nevezés</TableHead>
                <TableHead>
                  <span className="sr-only">Műveletek</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) =>
                r.kind === "pair" ? (
                  <PairRow key={`p${r.pair.id}`} pair={r.pair} candidates={candidates} />
                ) : (
                  <SoloRow key={`s${r.player.id}`} player={r.player} />
                ),
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </AppPage>
  );
}
