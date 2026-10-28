import { Send, Trash2 } from "lucide-react";
import { Form, useNavigation } from "react-router";

import type { Route } from "./+types/admin.outbox";
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
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { requirePermission } from "~/lib/auth/admin.server";
import { kindLabel, parseKind } from "~/lib/email/hold";
import { dailyLimit, deliver, discardHeld, listHeld, releaseHeld } from "~/lib/email/outbox.server";
import { SITE_NAME } from "~/lib/site";

// "Kimenő levelek" (#88): every email but login codes and signup
// confirmations waits here until the Admin sends or discards it, per kind.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Kimenő levelek – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "outbox.manage" });
  return { held: await listHeld(), limit: dailyLimit() };
}

type ActionData = { notice?: string };

export async function action({ request }: Route.ActionArgs): Promise<ActionData> {
  await requirePermission(request, { kind: "outbox.manage" });
  const form = await request.formData();
  const intent = form.get("intent");
  const kind = parseKind(form.get("kind"));
  const upTo = Number(form.get("upTo"));
  if ((intent !== "send" && intent !== "discard") || !kind || !Number.isInteger(upTo) || upTo <= 0)
    throw new Response("Hibás kérés.", { status: 400 });

  if (intent === "discard") {
    const n = await discardHeld(kind, upTo);
    return { notice: n > 0 ? `Elvetettél ${n} levelet.` : "Ebből már nincs visszatartott levél." };
  }
  const { released, skipped } = await releaseHeld(kind, upTo);
  const dropped = skipped > 0 ? ` ${skipped} leiratkozott vagy nem kézbesíthető címre nem megy.` : "";
  if (released === 0) return { notice: `Ebből már nincs visszatartott levél.${dropped}` };
  // A cron run right away, so it doesn't wait for the next hour; the daily
  // quota still decides how much goes out today.
  const { sent } = await deliver();
  const later = sent < released ? " Ami ma nem fér bele, a következő napokon megy." : "";
  return { notice: `${released} levél a sorban, most ${sent} ment ki.${later}${dropped}` };
}

type Held = Route.ComponentProps["loaderData"]["held"][number];

function Confirm({ held, intent, limit }: { held: Held; intent: "send" | "discard"; limit: number }) {
  const busy = useNavigation().state !== "idle";
  const send = intent === "send";
  const label = kindLabel(held.kind);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={send ? "default" : "outline"} disabled={busy}>
          {send ? <Send /> : <Trash2 />}
          {send ? "Küldés" : "Elvetés"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{send ? "Elküldöd?" : "Elveted?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {send
              ? `${held.count} levél (${label}) indul. Naponta legfeljebb ${limit} levél megy ki; ami ma nem fér bele, a következő napokon megy.`
              : `${held.count} levél (${label}) törlődik, és nem megy ki. Nem lehet visszavonni.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Mégse</AlertDialogCancel>
          <Form method="post">
            <input type="hidden" name="intent" value={intent} />
            <input type="hidden" name="kind" value={held.kind} />
            <input type="hidden" name="upTo" value={held.upTo} />
            <AlertDialogAction variant={send ? "default" : "destructive"} type="submit">
              {send ? "Küldés" : "Elvetés"}
            </AlertDialogAction>
          </Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function AdminOutbox({ loaderData, actionData }: Route.ComponentProps) {
  const { held, limit } = loaderData;
  return (
    <AppPage
      title="Kimenő levelek"
      description="Csak a belépőkód és a jelentkezés visszaigazolása megy ki magától. A többi levél itt vár, amíg el nem küldöd."
    >
      {actionData?.notice && (
        <p role="status" className="rounded-md border border-nav-active bg-nav-active-bg p-3 text-sm font-medium">
          {actionData.notice}
        </p>
      )}

      {held.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">Nincs visszatartott levél.</p>
      ) : (
        <div className="grid max-w-3xl gap-4">
          {held.map((h) => (
            <Card key={h.kind}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 font-display text-lg">
                  {kindLabel(h.kind)}
                  <Badge variant="secondary">{h.count} levél</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p className="text-muted-foreground">Az egyik levél (a címek elrejtve):</p>
                <div className="rounded-md border bg-muted/40 p-3">
                  <p className="font-semibold">{h.subject}</p>
                  <pre className="mt-2 max-h-64 overflow-auto font-sans text-sm whitespace-pre-wrap">{h.text}</pre>
                </div>
              </CardContent>
              <CardFooter className="flex flex-wrap gap-2">
                <Confirm held={h} intent="send" limit={limit} />
                <Confirm held={h} intent="discard" limit={limit} />
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </AppPage>
  );
}
