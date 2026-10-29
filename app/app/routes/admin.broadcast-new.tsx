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
import { audienceLabel, signupRecipients } from "~/lib/email/audience";
import { SEND_NOW_MAX, TRANSACTIONAL_RESERVE } from "~/lib/email/budget";
import {
  createBroadcast,
  dailyLimit,
  emailSwitchedOff,
  sendTestBroadcast,
  suppressedSet,
} from "~/lib/email/outbox.server";
import { broadcastEmail, NAME_PLACEHOLDER } from "~/lib/email/templates";
import { filterSignups, parseFilters } from "~/lib/signups-admin";
import { listSignups } from "~/lib/signups-admin.server";
import { listCities } from "~/lib/cities.server";

const MAX_SUBJECT = 200;
const MAX_BODY = 20000;

async function audience(params: URLSearchParams) {
  const filters = parseFilters(params);
  const [rows, suppressed, off, cities] = await Promise.all([listSignups(), suppressedSet(), emailSwitchedOff(), listCities()]);
  // Accounts that switched email off get no broadcast either (#115, Peter 2026-10-29).
  const skipped = new Set([...suppressed, ...off]);
  return { label: audienceLabel(filters, cities), ...signupRecipients(filterSignups(rows, filters), skipped) };
}

export async function loader({ request }: Route.LoaderArgs) {
  const actor = await requirePermission(request, { kind: "broadcasts.send" });
  const { label, recipients, suppressed } = await audience(new URL(request.url).searchParams);
  return { label, recipients, suppressed, adminEmail: actor.email, limit: dailyLimit() };
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
  await createBroadcast({ subject, body, audience: label, recipients, createdBy: actor.email });
  return redirect("/admin/broadcasts");
}

export default function AdminBroadcastNew({ loaderData }: Route.ComponentProps) {
  const { label, recipients, suppressed, adminEmail, limit } = loaderData;
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
            <Link to={`/admin/signups?${params.toString()}`}>Szűrők módosítása</Link>
          </Button>
        </div>
        <p className="mt-2 text-muted-foreground">
          Csak a jelentkezőnek megy, a megadott párnak nem (adatkezelési tájékoztató).
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
                    „{subject}” · {label}. Az első {SEND_NOW_MAX} levél most megy ki, a többi óránként, a napi limit szerint. Nem lehet
                    visszavonni.
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
