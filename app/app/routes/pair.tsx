import { Mail, Phone } from "lucide-react";
import { Link } from "react-router";
import type { Route } from "./+types/pair";
import { AppPage } from "~/components/app-page";
import { PairLinkBox } from "~/components/pair-link";
import { PartnerSearchBox } from "~/components/partner-search";
import { enteredNotice, SeasonEntry } from "~/components/season-entry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { requireUser } from "~/lib/auth/session.server";
import { telHref } from "~/lib/matches";
import { pairLinkBoxes, pairLinkPath } from "~/lib/pair-links.server";
import { partnerSearchState, setPartnerSearch } from "~/lib/partner-search.server";
import { NO_PAIR_TEXT, PAIR_LINK_ACCEPTED, pairPageDescription } from "~/lib/pairs";
import { NO_LEAGUE_TEXT } from "~/lib/league-members";
import { playerLeagues } from "~/lib/league-members.server";
import { pairOverview } from "~/lib/pairs.server";
import { pairPath } from "~/lib/profiles";
import { profilePairIds } from "~/lib/profiles.server";
import { applyToSeason, entryViews } from "~/lib/season-entries.server";
import { homeSeasons } from "~/lib/seasons";
import { listSeasons } from "~/lib/seasons.server";
import { CONTACT_EMAIL, SITE_NAME } from "~/lib/site";

// "Párom": the pair (by pair link, or made by a Szervező, #97) and the
// league's open seasons to enter together (#23). Without a pair: the
// player's own pair link to send to a partner (2026-10-31), and the "Párt
// keresek" switch (D59) for the organizer to find them one. The partner's
// address and phone (D121) so the two can reach each other. Players can't
// change their pair here: a Szervező does that on the Párok page (#97). One
// block per league of the player (D127); the league is only named when there
// are several. Nothing comes from the interest list (#333).

export function meta({}: Route.MetaArgs) {
  return [{ title: `Párom – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  // Only the player's own leagues (D127, #331).
  const leagues = await playerLeagues(user.id);
  // Without a pair: the player's own link to invite one.
  const [pairs, links, searching] = await Promise.all([
    pairOverview(user, leagues),
    pairLinkBoxes(user, leagues),
    partnerSearchState(user, leagues),
  ]);
  const origin = new URL(request.url).origin;
  // The pair's profile (#36, members only: D112), once it has been in a published group.
  const open = await profilePairIds(pairs.flatMap((o) => (o.pair ? [o.pair.id] : [])));
  const overview = pairs.map((o) => {
    const link = o.pair ? undefined : links.find((l) => l.league.id === o.league.id);
    return {
      ...o,
      profile: o.pair && open.has(o.pair.id) ? pairPath(o.pair.id) : null,
      link: link ? origin + pairLinkPath(link.token) : null,
      seeking: o.pair ? null : (searching.get(o.league.id) ?? false),
    };
  });
  // The seasons the home page shows (the current or next one per league),
  // with this pair's entry or the "Nevezünk" button.
  const now = new Date();
  const ids = new Set(leagues.map((l) => l.id));
  const seasons = homeSeasons((await listSeasons()).filter((s) => ids.has(s.leagueId)), now);
  const views = await entryViews(user, seasons, now);
  return {
    // Just accepted a pair link.
    joined: new URL(request.url).searchParams.has("joined"),
    multi: leagues.length > 1,
    hasPair: overview.some((o) => o.pair),
    overview,
    entries: seasons.flatMap((s) => {
      const view = views.get(s.id);
      return view ? [{ id: s.id, name: s.name, leagueId: s.leagueId, view }] : [];
    }),
  };
}

type ActionData = { intent: string; error?: string; notice?: string; ok?: true };

// "Nevezünk" and "Párt keresek" (D59).
export async function action({ request }: Route.ActionArgs): Promise<ActionData> {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "partner_search") {
    const league = Number(form.get("league"));
    const ok = await setPartnerSearch(user, league, form.get("seeking") === "1", await playerLeagues(user.id));
    if (!ok) throw new Response("Hibás kérés.", { status: 400 });
    return { intent, ok: true };
  }
  const id = Number(form.get("season") || 0);
  if (intent !== "enter" || !Number.isInteger(id) || id <= 0) throw new Response("Hibás kérés.", { status: 400 });
  const result = await applyToSeason(user, id);
  return result.ok ? { intent, notice: enteredNotice(result.joins) } : { intent, error: result.error };
}

type Overview = Route.ComponentProps["loaderData"]["overview"][number];
type Entry = Route.ComponentProps["loaderData"]["entries"][number];

function Entries({ entries }: { entries: Entry[] }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-lg">Nevezés</CardTitle>
        <CardDescription>Elég, ha egyikőtök nevez: a nevezés azonnal érvényes, mindkettőtöknek.</CardDescription>
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

function ActivePair({ pair, profile }: { pair: NonNullable<Overview["pair"]>; profile: string | null }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardDescription>A párod</CardDescription>
        <CardTitle className="font-display text-xl">{pair.partnerName}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <ul aria-label="A párod elérhetősége" className="grid gap-1">
          <li className="min-w-0">
            <a href={`mailto:${pair.partnerEmail}`} className="inline-flex max-w-full items-center gap-1.5 underline">
              <Mail className="size-4 shrink-0" />
              <span className="break-all">{pair.partnerEmail}</span>
            </a>
          </li>
          <li className="min-w-0">
            {pair.partnerPhone ? (
              <a href={telHref(pair.partnerPhone)} className="inline-flex items-center gap-1.5 underline">
                <Phone className="size-4 shrink-0" />
                {pair.partnerPhone}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Phone className="size-4 shrink-0" />
                Nincs megadva telefonszám
              </span>
            )}
          </li>
        </ul>
        {profile && (
          <Link to={profile} className="font-semibold underline">
            A párotok oldala
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

// Under the pair link, for those with nobody to invite.
function NoPair() {
  return (
    <div className="grid max-w-2xl gap-1 text-sm">
      <p className="text-muted-foreground">
        {NO_PAIR_TEXT}{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
          {CONTACT_EMAIL}
        </a>
      </p>
    </div>
  );
}

export default function Pair({ loaderData: d, actionData }: Route.ComponentProps) {
  return (
    <AppPage title="Párom" description={pairPageDescription(d.hasPair, CONTACT_EMAIL)}>
      {d.joined && !actionData && (
        <p role="status" className="max-w-2xl rounded-md border border-nav-active bg-nav-active-bg p-3 text-sm font-medium">
          {PAIR_LINK_ACCEPTED}
        </p>
      )}
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
      {d.overview.length === 0 && (
        <p className="max-w-2xl text-muted-foreground">
          {NO_LEAGUE_TEXT}{" "}
          <Link to="/home" className="underline">
            Kezdőlap
          </Link>
        </p>
      )}
      {d.overview.map((o) => (
        <section key={o.league.id} className="grid gap-4">
          {d.multi && <h2 className="font-display text-lg font-bold">{o.league.name}</h2>}
          {o.pair && <ActivePair pair={o.pair} profile={o.profile} />}
          {o.pair && d.entries.some((e) => e.leagueId === o.league.id) && (
            <Entries entries={d.entries.filter((e) => e.leagueId === o.league.id)} />
          )}
          {o.link && <PairLinkBox url={o.link} />}
          {o.seeking != null && <PartnerSearchBox leagueId={o.league.id} seeking={o.seeking} />}
          {!o.pair && <NoPair />}
        </section>
      ))}
    </AppPage>
  );
}
