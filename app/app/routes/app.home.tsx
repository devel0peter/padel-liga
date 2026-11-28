import { UserRound } from "lucide-react";
import { Link, redirect } from "react-router";

import type { Route } from "./+types/app.home";
import { ActionCard, IconTile, Page, PageHeader, SectionLabel } from "~/components/blocks";
import { ChooseLeague } from "~/components/choose-league";
import { HomeMatches, HomeNextRound, HomeRound, HomeStanding, HomeTodos } from "~/components/home-round";
import { currentPhase, PhaseList } from "~/components/season-calendar";
import { PairLinkBox } from "~/components/pair-link";
import { PartnerSearchBox } from "~/components/partner-search";
import { SeasonEntry } from "~/components/season-entry";
import { TipCard } from "~/components/tip-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getActor } from "~/lib/auth/admin.server";
import { appNav, navLeagues } from "~/lib/auth/permissions";
import { requireUser } from "~/lib/auth/session.server";
import { formatDeadline, formatShortDate, formatWeekdayDate } from "~/lib/format";
import { LEAGUE_PARAM, parseLeagueParam } from "~/lib/league-members";
import { leagueChoices, leagueOffer, playerLeagues } from "~/lib/league-members.server";
import { listLeagues, minEntriesByLeague } from "~/lib/leagues.server";
import { currentGroups } from "~/lib/matches.server";
import { nextRound } from "~/lib/home";
import { greeting } from "~/lib/names";
import { organizerHomeSummary } from "~/lib/organizer-decisions.server";
import { optOutCard } from "~/lib/opt-out.server";
import { pairLinkBoxes, pairLinkPath } from "~/lib/pair-links.server";
import { finderPath } from "~/lib/partner-search";
import { partnerSearchState } from "~/lib/partner-search.server";
import { homeSeasons, isWaiting, waitingText } from "~/lib/seasons";
import { entryCounts, entryViews } from "~/lib/season-entries.server";
import { myLeaguesAction, type MyLeaguesActionData } from "~/lib/my-leagues.server";
import { listSeasons } from "~/lib/seasons.server";
import { withArticle } from "~/lib/groups";
import { SITE_NAME } from "~/lib/site";
import { myStrikes } from "~/lib/strikes.server";
import { vapidPublicKey } from "~/lib/notifications.server";
import { dismissTip, offeredTipIds } from "~/lib/tips.server";

// The app's home (Kezdőlap): where the sidebar logo and a login lead. Once the
// groups are out it says what to do first (#420, mockup P01): the round's
// progress, "Rád vár", the group's standing and the pair's matches. Before
// that the season cards and entry status. The public landing page stays at "/".

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
  const [counts, minimums, organizerSummary] = await Promise.all([
    entryCounts(waiting.map((s) => s.id)),
    minEntriesByLeague([...new Set(waiting.map((s) => s.leagueId))]),
    organizerHomeSummary(actor, now),
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
  // Whether each of those pairs plays on in the next round (#395), in short.
  const next = await Promise.all(
    groups.map(async (g) => {
      const season = shown.find((s) => s.id === g.seasonId);
      const state = season && !isWaiting(season) ? await optOutCard(user.id, season.leagueId, season, now) : null;
      return state ? nextRound(state, g.leagueSlug) : null;
    }),
  );
  return {
    groups,
    next,
    now,
    // "Szia, Anna!" (#419): the first name when the account has one.
    greeting: greeting(user.firstName),
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
      search: searching.get(l.league.id) ?? { seeking: false, listed: false },
      finder: finderPath(mine.find((m) => m.id === l.league.id)?.slug),
    })),
    multiLeague: leagueName.size > 1,
    seasons,
    organizerSummary,
    // The tips offered now (#262), in order; the browser shows the first
    // that applies on the device.
    tips: await offeredTipIds(user.id, now),
    vapidPublicKey: vapidPublicKey(),
    shortcuts: nav.filter((s) => s.label).map((s) => ({ label: s.label, role: s.role, items: s.items.map(({ label, to }) => ({ label, to })) })),
  };
}

// "Nevezünk" on a season card, "Csatlakozom" (#331), and a tip's "Most
// nem" (#262). `season` 0: not about a season card.
export async function action({ request }: Route.ActionArgs): Promise<MyLeaguesActionData> {
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.get("intent") === "dismiss_tip") {
    if (!(await dismissTip(user.id, String(form.get("tip") ?? "")))) throw new Response("Hibás kérés.", { status: 400 });
    return { season: 0, ok: true };
  }
  // "Csatlakozom" (#331, audited) and "Nevezünk": the same as on Ligáim (#394).
  return myLeaguesAction(user, form);
}

