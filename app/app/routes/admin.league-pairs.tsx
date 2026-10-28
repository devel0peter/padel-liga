import { useEffect, useState } from "react";
import { data, useFetcher } from "react-router";

import type { Route } from "./+types/admin.league-pairs";
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
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { getLeague } from "~/lib/leagues.server";
import { DISSOLVE_REFUSED, SOURCE_LABELS } from "~/lib/pairs";
import { changePartner, createPair, dissolvePair, leaguePairs, pairCandidates } from "~/lib/pairs.server";
import { ENTRY_FILTERS, type EntryStatus } from "~/lib/season-entries";
import { levelLabel } from "~/lib/signups-admin";
import { SITE_NAME } from "~/lib/site";

// Párok (#97): the Szervező of the league (or the Admin) creates, dissolves
// and changes pairs. Players can't change their pair themselves. No email
// goes out: the organizer tells the players. Names and levels only, never an
// email address or phone number.

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
  const { league } = await scope(request, params.league);
  const [pairs, candidates] = await Promise.all([leaguePairs(league.id), pairCandidates(league.id)]);
  return { name: league.name, pairs, candidates };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor } = await scope(request, params.league);
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  const pairId = Number(field("pair"));
  const intent = field("intent");
  let result: { ok: true } | { ok: false; error: string };
  if (intent === "create") result = await createPair(actor.id, league.id, field("a"), field("b"));
  else if ((intent === "dissolve" || intent === "change") && Number.isInteger(pairId) && pairId > 0)
    result =
      intent === "dissolve"
        ? await dissolvePair(actor.id, league.id, pairId)
        : await changePartner(actor.id, league.id, pairId, field("keep"), field("partner"));
  else throw new Response("Hibás kérés.", { status: 400 });
  return result.ok ? { ok: true as const } : { error: result.error };
}

type Pair = Route.ComponentProps["loaderData"]["pairs"][number];
type Candidate = Route.ComponentProps["loaderData"]["candidates"][number];

const ENTRY_LABELS: Record<EntryStatus, string> = { ...ENTRY_FILTERS, withdrawn: "Visszavonva" };

const who = (p: { name: string; level: string | null }) => (p.level ? `${p.name} (${levelLabel(p.level)})` : p.name);

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
          <DialogDescription>Két regisztrált játékos, akinek még nincs párja ebben a ligában.</DialogDescription>
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
            A mostani pár felbomlik, és {kept.name} új párt alkot. {leaving.name} pár nélkül marad. Nem kapnak róla e-mailt;
            szólj nekik te.
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

export default function LeaguePairs({ loaderData }: Route.ComponentProps) {
  const { name, pairs, candidates } = loaderData;
  const active = pairs.filter((p) => p.status === "active").length;
  return (
    <AppPage
      title="Párok"
      description={`${name} · ${active} aktív pár, ${candidates.length} regisztrált játékos pár nélkül`}
      actions={<CreateDialog candidates={candidates} />}
    >
      <p className="max-w-2xl text-muted-foreground">
        A játékosok a jelentkezésükben megadott párral indulnak. Minden más változás itt történik. Kör közben a csoportban
        játszó pár nem bontható fel, a kör határidejéig.
      </p>
      {pairs.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">Ebben a ligában még nincs pár.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
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
              {pairs.map((p) => (
                <TableRow key={p.id} className={p.status === "dissolved" ? "text-muted-foreground" : undefined}>
                  <TableCell className="min-w-56">
                    {p.players.map((pl) => (
                      <div key={pl.id}>
                        <span className="font-medium">{pl.name}</span>
                        {pl.level && <span className="text-xs text-muted-foreground"> · {levelLabel(pl.level)}</span>}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell>{p.elo ?? "–"}</TableCell>
                  <TableCell>{SOURCE_LABELS[p.source]}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === "active" ? "default" : "outline"}>
                      {p.status === "active" ? "Aktív" : "Felbontva"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{p.entry ? `${p.entry.season}: ${ENTRY_LABELS[p.entry.status]}` : "–"}</TableCell>
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppPage>
  );
}
