import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/app.home";
import { AppPage } from "~/components/app-page";
import { GroupStanding, NextMatch, Todos, todos } from "~/components/my-group";
import { currentPhase, PhaseList } from "~/components/season-calendar";
import { PairLinkBox } from "~/components/pair-link";
import { PartnerSearchBox } from "~/components/partner-search";
import { enteredNotice, SeasonEntry } from "~/components/season-entry";
import { TipCard } from "~/components/tip-card";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getActor } from "~/lib/auth/admin.server";
import { appNav, navLeagues } from "~/lib/auth/permissions";
import { requireUser } from "~/lib/auth/session.server";
import { formatDeadline, formatShortDate, formatWeekdayDate } from "~/lib/format";
import {
  CHOOSE_LEAGUE_BUTTON,
  CHOOSE_LEAGUE_TEXT,
  CHOOSE_LEAGUE_TITLE,
  LEAGUE_PARAM,
  OFFER_LEAGUE_TEXT,
  OFFER_LEAGUE_TITLE,
  parseLeagueParam,
} from "~/lib/league-members";
import { chooseLeague, leagueChoices, leagueOffer, playerLeagues } from "~/lib/league-members.server";
import { listLeagues, minEntriesByLeague } from "~/lib/leagues.server";
import { currentGroups } from "~/lib/matches.server";
import { pairLinkBoxes, pairLinkPath } from "~/lib/pair-links.server";
import { partnerSearchState } from "~/lib/partner-search.server";
import { homeSeasons, isWaiting, waitingText } from "~/lib/seasons";
import { applyToSeason, entryCounts, entryViews } from "~/lib/season-entries.server";
import { listSeasons } from "~/lib/seasons.server";
import { withArticle } from "~/lib/groups";
import { SITE_NAME } from "~/lib/site";
import { myStrikes } from "~/lib/strikes.server";
import { vapidPublicKey } from "~/lib/notifications.server";
import { dismissTip, offeredTipIds } from "~/lib/tips.server";

// The app's home (Kezdőlap): where the sidebar logo and a login lead. Once the
// groups are out it is "your group and your matches" (#25): the Teendők, the
// group and its matches by week. Before that the season cards and entry
// status. The public landing page stays at "/".

