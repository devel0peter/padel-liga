import { Link } from "react-router";

import type { Route } from "./+types/app.home";
import { AppPage } from "~/components/app-page";
import { PhaseList } from "~/components/season-calendar";
import { ENTERED_NOTICE, SeasonEntry } from "~/components/season-entry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getActor } from "~/lib/auth/admin.server";
import { appNav, navLeagues } from "~/lib/auth/permissions";
import { requireUser } from "~/lib/auth/session.server";
import { formatDeadline, formatShortDate } from "~/lib/format";
import { listedCities } from "~/lib/cities.server";
import { listLeagues } from "~/lib/leagues.server";
import { homeSeasons } from "~/lib/seasons";
import { applyToSeason, entryViews } from "~/lib/season-entries.server";
import { listSeasons } from "~/lib/seasons.server";
import { SITE_NAME } from "~/lib/site";

// The app's home (Kezdőlap): where the sidebar logo and a login lead. For now
// a greeting and shortcuts; with the season it becomes "your group, your next
// match". The public landing page stays at "/".

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
  const seasons = shown.map((s) => ({
    id: s.id,
    name: s.name,
    league: leagueName.get(s.leagueId)!,
    registrationOpensAt: s.registrationOpensAt,
    registrationClosesAt: s.registrationClosesAt,
    phases: s.phases,
    entry: views.get(s.id) ?? null,
  }));
  return {
    // Accounts from before the level was asked for: nudge them to the profile.
    needsLevel: !user.level,
    seasons,
    shortcuts: nav.filter((s) => s.label).map((s) => ({ label: s.label, role: s.role, items: s.items.map(({ label, to }) => ({ label, to })) })),
  };
}

// "Nevezünk" on a season card.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const season = Number(form.get("season") || 0);
  if (form.get("intent") !== "enter" || !Number.isInteger(season) || season <= 0)
    throw new Response("Hibás kérés.", { status: 400 });
  const result = await applyToSeason(user, season);
  return result.ok ? { season, notice: ENTERED_NOTICE } : { season, error: result.error };
}

export default function AppHome({ loaderData: d, actionData }: Route.ComponentProps) {
  return (
    <AppPage title="Kezdőlap">
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
