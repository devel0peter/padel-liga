import { useState } from "react";
import { Link, redirect, useFetcher, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.broadcast-new";
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
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { requirePermission } from "~/lib/auth/admin.server";
import { SEND_NOW_MAX, TRANSACTIONAL_RESERVE } from "~/lib/email/budget";
import {
  createBroadcast,
  dailyLimit,
  emailSwitchedOff,
  sendTestBroadcast,
  suppressedSet,
} from "~/lib/email/outbox.server";
import { broadcastEmail, NAME_PLACEHOLDER } from "~/lib/email/templates";
import { getLeague } from "~/lib/leagues.server";
import type { Recipient } from "~/lib/email/audience";
import { pairsQueryString, parsePairsQuery, RETIRED_NO_PAIR } from "~/lib/league-pairs-view";
import { leaguePairsAudience } from "~/lib/league-pairs-view.server";
import { parsePlayersQuery, playersPath, playersQueryString } from "~/lib/league-players";
import { leaguePlayersAudience, recipientsOf } from "~/lib/league-players.server";
import { adminProfilePath } from "~/lib/player-admin";

const MAX_SUBJECT = 200;
const MAX_BODY = 20000;

type Found = { label: string; people: Recipient[]; back: { to: string; label: string; note: string } };

// Who the page writes to (the interest list's audiences went, #333, D129):
// "Levél nekik" on Párok (?pairs=, #148, D64) or on Játékosok (?players=,
// #301) for the rows they show, or "Levél neki" on a player's profile
// (?user=, #301). Without one the page has nobody to write to.
async function findAudience(params: URLSearchParams): Promise<Found> {
  const user = params.get("user");
  if (user) {
    const people = await recipientsOf([user]);
    if (people.length === 0) throw new Response("Nincs ilyen fiók.", { status: 404 });
    return {
      label: people[0]!.name || "Egy játékos",
      people,
      back: { to: adminProfilePath(user), label: "Vissza az adatlapra", note: "Csak ő kapja." },
    };
  }
  const slug = params.get("players") ?? params.get("pairs");
  if (slug === null) throw redirect("/admin/broadcasts");
  const league = await getLeague(slug);
  if (!league) throw new Response("Nincs ilyen liga.", { status: 404 });
  if (params.has("players")) {
    const query = parsePlayersQuery(params);
    return {
      ...(await leaguePlayersAudience(league, query)),
      back: { to: playersPath(league.slug, query), label: "Szűrők módosítása", note: "A Játékosok oldalon látott játékosok kapják, mindenki egyszer." },
    };
  }
  // Párok's "Nincs párja" moved to Játékosok (#301): an old link must not
  // fall back to every pair (the filter is unknown to Párok now).
  if (params.get("entry") === RETIRED_NO_PAIR) {
    const moved = playersQueryString({ filter: "no_pair", q: params.get("q")?.trim() ?? "" });
    throw redirect(`/admin/broadcasts/new?players=${encodeURIComponent(league.slug)}&${moved}`);
  }
  const query = parsePairsQuery(params);
  const back = pairsQueryString(query);
  return {
    ...(await leaguePairsAudience(league, query)),
    back: {
      to: `/admin/leagues/${league.slug}/pairs${back ? `?${back}` : ""}`,
      label: "Szűrők módosítása",
      note: "A Párok oldalon látott játékosok kapják, mindenki egyszer.",
    },
  };
}

async function audience(params: URLSearchParams) {
  const [{ label, people, back }, suppressed, off] = await Promise.all([findAudience(params), suppressedSet(), emailSwitchedOff()]);
  // Unsubscribed or bounced addresses, and accounts that switched email off, get nothing (#115).
  const recipients = people.filter((p) => !suppressed.has(p.email) && !off.has(p.email));
  return { label, recipients, suppressed: people.length - recipients.length, back };
}

export async function loader({ request }: Route.LoaderArgs) {
  const actor = await requirePermission(request, { kind: "broadcasts.send" });
  const found = await audience(new URL(request.url).searchParams);
  const { label, recipients, suppressed } = found;
  const { back } = found;
  return { label, recipients, suppressed, back, adminEmail: actor.email, limit: dailyLimit() };
}

type ActionData = { error?: string; tested?: string };

export async function action({ request }: Route.ActionArgs): Promise<ActionData | Response> {
  const actor = await requirePermission(request, { kind: "broadcasts.send" });
  const form = await request.formData();
  const subject = String(form.get("subject") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  if (!subject || subject.length > MAX_SUBJECT) return { error: "Adj meg egy tárgyat (legfeljebb 200 karakter)." };
  if (!body || body.length > MAX_BODY) return { error: "Írd meg a levelet." };

  if (form.get("intent") === "test") {
    const result = await sendTestBroadcast({ subject, body }, { email: actor.email, name: "Teszt Elek" });
    return result.ok ? { tested: actor.email } : { error: `Nem ment ki a tesztlevél: ${result.error}` };
  }

  // Recomputed from the same filters, so the list is current at send time.
  const { label, recipients } = await audience(new URL(request.url).searchParams);
  if (recipients.length === 0) return { error: "Nincs címzett." };
  // Sent right away, within the daily limit (#112); the rest by the cron.
  await createBroadcast({ subject, body, audience: label, recipients, createdBy: actor.email, actorId: actor.id });
  return redirect("/admin/broadcasts");
}

export default function AdminBroadcastNew({ loaderData }: Route.ComponentProps) {
  const { label, recipients, suppressed, back, adminEmail, limit } = loaderData;
  const [params] = useSearchParams();
  const fetcher = useFetcher<ActionData>();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(`Szia ${NAME_PLACEHOLDER}!\n\n`);
  const busy = fetcher.state !== "idle";
  const ready = subject.trim() !== "" && body.trim() !== "";

  const preview = broadcastEmail({ subject, body }, { name: recipients[0]?.name ?? "Teszt Elek" }, "#");
  const submit = (intent: string) =>
    fetcher.submit({ intent, subject, body }, { method: "post", action: `/admin/broadcasts/new?${params}` });
  const perDay = limit - TRANSACTIONAL_RESERVE;

  return (
    <AppPage title="Új körlevél" back={{ to: "/admin/broadcasts", label: "Körlevelek" }}>

      <div className="rounded-lg border p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <strong>Címzettek:</strong> {label} · {recipients.length} cím
            {suppressed > 0 && ` (${suppressed} címet kihagyunk: leiratkozott, nem kézbesíthető, vagy kikapcsolta az e-mailt)`}
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to={back.to}>{back.label}</Link>
          </Button>
        </div>
        <p className="mt-2 text-muted-foreground">
          {back.note}
          {recipients.length > perDay &&
            ` Naponta legfeljebb ${perDay} körlevél megy ki, a többi a következő napokon.`}
        </p>
        {recipients.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer">Lista</summary>
            <p className="mt-1 text-muted-foreground">
              {recipients.map((r) => `${r.name} <${r.email}>`).join(", ")}
            </p>
          </details>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="grid content-start gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="subject">Tárgy</Label>
            <Input id="subject" value={subject} maxLength={MAX_SUBJECT} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="body">Levél</Label>
            <Textarea
              id="body"
              value={body}
              maxLength={MAX_BODY}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-72"
            />
            <p className="text-xs text-muted-foreground">
              Sima szöveg. Üres sor = új bekezdés, a linkek kattinthatók lesznek. A{" "}
              <code>{NAME_PLACEHOLDER}</code> helyére a címzett neve kerül. A lábléc (leiratkozás,
              adatkezelés) automatikus.
            </p>
          </div>

          {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
          {fetcher.data?.tested && !busy && (
            <p className="text-sm">Tesztlevél elküldve ide: {fetcher.data.tested}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!ready || busy} onClick={() => submit("test")}>
              Tesztlevél nekem ({adminEmail})
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={!ready || busy || recipients.length === 0}>
                  Küldés {recipients.length} címzettnek
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Elküldöd {recipients.length} címzettnek?</AlertDialogTitle>
                  <AlertDialogDescription>
                    „{subject}” · {label}. A levelek a háttérben mennek ki: az első {SEND_NOW_MAX} most, a többi tízpercenként, a napi
                    limit szerint. Hogy hol tart, a Kimenő levelek oldalon látod. Nem lehet visszavonni.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Mégse</AlertDialogCancel>
                  <AlertDialogAction onClick={() => submit("send")}>Küldés</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="grid content-start gap-1.5">
          <Label>Előnézet</Label>
          <div className="text-sm">
            <span className="text-muted-foreground">Tárgy:</span> {preview.subject}
          </div>
          <iframe title="Előnézet" srcDoc={preview.html} sandbox="" className="h-[32rem] w-full rounded-lg border bg-white" />
        </div>
      </div>
    </AppPage>
  );
}
