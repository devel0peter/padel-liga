import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

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
import { Textarea } from "~/components/ui/textarea";
import type { LeaguePairRow } from "~/lib/pairs.server";
import { entryChip } from "~/lib/player-status";
import { fromPhase, WITHDRAWAL_REASON_MAX } from "~/lib/season-entries";
import { levelLabel } from "~/lib/signups-admin";

// The organizer's pair actions (#97, #154, #34): "Pár létrehozása", "Partner
// cseréje", "Felbontás", "Benevezés", "Kivétel a szezonból". Párok and the
// Admin's player profile (#301) show the same dialogs. `action`: the address
// they post to (Párok's, from the profile), so both pages run the same
// server functions and checks; the page's own action when left out.

type Pair = LeaguePairRow;
export type Candidate = { id: string; name: string; level: string | null };

const post = (action?: string) => ({ method: "post" as const, ...(action ? { action } : {}) });

export const who = (p: { name: string; level: string | null }) => (p.level ? `${p.name} (${levelLabel(p.level)})` : p.name);

// An active pair's entry in the current or next season (with the round it
// starts in), or that it hasn't entered one that is there; and "Benevezés" or
// "Kivétel a szezonból" (#154).
export function EntryCell({ pair, action }: { pair: Pair; action?: string }) {
  const chip = entryChip(pair);
  const starts =
    pair.entry?.status === "approved" ? (pair.entry.joinsPhase === null ? "a következő szezontól" : fromPhase(pair.entry.joinsPhase)) : null;
  return (
    <div className="grid justify-items-start gap-1">
      {chip ? <StatusChips chips={[chip]} /> : "–"}
      {starts && <span className="text-xs text-muted-foreground">{starts}</span>}
      {pair.entryAction?.kind === "remove" && pair.lockedIn.includes(pair.entryAction.seasonId) ? (
        <WithdrawDialog pair={pair} entry={pair.entryAction} action={action} />
      ) : (
        pair.entryAction && <EntryActionButton pair={pair} entry={pair.entryAction} action={action} />
      )}
    </div>
  );
}

// "Kivétel a szezonból" while the pair plays in the running round (#34): a
// mid-round withdrawal, with a required reason.
function WithdrawDialog({ pair, entry, action }: { pair: Pair; entry: NonNullable<Pair["entryAction"]>; action?: string }) {
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
            lejátszottak is, a többi meccse elmarad, és a pár a szezonból is kikerül ({entry.season}). Később újra
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
              fetcher.submit({ intent: "withdraw", pair: String(pair.id), season: String(entry.seasonId), reason }, post(action))
            }
          >
            Visszaléptetés
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntryActionButton({ pair, entry, action }: { pair: Pair; entry: NonNullable<Pair["entryAction"]>; action?: string }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const [a, b] = pair.players;
  const enter = entry.kind === "enter";
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
                ? `A pár nevezése azonnal érvényes erre a szezonra (${entry.season}), mintha ők nyomták volna meg a „Nevezünk” gombot. Ha a szezon már elindult, a következő körtől játszanak.`
                : `A pár nevezése visszavonódik (${entry.season}), és kimarad minden ezután készülő csoportbeosztásból. A pár megmarad, később újra benevezheted.`}{" "}
              Mindkét játékos értesítést kap az oldalon; e-mailt nem, szólj nekik te.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Mégse</AlertDialogCancel>
            <AlertDialogAction
              variant={enter ? "default" : "destructive"}
              onClick={() =>
                fetcher.submit({ intent: entry.kind, pair: String(pair.id), season: String(entry.seasonId) }, post(action))
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

// "Pár létrehozása". `fixed`: the first player is given (the profile's
// "Párba teszem"); only the partner is chosen.
export function CreateDialog({
  candidates,
  fixed,
  action,
  label = "Pár létrehozása",
}: {
  candidates: Candidate[];
  fixed?: Candidate;
  action?: string;
  label?: string;
}) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(fixed?.id ?? "");
  const [b, setB] = useState("");
  const busy = fetcher.state !== "idle";
  const others = candidates.filter((c) => c.id !== fixed?.id);
  // Closes once the pair is made; stays open with the reason otherwise.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.ok) return;
    setOpen(false);
    setA(fixed?.id ?? "");
    setB("");
  }, [fetcher.state, fetcher.data, fixed?.id]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={fixed ? "outline" : "default"} size={fixed ? "sm" : "default"} disabled={others.length < (fixed ? 1 : 2)}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fixed ? `Párba teszed: ${fixed.name}` : "Pár létrehozása"}</DialogTitle>
          <DialogDescription>
            Két regisztrált játékos, akinek még nincs párja ebben a ligában. Az oldalon és e-mailben is szólunk nekik.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {!fixed && <PlayerSelect name="a" label="Első játékos" candidates={others.filter((c) => c.id !== b)} value={a} onChange={setA} />}
          <PlayerSelect
            name="b"
            label={fixed ? "Partner" : "Második játékos"}
            candidates={others.filter((c) => c.id !== a)}
            value={b}
            onChange={setB}
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
          <Button onClick={() => fetcher.submit({ intent: "create", a, b }, post(action))} disabled={!a || !b || busy}>
            Létrehozás
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DissolveButton({ pair, action }: { pair: Pair; action?: string }) {
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
            <AlertDialogAction variant="destructive" onClick={() => fetcher.submit({ intent: "dissolve", pair: String(pair.id) }, post(action))}>
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

export function ChangeDialog({ pair, candidates, action }: { pair: Pair; candidates: Candidate[]; action?: string }) {
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
            onClick={() => fetcher.submit({ intent: "change", pair: String(pair.id), keep, partner }, post(action))}
            disabled={!partner || busy}
          >
            Csere
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