// The player's strikes in the season (#294, spec 8): the count, what the 3rd
// means (or that the pair leaves: a player of it has 3, maybe the partner),
// and that the organizer can cancel one.
function StrikeLine({ count, leaving }: { count: number; leaving: boolean }) {
  return (
    <p role="status" className="m-0 rounded-2xl bg-danger-tint p-4 text-sm">
      <span className="font-bold text-danger">Fekete pontjaid ebben a szezonban: {count}.</span>{" "}
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

// A season the player has no group in yet (before the groups are out, or a
// pair that joins later): its dates, the entry and the strikes. Once the
// player's group runs, the round card and Ligáim say all of this (#420).
function SeasonCard({ s, actionData }: { s: SeasonView; actionData: Route.ComponentProps["actionData"] }) {
  const now = s.phases.find((p) => p.number === s.current);
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-lg font-bold">{s.name}</CardTitle>
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
  const [first] = d.groups;
  // A season whose group the player is in shows as the round below; the
  // others keep their card.
  const inGroup = new Set(d.groups.map((g) => g.seasonId));
  const waiting = d.seasons.filter((s) => !inGroup.has(s.id));
  const strikes = d.seasons.filter((s) => inGroup.has(s.id) && (s.strikes.count > 0 || s.strikes.leaving));
  return (
    <Page>
      <PageHeader
        eyebrow={first ? `${first.season} · ${first.league}` : undefined}
        title={d.greeting}
        aside={
          first && (
            <div className="w-[calc(100vw-2rem)] max-w-full md:w-[372px]">
              <HomeRound group={first} now={d.now} />
            </div>
          )
        }
      />
      {d.organizerSummary.total > 0 && (
        <section aria-label="Szervezői teendők" className="grid gap-2 rounded-2xl border border-warning/35 bg-surface px-4 py-3.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              Szervezőként {d.organizerSummary.total} dolog vár rád
            </p>
            {d.organizerSummary.leagues.length === 1 && (
              <Link
                to={`/admin/leagues/${d.organizerSummary.leagues[0]!.slug}`}
                className="font-semibold underline"
              >
                {d.organizerSummary.leagues[0]!.name} megnyitása
              </Link>
            )}
          </div>
          {d.organizerSummary.leagues.length > 1 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {d.organizerSummary.leagues.map((l) => (
                <li key={l.slug}>
                  <Link to={`/admin/leagues/${l.slug}`} className="underline">
                    {l.name} ({l.count})
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {d.choices.length > 0 && <ChooseLeague choices={d.choices} offered={d.offered} />}
      {running && (
        // Phones: one column in reading order (to-dos, standing, matches).
        // Wider: to-dos and matches left, standing and the next round right.
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_384px] lg:items-start lg:gap-x-8">
          <div className="contents lg:flex lg:flex-col lg:gap-7">
            <div className="order-1 flex flex-col gap-3 empty:hidden">
              <HomeTodos groups={d.groups} />
              {strikes.map((s) => (
                <StrikeLine key={s.id} {...s.strikes} />
              ))}
            </div>
            <div className="order-3 flex flex-col gap-5">
              {d.groups.map((g) => (
                <HomeMatches key={g.groupId} group={g} multiLeague={d.multiLeague} />
              ))}
            </div>
          </div>
          <div className="contents lg:flex lg:flex-col lg:gap-5">
            {d.groups.map((g, i) => (
              <div key={g.groupId} className="order-2 flex flex-col gap-5">
                {i > 0 && <HomeRound group={g} now={d.now} />}
                <HomeStanding group={g} multiLeague={d.multiLeague} />
              </div>
            ))}
            {d.next.some(Boolean) && (
              <div className="order-4 hidden flex-col gap-3 lg:flex">
                {d.next.map((n, i) => n && <HomeNextRound key={d.groups[i]!.groupId} next={n} />)}
              </div>
            )}
          </div>
        </div>
      )}
      {d.needsLevel && (
        <ActionCard
          to="/profile?tab=settings#adatok"
          linkLabel="Megadom"
          leading={<IconTile tone="warning"><UserRound /></IconTile>}
          title="Add meg a szinted"
          description="A jelentkezéshez kell a szinted, és innen indul az Élő-pontod."
          className="max-w-2xl"
        />
      )}
      {d.pairLinks.map((l) => (
        <div key={l.url} className="grid gap-4">
          <PairLinkBox url={l.url} league={d.multiLeague ? l.league : undefined} />
          <PartnerSearchBox leagueId={l.leagueId} search={l.search} finder={l.finder} />
        </div>
      ))}
      {waiting.map((s) => (
        <SeasonCard key={s.id} s={s} actionData={actionData} />
      ))}
      {!running && (
        <section className="flex max-w-2xl flex-col gap-1.5 rounded-2xl bg-surface p-4 md:p-5">
          <h2 className="m-0 text-lg font-bold">Hamarosan itt lesz a csoportod</h2>
          <p className="m-0 text-sm text-muted-foreground">
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
        <section key={s.label} className="flex flex-col gap-2.5">
          <SectionLabel>
            {s.label}
            {s.role && <span className="ml-2 rounded-full bg-ball-tint px-1.5 py-px text-[10px] text-ball">{s.role}</span>}
          </SectionLabel>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {s.items.map((i) => (
              <li key={i.to}>
                <Link to={i.to} className="flex min-h-11 items-center rounded-xl bg-surface px-3.5 text-sm text-foreground no-underline transition-colors hover:bg-surface-2">
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Page>
  );
}
