import type { Route } from "./+types/pair";
import { AppPage } from "~/components/app-page";
import { PartnerEmailBox } from "~/components/partner-email";
import { ENTERED_NOTICE, SeasonEntry } from "~/components/season-entry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { requireUser } from "~/lib/auth/session.server";
import { pairLeagues, pairOverview } from "~/lib/pairs.server";
import { applyToSeason, entryViews } from "~/lib/season-entries.server";
import { waitingMessage } from "~/lib/signup-partners";
import { missingPartnerEmails, partnerEmailAction, waitingPartners } from "~/lib/signup-partners.server";
import { homeSeasons } from "~/lib/seasons";
import { listSeasons } from "~/lib/seasons.server";
import { CONTACT_EMAIL, SITE_NAME } from "~/lib/site";

// "Párom": the pair (from the interest signup, #89, or made by a Szervező,
// #97), or the partner who hasn't registered yet, or the box to add the
// partner's address when the signup had none (#96), and the league's open
// seasons to enter together (#23). Players can't change their pair here: a
// Szervező does that on the Párok page (#97). One block per league; the
// league is only named when there are several.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Párom – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const leagues = await pairLeagues();
  // The partner the interest signup names, while they haven't registered
  // (#89): the pair forms by itself once they do.
  // Or the partner the signup names without an email (#96): the box to add it.
  const [pairs, waiting, missing] = await Promise.all([
    pairOverview(user, leagues),
    waitingPartners(user.email),
    missingPartnerEmails(user),
  ]);
  const overview = pairs.map((o) => ({
    ...o,
    waiting: o.pair ? null : (waiting.get(o.league.id) ?? null),
    missingEmail: o.pair ? null : (missing.find((m) => m.leagueId === o.league.id) ?? null),
  }));
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
  };
}

type ActionData = { intent: string; error?: string; notice?: string; ok?: true };

// "Nevezünk", and the partner's address (#96).
export async function action({ request }: Route.ActionArgs): Promise<ActionData> {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "partner_email") return { intent, ...(await partnerEmailAction(user, form)) };
  const id = Number(form.get("season") || 0);
  if (intent !== "enter" || !Number.isInteger(id) || id <= 0) throw new Response("Hibás kérés.", { status: 400 });
  const result = await applyToSeason(user, id);
  return result.ok ? { intent, notice: ENTERED_NOTICE } : { intent, error: result.error };
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

function ActivePair({ pair }: { pair: NonNullable<Overview["pair"]> }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardDescription>A párod</CardDescription>
        <CardTitle className="font-display text-xl">{pair.partnerName}</CardTitle>
      </CardHeader>
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

export default function Pair({ loaderData: d, actionData }: Route.ComponentProps) {
  const shown = d.overview.filter((o) => o.pair || o.waiting || o.missingEmail);

  return (
    <AppPage title="Párom" description={`Egy ligában egy párod lehet. Ha változna, írj nekünk: ${CONTACT_EMAIL}`}>
      {actionData?.notice && (
        <p role="status" className="max-w-2xl rounded-md border border-nav-active bg-nav-active-bg p-3 text-sm font-medium">
          {actionData.notice}
        </p>
      )}
      {actionData?.error && (
        <p role="alert" className="max-w-2xl font-semibold text-destructive">
          {actionData.error}
        </p>
      )}
      {d.overview.length === 0 ? (
        <p className="max-w-2xl text-muted-foreground">Még nincs liga, ahol párod lehetne.</p>
      ) : (
        shown.length === 0 && <p className="max-w-2xl text-muted-foreground">Még nincs párod.</p>
      )}
      {shown.map((o) => (
        <section key={o.league.id} className="grid gap-4">
          {d.multi && <h2 className="font-display text-lg font-bold">{o.league.name}</h2>}
          {o.pair && <ActivePair pair={o.pair} />}
          {o.pair && d.entries.some((e) => e.leagueId === o.league.id) && (
            <Entries entries={d.entries.filter((e) => e.leagueId === o.league.id)} />
          )}
          {o.waiting && <Waiting name={o.waiting} />}
          {o.missingEmail && <PartnerEmailBox signupId={o.missingEmail.signupId} name={o.missingEmail.name} />}
        </section>
      ))}
    </AppPage>
  );
}
