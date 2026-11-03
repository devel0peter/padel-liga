import { useState } from "react";
import { data, useFetcher } from "react-router";

import type { Route } from "./+types/admin.league-reminders";
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
} from "~/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDateTime } from "~/lib/format";
import { getLeague } from "~/lib/leagues.server";
import { SITUATION_LABELS, SITUATIONS } from "~/lib/reminders";
import { reminderOverview, setReminders } from "~/lib/reminders.server";
import { SITE_NAME } from "~/lib/site";

// Emlékeztetők (#155): the league's switch for the automatic reminders to
// people stuck before entering, off by default. Before it is on, the page
// shows how many each reminder would reach now and a preview of each with a
// real recipient's data (no address, no pair link token); then what went out.

export function meta() {
  return [{ title: `Emlékeztetők – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

async function scope(request: Request, slug: string) {
  const league = await getLeague(slug);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league, actor };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league } = await scope(request, params.league);
  return { name: league.name, ...(await reminderOverview(league)) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor } = await scope(request, params.league);
  const form = await request.formData();
  if (form.get("intent") !== "switch") throw new Response("Ismeretlen művelet.", { status: 400 });
  await setReminders(actor.id, league, form.get("on") === "1");
  return { ok: true };
}

export default function AdminLeagueReminders({ loaderData }: Route.ComponentProps) {
  const { on, onSince, due, previews, sent, season } = loaderData;
  const fetcher = useFetcher();
  const [confirming, setConfirming] = useState(false);
  const pending = fetcher.formData?.get("on");
  const shownOn = pending != null ? pending === "1" : on;
  const backlog = SITUATIONS.reduce((n, s) => n + due[s], 0);
  const submit = (next: boolean) => fetcher.submit({ intent: "switch", on: next ? "1" : "0" }, { method: "post" });

  return (
    <AppPage
      title="Emlékeztetők"
      description="Egy automatikus levél annak, aki elakadt a nevezés előtt. Szezononként mindenki legfeljebb egyet kap, bármelyik helyzetben van."
    >
      <Card className="max-w-2xl">
        <CardHeader className="gap-3">
          <CardTitle className="font-display text-lg">Automatikus emlékeztetők</CardTitle>
          <div className="flex items-center gap-3">
            <Switch
              id="reminders-switch"
              checked={shownOn}
              onCheckedChange={(next) => (next ? setConfirming(true) : submit(false))}
            />
            <Label htmlFor="reminders-switch" className="text-base">
              {shownOn ? "Bekapcsolva" : "Kikapcsolva"}
            </Label>
          </div>
          <CardDescription className="text-foreground">
            {shownOn
              ? `Óránként megnézzük, kinek jár emlékeztető, és kiküldjük.${onSince ? ` Bekapcsolva: ${formatDateTime(new Date(onSince))}.` : ""}`
              : "Bekapcsolás után a következő óránkénti futás kiküldi annak, akinek most jár."}{" "}
            {season ? `Szezon: ${season}.` : "Most nincs nevezhető szezon, ezért nem megy ki semmi."}
          </CardDescription>
        </CardHeader>
      </Card>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bekapcsolod az emlékeztetőket?</AlertDialogTitle>
            <AlertDialogDescription>
              {backlog > 0
                ? `A következő óránkénti futás ${backlog} embernek küld emlékeztetőt, utána mindenkinek, aki elakad.`
                : "Most senkinek nem jár emlékeztető; aki elakad, a következő futásoknál kap."}{" "}
              Elküldött levelet nem lehet visszavonni.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Mégse</AlertDialogCancel>
            <AlertDialogAction onClick={() => submit(true)}>Bekapcsolom</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Table aria-label="Emlékeztetők helyzetenként">
        <TableHeader>
          <TableRow>
            <TableHead>Helyzet</TableHead>
            <TableHead className="text-right">Most kapná</TableHead>
            <TableHead className="text-right">Elindult</TableHead>
            <TableHead>Utoljára</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SITUATIONS.map((s) => (
            <TableRow key={s}>
              <TableCell className="whitespace-normal">{SITUATION_LABELS[s]}</TableCell>
              <TableCell className="text-right tabular-nums">{due[s]}</TableCell>
              <TableCell className="text-right tabular-nums">{sent[s].emails}</TableCell>
              <TableCell className="whitespace-normal text-muted-foreground">
                {sent[s].last ? formatDateTime(new Date(sent[s].last)) : "–"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Így néznek ki</h2>
        {previews.length === 0 ? (
          <p className="text-sm text-muted-foreground">Most senkinek nem jár emlékeztető, ezért nincs mit mutatni.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {previews.map((p) => (
              <Card key={p.situation}>
                <CardHeader>
                  <CardDescription>{SITUATION_LABELS[p.situation]}</CardDescription>
                  <CardTitle className="text-base">{p.subject}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap break-words text-sm">{p.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Egy valódi címzett adataival; az e-mail-cím és a párlink rejtve. Nem kap emlékeztetőt, aki leiratkozott, akinek
          visszapattant a levele, aki kikapcsolta az e-mailt, akinél be van kapcsolva a „Párt keresek”, a már nevezett
          párok, az Admin, és aki ebben a szezonban már kapott emlékeztetőt.
        </p>
      </section>
    </AppPage>
  );
}
