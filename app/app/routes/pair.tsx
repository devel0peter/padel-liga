import { Form, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/pair";
import { AppPage } from "~/components/app-page";
import { ENTERED_NOTICE, SeasonEntry } from "~/components/season-entry";
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
import { applyToSeason, entryViews } from "~/lib/season-entries.server";
import { waitingMessage } from "~/lib/signup-partners";
import { waitingPartners } from "~/lib/signup-partners.server";
import { homeSeasons } from "~/lib/seasons";
import { listSeasons } from "~/lib/seasons.server";
import { SITE_NAME } from "~/lib/site";

// "Párom" (#21): invite a partner by email, answer invites, see and dissolve
// the pair, and enter the league's open seasons together (#23). One block per
// league; the league is only named when there are several.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Párom – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const leagues = await pairLeagues();
  // The partner the interest signup names, while they haven't registered
  // (#89): the pair forms by itself once they do.
  const [pairs, waiting] = await Promise.all([pairOverview(user, leagues), waitingPartners(user.email)]);
  const overview = pairs.map((o) => ({ ...o, waiting: o.pair ? null : (waiting.get(o.league.id) ?? null) }));
  // The seasons the home page shows (the current or next one per league),
  // with this pair's entry or the "Nevezünk" button.
  const now = new Date();
  const ids = new Set(leagues.map((l) => l.id));
  const seasons = homeSeasons((await listSeasons()).filter((s) => ids.has(s.leagueId)), now);
  const views = await entryViews(user, seasons, now);
  return {
    multi: leagues.length > 1,
    overview,
    entries: seasons.flatMap((s) => {
      const view = views.get(s.id);
      return view ? [{ id: s.id, name: s.name, leagueId: s.leagueId, view }] : [];
    }),
    // Leagues where this player can send an invite now.
    inviteLeagues: overview.filter((o) => !o.pair && !o.sent).map((o) => o.league),
  };
}

type ActionData = { intent: string; error?: string; notice?: string };

const NOTICES: Record<string, string> = {
  invite: "Meghívtad. Ha belép, itt látja a meghívót.",
  cancel: "Visszavontad a meghívót.",
  accept: "Elfogadtad: mostantól pár vagytok.",
  decline: "Jeleztük neki, hogy nem kéred.",
  dissolve: "Megszüntetted a párt.",
  enter: ENTERED_NOTICE,
};

export async function action({ request }: Route.ActionArgs): Promise<ActionData> {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = Number(form.get(intent === "enter" ? "season" : "id") || 0);
  const needsId = intent !== "invite";
  if (!Object.hasOwn(NOTICES, intent) || (needsId && (!Number.isInteger(id) || id <= 0)))
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
  else if (intent === "enter") result = await applyToSeason(user, id);
  else result = await dissolvePair(user, id);
  return result.ok ? { intent, notice: NOTICES[intent] } : { intent, error: result.error };
}

type Overview = Route.ComponentProps["loaderData"]["overview"][number];
type Entry = Route.ComponentProps["loaderData"]["entries"][number];

function Entries({ entries }: { entries: Entry[] }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-lg">Nevezés</CardTitle>
        <CardDescription>Elég, ha egyikőtök nevez. A szervező döntését itt látjátok.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {entries.map((e) => (
          <section key={e.id} className="grid gap-2">
            <h3 className="font-semibold">{e.name}</h3>
            <SeasonEntry seasonId={e.id} view={e.view} />
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

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

function ActivePair({ pair, entered }: { pair: NonNullable<Overview["pair"]>; entered: boolean }) {
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
                  {pair.partnerName} és te nem lesztek többé pár; ő is itt látja.
                  {entered && " A szezonnevezésetek is visszavonódik, ha még nem kezdtetek el játszani."} Utána új
                  párt hívhatsz meg.
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

function Waiting({ name }: { name: string }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-lg">{waitingMessage(name)}</CardTitle>
      </CardHeader>
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
          {formatShortDate(new Date(sent.createdAt))} óta vár a válaszára. Ha elfogadja, itt látod.
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
        <CardDescription>Írd be az e-mail-címét. Ha még nincs fiókja, ezzel a címmel regisztrálhat.</CardDescription>
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
  const answered = params.get("answered") ?? "";
  const notice = actionData?.notice ?? (Object.hasOwn(ANSWERED, answered) ? ANSWERED[answered] : undefined);
  const inviteError = actionData?.intent === "invite" ? actionData.error : undefined;
  const otherError = actionData?.intent !== "invite" ? actionData?.error : undefined;
  const shown = d.overview.filter((o) => o.pair || o.waiting || o.sent || o.received.length > 0);

  return (
    <AppPage
      title="Párom"
      description="Egy ligában egy párod lehet. Az e-mail-címével hívod meg, és akkor lesztek pár, ha elfogadja."
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
          {o.pair && (
            <ActivePair
              pair={o.pair}
              entered={d.entries.some(
                (e) => e.leagueId === o.league.id && e.view.kind === "status" && (e.view.status === "pending" || e.view.status === "approved"),
              )}
            />
          )}
          {o.pair && d.entries.some((e) => e.leagueId === o.league.id) && (
            <Entries entries={d.entries.filter((e) => e.leagueId === o.league.id)} />
          )}
          {o.waiting && <Waiting name={o.waiting} />}
          {o.sent && <Sent sent={o.sent} />}
        </section>
      ))}
      {d.inviteLeagues.length > 0 && <InviteForm leagues={d.inviteLeagues} error={inviteError} />}
    </AppPage>
  );
}
