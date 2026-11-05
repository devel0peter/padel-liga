import { Link, type ShouldRevalidateFunctionArgs } from "react-router";

import type { Route } from "./+types/app.home";
import { AppPage } from "~/components/app-page";
import { MyGroup, Todos, todos } from "~/components/my-group";
import { PhaseList } from "~/components/season-calendar";
import { PairLinkBox } from "~/components/pair-link";
import { PartnerSearchBox } from "~/components/partner-search";
import { PartnerEmailBox } from "~/components/partner-email";
import { enteredNotice, SeasonEntry } from "~/components/season-entry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getActor } from "~/lib/auth/admin.server";
import { appNav, navLeagues } from "~/lib/auth/permissions";
import { requireUser } from "~/lib/auth/session.server";
import { formatDeadline, formatShortDate } from "~/lib/format";
import { listedCities } from "~/lib/cities.server";
import { listLeagues } from "~/lib/leagues.server";
import { currentGroups } from "~/lib/matches.server";
import { pairLinkBoxes, pairLinkPath } from "~/lib/pair-links.server";
import { partnerSearchState } from "~/lib/partner-search.server";
import { homeSeasons } from "~/lib/seasons";
import { applyToSeason, entryViews } from "~/lib/season-entries.server";
import { listSeasons } from "~/lib/seasons.server";
import { missingPartnerEmails, partnerEmailAction } from "~/lib/signup-partners.server";
import { SITE_NAME } from "~/lib/site";
import { myStrikes } from "~/lib/strikes.server";

// The app's home (Kezdőlap): where the sidebar logo and a login lead. Once the
// groups are out it is "your group and your matches" (#25): the Teendők, the
// group and its matches by week. Before that the season cards and entry
// status. The public landing page stays at "/".