export function meta({}: Route.MetaArgs) {
  return [{ title: `Kezdőlap – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  // Through a league's register button while logged in already (the login
  // page sends a logged-in visitor straight here): the card offers that
  // league, and "Csatlakozom" joins it; nothing is joined on this GET. A
  // member already, or an unknown league: a clean address. (A new account
  // joined at login, D128.)
  const url = new URL(request.url);
  const offer = url.searchParams.has(LEAGUE_PARAM) ? await leagueOffer(user.id, parseLeagueParam(url.searchParams.get(LEAGUE_PARAM))) : null;
  if (url.searchParams.has(LEAGUE_PARAM) && !offer) throw redirect("/home");
  const actor = (await getActor(request))!;
  const leagues = await listLeagues();
  const nav = appNav(actor, navLeagues(actor, actor.platformRole === "superadmin" ? leagues : []));
  // Only the player's own leagues (D128, #331): their seasons, pair links and
  // "Párt keresek". In none: the card to choose one.
  const mine = await playerLeagues(user.id);
  const leagueName = new Map(mine.map((l) => [l.id, l.name]));
  const now = new Date();
  const choices = offer ? [offer] : mine.length === 0 ? await leagueChoices(user.id, now) : [];
  const shown = homeSeasons(await listSeasons(), now).filter((s) => leagueName.has(s.leagueId));
  // The pair's entry, the "Nevezünk" button or why not (#23).
  const views = await entryViews(user, shown, now);
  // The player's own strikes (#294): only here and nowhere public.
  const strikes = new Map((await myStrikes(user.id)).map(({ seasonId, ...s }) => [seasonId, s]));
  // A first season waiting for its minimum entries (D124): how many are still needed.
  const waiting = shown.filter(isWaiting);
  const [counts, minimums] = await Promise.all([
    entryCounts(waiting.map((s) => s.id)),
    minEntriesByLeague([...new Set(waiting.map((s) => s.leagueId))]),
  ]);
  const seasons = shown.map((s) => ({
    id: s.id,
    name: s.name,
    league: leagueName.get(s.leagueId)!,
    registrationOpensAt: s.registrationOpensAt,
    registrationClosesAt: s.registrationClosesAt,
    waiting: isWaiting(s) ? waitingText(counts.get(s.id) ?? 0, minimums.get(s.leagueId) ?? 0) : null,
    startsAtMinimum: s.startsAtMinimum,
    phases: s.phases,
    // The round being played, marked in the list (D139).
    current: currentPhase(s.phases, now),
    entry: views.get(s.id) ?? null,
    strikes: strikes.get(s.id) ?? { count: 0, leaving: false },
  }));
  // No pair in a league: the player's own link to invite one (2026-10-31),
  // first thing after the first-login page, and "Párt keresek" (D59).
  const links = await pairLinkBoxes(user, mine);
  const searching = await partnerSearchState(user, links.map((l) => l.league));
  // The current phase's groups (#25): empty before they are published.
  const groups = await currentGroups(user.id, now);
  return {
    groups,
    // For the match links in the Írj mindenkinek text (D147).
    origin: new URL(request.url).origin,
    // "Melyik ligában játszol?" (#331): empty once they belong to a league.
    choices: choices.map((c) => ({ id: c.id, city: c.cityName, name: c.name })),
    // The register button's league, rather than "which one".
    offered: !!offer,
    // Accounts from before the level was asked for: nudge them to the profile.
    needsLevel: !user.level,
    pairLinks: links.map((l) => ({
      leagueId: l.league.id,
      league: l.league.name,
      url: new URL(request.url).origin + pairLinkPath(l.token),
      seeking: searching.get(l.league.id) ?? false,
    })),
    multiLeague: leagueName.size > 1,
    seasons,
    // The tips offered now (#262), in order; the browser shows the first
    // that applies on the device.
    tips: await offeredTipIds(user.id, now),
    vapidPublicKey: vapidPublicKey(),
    shortcuts: nav.filter((s) => s.label).map((s) => ({ label: s.label, role: s.role, items: s.items.map(({ label, to }) => ({ label, to })) })),
  };
}

// "Nevezünk" on a season card, "Csatlakozom" (#331), and a tip's "Most
// nem" (#262). `season` 0: not about a season card.
export async function action({ request }: Route.ActionArgs): Promise<{ season: number; error?: string; notice?: string; ok?: true }> {
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.get("intent") === "dismiss_tip") {
    if (!(await dismissTip(user.id, String(form.get("tip") ?? "")))) throw new Response("Hibás kérés.", { status: 400 });
    return { season: 0, ok: true };
  }
  // "Csatlakozom" on "Melyik ligában játszol?" (#331), audited.
  if (form.get("intent") === "join_league") {
    if (!(await chooseLeague(user.id, Number(form.get("league"))))) throw new Response("Hibás kérés.", { status: 400 });
    return { season: 0, ok: true };
  }
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
        ? "A pároddal a kör végén kikerültök a ligából; a következő szezonban újra nevezhettek."
        : "A harmadiknál a pároddal a kör végén kikerültök a ligából."}{" "}
      Ha betegség vagy pályalemondás miatt kaptad, szólj a szervezőnek.{" "}
      <Link to="/rules#section-5" className="underline">
        Szabályzat
      </Link>
    </p>
  );
}

// "Melyik ligában játszol?" (#331): for an account in no league, one row per
// league with a season open for entries or running.
function ChooseLeague({ choices, offered }: { choices: { id: number; city: string; name: string }[]; offered: boolean }) {
  const busy = useNavigation().state !== "idle";
  return (
    <Card className="max-w-2xl border-nav-active">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="font-display text-lg">{offered ? OFFER_LEAGUE_TITLE : CHOOSE_LEAGUE_TITLE}</CardTitle>
        <CardDescription>{offered ? OFFER_LEAGUE_TEXT : CHOOSE_LEAGUE_TEXT}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3">
          {choices.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <span className="font-semibold">{c.city}</span>
                <span className="block text-sm text-muted-foreground">{c.name}</span>
              </span>
              <Form method="post">
                <input type="hidden" name="intent" value="join_league" />
                <input type="hidden" name="league" value={c.id} />
                <Button type="submit" disabled={busy}>
                  {CHOOSE_LEAGUE_BUTTON}
                </Button>
              </Form>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

type SeasonView = Route.ComponentProps["loaderData"]["seasons"][number];

// The season's dates: the entry window or the start, and the rounds.
function SeasonDates({ s }: { s: SeasonView }) {
  return (
    <>
      {s.waiting ? (
        <p>
          <span className="font-medium">Indulás:</span> {s.waiting}
        </p>
      ) : s.startsAtMinimum || !s.registrationClosesAt ? (
        // Started at the minimum entries (D124): no deadline, only the start.
        s.phases[0] && (
          <p>
            <span className="font-medium">Indul:</span> {formatWeekdayDate(new Date(s.phases[0].startsAt))}
          </p>
        )
      ) : (
        <p>
          <span className="font-medium">Nevezés:</span> {formatShortDate(s.registrationOpensAt)} – {formatDeadline(s.registrationClosesAt)}
        </p>
      )}
      <PhaseList phases={s.phases} current={s.current} />
    </>
  );
}

// A season: its dates with the round being played marked, entry and
// strikes. Once it runs (`running`) it opens Kezdőlap as the season's summary
// (docs/player-ui.md H6, D139, D143): the round being played and its deadline
// under the title.
function SeasonCard({ s, running, actionData }: { s: SeasonView; running: boolean; actionData: Route.ComponentProps["actionData"] }) {
  const now = s.phases.find((p) => p.number === s.current);
  return (
    <Card size={running ? "sm" : "default"} className={running ? undefined : "max-w-2xl"}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">{s.name}</CardTitle>
        <CardDescription>
          {s.league}
          {now && ` · most ${withArticle(now.number)} kör megy, határidő: ${formatDeadline(new Date(now.deadline))}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <SeasonDates s={s} />
        {(s.strikes.count > 0 || s.strikes.leaving) && <StrikeLine {...s.strikes} />}
        {actionData?.season === s.id && (
          <p role={actionData.error ? "alert" : "status"} className={actionData.error ? "font-semibold text-destructive" : "font-medium"}>
            {actionData.error ?? actionData.notice}
          </p>
        )}
        {s.entry && !(actionData?.season === s.id && actionData.notice) && <SeasonEntry seasonId={s.id} view={s.entry} />}
      </CardContent>
    </Card>
  );
}

export default function AppHome({ loaderData: d, actionData }: Route.ComponentProps) {
  const running = d.groups.length > 0;
  const open = todos(d.groups);
  return (
    <AppPage title="Kezdőlap">
      {d.choices.length > 0 && <ChooseLeague choices={d.choices} offered={d.offered} />}
      {running && (
        // Separate cards (D136, D140, D143): the season's summary, what to do,
        // the next match; our group on the right.
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <div className="grid gap-6">
            {d.seasons.map((s) => (
              <SeasonCard key={s.id} s={s} running actionData={actionData} />
            ))}
            {open.length > 0 && <Todos items={open} />}
            {d.groups.map((g) => (
              <NextMatch key={g.groupId} group={g} multiLeague={d.multiLeague} origin={d.origin} />
            ))}
          </div>
          <div className="grid gap-6">
            {d.groups.map((g) => (
              <GroupStanding key={g.groupId} group={g} multiLeague={d.multiLeague} />
            ))}
          </div>
        </div>
      )}
      {d.needsLevel && (
        <section role="status" className="grid max-w-2xl gap-2 rounded-lg border border-nav-active bg-nav-active-bg p-6">
          <h2 className="font-display text-lg font-bold">Add meg a szinted</h2>
          <p>
            A jelentkezéshez kell a szinted, és innen indul az Élő-pontod.{" "}
            <Link to="/profile?tab=settings#adatok" className="font-semibold underline">
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
      {!running && d.seasons.map((s) => <SeasonCard key={s.id} s={s} running={false} actionData={actionData} />)}
      {!running && (
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
      {d.tips.length > 0 && <TipCard offered={d.tips} vapidPublicKey={d.vapidPublicKey} />}
      {d.shortcuts.map((s) => (
        <section key={s.label} className="grid gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            {s.label}
            {s.role && (
              <span className="rounded-full bg-nav-active-bg px-1.5 py-px text-[10px] font-semibold tracking-wide text-nav-active uppercase">{s.role}</span>
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
