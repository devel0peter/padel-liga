import { Form, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/pair";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { requireUser } from "~/lib/auth/session.server";
import { formatShortDate } from "~/lib/format";
import { DISSOLVE_REFUSED } from "~/lib/pairs";
import { answerInvite, cancelInvite, createInvite, dissolvePair, pairLeagues, pairOverview } from "~/lib/pairs.server";
import { SITE_NAME } from "~/lib/site";

// "Párom" (#21): invite a partner by email, answer invites, see and dissolve
// the pair. One block per league; the league is only named when there are
// several.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Párom – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const leagues = await pairLeagues();
  const overview = await pairOverview(user, leagues);
  return {
    multi: leagues.length > 1,
    overview,
    // Leagues where this player can send an invite now.
    inviteLeagues: overview.filter((o) => !o.pair && !o.sent).map((o) => o.league),
  };
}

type ActionData = { intent: string; error?: string; notice?: string };

const NOTICES: Record<string, string> = {
  invite: "Elküldtük a meghívót.",
  cancel: "Visszavontad a meghívót.",
  accept: "Elfogadtad: mostantól pár vagytok.",
  decline: "Jeleztük neki, hogy nem kéred.",
  dissolve: "Megszüntetted a párt.",
};

export async function action({ request }: Route.ActionArgs): Promise<ActionData> {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = Number(form.get("id") || 0);
  const needsId = intent !== "invite";
  if (!(intent in NOTICES) || (needsId && (!Number.isInteger(id) || id <= 0)))
    throw new Response("Hibás kérés.", { status: 400 });

  let result: { ok: true } | { ok: false; error: string };
  if (intent === "invite") {
    const leagues = await pairLeagues();
    const leagueId = Number(form.get("league") || leagues[0]?.id);
    const league = leagues.find((l) => l.id === leagueId);
    if (!league) return { intent, error: "Válassz ligát." };
    result = await createInvite(user, league, String(form.get("email") ?? ""));
  } else if (intent === "cancel") result = await cancelInvite(user, id);
  else if (intent === "accept" || intent === "decline") result = await answerInvite(user, id, intent);
  else result = await dissolvePair(user, id);
  return result.ok ? { intent, notice: NOTICES[intent] } : { intent, error: result.error };
}

type Overview = Route.ComponentProps["loaderData"]["overview"][number];

function Received({ invite }: { invite: Overview["received"][number] }) {
  const busy = useNavigation().state !== "idle";
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-lg">{invite.inviterName} meghívott párnak</CardTitle>
        <CardDescription>{formatShortDate(new Date(invite.createdAt))}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form method="post" className="flex flex-wrap gap-2">
          <input type="hidden" name="id" value={invite.id} />
          <Button type="submit" name="intent" value="accept" disabled={busy}>
            Elfogadom
          </Button>
          <Button type="submit" name="intent" value="decline" variant="outline" disabled={busy}>
            Nem kérem
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}

function ActivePair({ pair }: { pair: NonNullable<Overview["pair"]> }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardDescription>A párod</CardDescription>
        <CardTitle className="font-display text-xl">{pair.partnerName}</CardTitle>
      </CardHeader>
      <CardContent>
        {pair.canDissolve ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Pár megszüntetése</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Megszünteted a párt?</AlertDialogTitle>
                <AlertDialogDescription>
                  {pair.partnerName} és te nem lesztek többé pár. Utána új párt hívhatsz meg.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Mégse</AlertDialogCancel>
                <Form method="post">
                  <input type="hidden" name="intent" value="dissolve" />
                  <input type="hidden" name="id" value={pair.id} />
                  <AlertDialogAction variant="destructive" type="submit">
                    Megszüntetés
                  </AlertDialogAction>
                </Form>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <p className="text-sm text-muted-foreground">{DISSOLVE_REFUSED}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Sent({ sent }: { sent: NonNullable<Overview["sent"]> }) {
  const busy = useNavigation().state !== "idle";
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-lg">Meghívtad: {sent.email}</CardTitle>
        <CardDescription>
          {formatShortDate(new Date(sent.createdAt))} óta vár a válaszára. Ha elfogadja, e-mailt kapsz.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form method="post">
          <input type="hidden" name="id" value={sent.id} />
          <Button type="submit" name="intent" value="cancel" variant="outline" disabled={busy}>
            Visszavonás
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}

function InviteForm({ leagues, error }: { leagues: Overview["league"][]; error?: string }) {
  const busy = useNavigation().state !== "idle";
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-lg">Hívd meg a párodat</CardTitle>
        <CardDescription>Írd be az e-mail-címét. Ha még nincs fiókja, a levélből be tud lépni.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form method="post" className="grid gap-4">
          <input type="hidden" name="intent" value="invite" />
          {leagues.length > 1 ? (
            <div className="grid gap-1.5">
              <Label htmlFor="league">Liga</Label>
              <Select name="league" defaultValue={String(leagues[0].id)}>
                <SelectTrigger id="league" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {leagues.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <input type="hidden" name="league" value={leagues[0].id} />
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="email">A párod e-mail-címe</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="off"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "email-error" : undefined}
            />
            {error && (
              <p id="email-error" className="text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
          </div>
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? "Küldés…" : "Meghívó küldése"}
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}

const ANSWERED: Record<string, string> = {
  accept: NOTICES.accept,
  decline: NOTICES.decline,
};

export default function Pair({ loaderData: d, actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  // After answering on the emailed link's page (pair-invite.tsx).
  const notice = actionData?.notice ?? ANSWERED[params.get("answered") ?? ""];
  const inviteError = actionData?.intent === "invite" ? actionData.error : undefined;
  const otherError = actionData?.intent !== "invite" ? actionData?.error : undefined;
  const shown = d.overview.filter((o) => o.pair || o.sent || o.received.length > 0);

  return (
    <AppPage
      title="Párom"
      description="Egy ligában egy párod lehet. E-mailben hívod meg, és akkor lesztek pár, ha elfogadja."
    >
      {notice && !actionData?.error && (
        <p role="status" className="max-w-2xl rounded-md border border-nav-active bg-nav-active-bg p-3 text-sm font-medium">
          {notice}
        </p>
      )}
      {otherError && (
        <p role="alert" className="max-w-2xl font-semibold text-destructive">
          {otherError}
        </p>
      )}
      {d.overview.length === 0 && (
        <p className="max-w-2xl text-muted-foreground">Még nincs liga, ahol párt alkothatnál.</p>
      )}
      {shown.map((o) => (
        <section key={o.league.id} className="grid gap-4">
          {d.multi && <h2 className="font-display text-lg font-bold">{o.league.name}</h2>}
          {o.received.map((r) => (
            <Received key={r.id} invite={r} />
          ))}
          {o.pair && <ActivePair pair={o.pair} />}
          {o.sent && <Sent sent={o.sent} />}
        </section>
      ))}
      {d.inviteLeagues.length > 0 && <InviteForm leagues={d.inviteLeagues} error={inviteError} />}
    </AppPage>
  );
}