// After the partner's address is saved (#96) the box stays to say so: no
// reload, which would remove it before the notice shows.
export function shouldRevalidate({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  return formData?.get("intent") === "partner_email" ? false : defaultShouldRevalidate;
}

export function meta({}: Route.MetaArgs) {
  return [{ title: `Kezdőlap – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const actor = (await getActor(request))!;
  const leagues = await listLeagues();
  const nav = appNav(actor, navLeagues(actor, actor.platformRole === "superadmin" ? leagues : []));
  // Players don't belong to a league yet: the seasons of every league in a
  // listed city (a city still being set up stays hidden).
  const listed = new Set((await listedCities()).map((c) => c.slug));
  const leagueName = new Map(leagues.filter((l) => listed.has(l.city)).map((l) => [l.id, l.name]));
  const now = new Date();
  const shown = homeSeasons(await listSeasons(), now).filter((s) => leagueName.has(s.leagueId));
  // The pair's entry, the "Nevezünk" button or why not (#23).
  const views = await entryViews(user, shown, now);
  // The player's own strikes (#294): only here and nowhere public.
  const strikes = new Map((await myStrikes(user.id)).map(({ seasonId, ...s }) => [seasonId, s]));
  const seasons = shown.map((s) => ({
    id: s.id,
    name: s.name,
    league: leagueName.get(s.leagueId)!,
    registrationOpensAt: s.registrationOpensAt,
    registrationClosesAt: s.registrationClosesAt,
    phases: s.phases,
    entry: views.get(s.id) ?? null,
    strikes: strikes.get(s.id) ?? { count: 0, leaving: false },
  }));
  // No pair in a league: the player's own link to invite one (2026-10-31),
  // first thing after the first-login page, and "Párt keresek" (D59).
  const links = await pairLinkBoxes(user);
  const searching = await partnerSearchState(user, links.map((l) => l.league));
  // The current phase's groups (#25): empty before they are published.
  const groups = await currentGroups(user.id, now);
  return {
    groups,
    // Accounts from before the level was asked for: nudge them to the profile.
    needsLevel: !user.level,
    // The signup named a partner without an email (#96): the box to add it.
    missingEmails: (await missingPartnerEmails(user)).map(({ signupId, name }) => ({ signupId, name })),
    pairLinks: links.map((l) => ({
      leagueId: l.league.id,
      league: l.league.name,
      url: new URL(request.url).origin + pairLinkPath(l.token),
      seeking: searching.get(l.league.id) ?? false,
    })),
    multiLeague: leagueName.size > 1,
    seasons,
    shortcuts: nav.filter((s) => s.label).map((s) => ({ label: s.label, role: s.role, items: s.items.map(({ label, to }) => ({ label, to })) })),
  };
}

// "Nevezünk" on a season card, and the partner's address (#96).
// `season` 0: not about a season card (the box's fetcher reads its own result).
export async function action({ request }: Route.ActionArgs): Promise<{ season: number; error?: string; notice?: string; ok?: true }> {
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.get("intent") === "partner_email") return { season: 0, ...(await partnerEmailAction(user, form)) };
  const season = Number(form.get("season") || 0);
  if (form.get("intent") !== "enter" || !Number.isInteger(season) || season <= 0)
    throw new Response("Hibás kérés.", { status: 400 });
  const result = await applyToSeason(user, season);
  return result.ok ? { season, notice: enteredNotice(result.joins) } : { season, error: result.error };
}

// The player's strikes in the season (#294, spec 8): the count, what the 3rd
// means (or that the pair leaves: a player of it has 3, maybe the partner),
// and that the organizer can cancel one.
function StrikeLine({ count, leaving }: { count: number; leaving: boolean }) {
  return (
    <p role="status" className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <span className="font-semibold">Fekete pontjaid ebben a szezonban: {count}.</span>{" "}
      {leaving
        ? "A párod és te a kör végén kikerültök a ligából; a következő szezonban újra nevezhettek."
        : "A 3.-nál a párod és te a kör végén kikerültök a ligából."}{" "}
      Ha betegség vagy pályalemondás miatt kaptad, szólj a szervezőnek.{" "}
      <Link to="/rules#section-5" className="underline">
        Szabályzat
      </Link>
    </p>
  );
}

export default function AppHome({ loaderData: d, actionData }: Route.ComponentProps) {
  return (
    <AppPage title="Kezdőlap">
      {d.groups.length > 0 && <Todos items={todos(d.groups)} />}
      {d.groups.map((g) => (
        <MyGroup key={g.groupId} group={g} multiLeague={d.multiLeague} />
      ))}
      {d.needsLevel && (
        <section role="status" className="grid max-w-2xl gap-2 rounded-lg border border-nav-active bg-nav-active-bg p-6">
          <h2 className="font-display text-lg font-bold">Add meg a szinted</h2>
          <p>
            A jelentkezéshez kell a szinted, és innen indul az értékszámod.{" "}
            <Link to="/profile#adatok" className="font-semibold underline">
              Megadom a profilomban
            </Link>
          </p>
        </section>
      )}
      {d.pairLinks.map((l) => (
        <div key={l.url} className="grid gap-4">
          <PairLinkBox url={l.url} league={d.multiLeague ? l.league : undefined} />
          <PartnerSearchBox leagueId={l.leagueId} seeking={l.seeking} />
        </div>
      ))}
      {d.missingEmails.map((m) => (
        <PartnerEmailBox key={m.signupId} signupId={m.signupId} name={m.name} />
      ))}
      {d.seasons.map((s) => (
        <Card key={s.id} className="max-w-2xl">
          <CardHeader>
            <CardTitle className="font-display text-lg">{s.name}</CardTitle>
            <CardDescription>{s.league}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>
              <span className="font-medium">Nevezés:</span> {formatShortDate(s.registrationOpensAt)} –{" "}
              {formatDeadline(s.registrationClosesAt)}
            </p>
            <PhaseList phases={s.phases} />
            {(s.strikes.count > 0 || s.strikes.leaving) && <StrikeLine {...s.strikes} />}
            {actionData?.season === s.id && (
              <p
                role={actionData.error ? "alert" : "status"}
                className={actionData.error ? "font-semibold text-destructive" : "font-medium"}
              >
                {actionData.error ?? actionData.notice}
              </p>
            )}
            {s.entry && !(actionData?.season === s.id && actionData.notice) && (
              <SeasonEntry seasonId={s.id} view={s.entry} />
            )}
          </CardContent>
        </Card>
      ))}
      {d.groups.length === 0 && (
        <section className="grid max-w-2xl gap-2 rounded-lg border border-dashed p-6">
          <h2 className="font-display text-lg font-bold">Hamarosan itt lesz a csoportod</h2>
        <p className="text-muted-foreground">
          Amint indul a szezon, itt látod a csoportodat, a következő meccsedet és az eredményeket. Addig a{" "}
          <Link to="/rules" className="underline">
            szabályzatot
          </Link>{" "}
          érdemes átfutni.
        </p>
        </section>
      )}
      {d.shortcuts.map((s) => (
        <section key={s.label} className="grid gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            {s.label}
            {s.role && (
              <span className="rounded-full bg-nav-active-bg px-1.5 py-px text-[10px] font-semibold tracking-wide text-nav-active uppercase">
                {s.role}
              </span>
            )}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {s.items.map((i) => (
              <li key={i.to}>
                <Link to={i.to} className="inline-block rounded-md border px-3 py-1.5 text-sm no-underline hover:bg-accent">
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </AppPage>
  );
}
