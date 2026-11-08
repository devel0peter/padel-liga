import type { Division } from "@padel-liga/rules";
import { ListOrdered, Medal } from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/league";
import { AppPage } from "~/components/app-page";
import { FixtureList } from "~/components/fixture-list";
import { HelpTip } from "~/components/help-tip";
import { LadderScroller } from "~/components/ladder-scroller";
import { StandingsLegend, StandingsTable } from "~/components/standings-table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "~/components/ui/sheet";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { DIVISION_DOT } from "~/lib/division-colors";
import type { LadderGroup } from "~/lib/ladder";
import { withArticle } from "~/lib/groups";
import { requireUser } from "~/lib/auth/session.server";
import { ladderPage, pairIdsOf } from "~/lib/ladder.server";
import { pairPath } from "~/lib/profiles";
import { SITE_NAME } from "~/lib/site";

// The league page, the player's "Tabella" (#30, spec section 14): the phase's
// groups top-down, each a card with its division and its table; the group's
// matches open in a side panel (D136). The groups sit one under the other in
// a list that scrolls on its own, the one in the middle full size, the
// viewer's group there on load (D143). For logged-in players only, inside the app
// shell (D134): a visitor goes to the login page and comes back. Names only:
// no email or phone is selected anywhere on the way here, and no rating.
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const page = await ladderPage(params.league ?? "", new Date(), await pairIdsOf(user.id));
  if (!page) throw new Response("Nincs ilyen liga.", { status: 404 });
  return page;
}

// Not for search engines or link previews (D134): a title only.
export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `Tabella: ${loaderData?.league.name ?? "liga"} – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function GroupCard({ group, division, label }: { group: LadderGroup; division: Division; label: string }) {
  const count = group.weeks.reduce((n, w) => n + w.matches.length, 0);
  return (
    <Card role="region" aria-label={`${group.number}. csoport`} className={group.mine ? "ring-2 ring-nav-active/60" : undefined}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">{group.number}. csoport</CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          <span aria-hidden className={`size-2 rounded-full ${DIVISION_DOT[division]}`} />
          {label}
        </CardDescription>
        {group.mine && (
          <CardAction>
            <Badge variant="secondary">A ti csoportotok</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-2">
        <StandingsTable rows={group.rows} ranked={group.ranked} linkFor={pairPath} label={`${group.number}. csoport tabellája`} legend={false} />
        {group.withdrawn.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Visszalépett: {group.withdrawn.map((names) => names.join(" – ")).join(", ")}. A meccseik nem számítanak.
          </p>
        )}
        {/* The matches open in a side panel (D136): the page under it stays put. */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full">
              <ListOrdered aria-hidden />A csoport meccsei ({count})
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full gap-0 sm:max-w-lg">
            <SheetHeader className="border-b pr-12">
              <SheetTitle className="font-display text-lg font-bold">{group.number}. csoport meccsei</SheetTitle>
              <SheetDescription>{label}</SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto p-4">
              <FixtureList weeks={group.weeks} label={`${group.number}. csoport meccsei`} />
            </div>
          </SheetContent>
        </Sheet>
      </CardContent>
    </Card>
  );
}

const POINTS: [title: string, text: string][] = [
  ["Egyetlen létra", "Az összes csoport egy nagy létrát alkot: az 1. csoport a legerősebb, lefelé egyre könnyebbek."],
  ["A divíziók a létra harmadai", "Felül a Bronz, középen a Réz, alul a Rookie divízió. Ez csak címke: a meccseidet, a feljutást és a kiesést nem érinti."],
  ["Egy fel, egy le", "A kör végén a csoport első helyezettje feljebb lép, az utolsó lejjebb kerül."],
];

// "Hogyan működik a létra?" behind the "?" by the title (D138).
function Explainer() {
  return (
    <HelpTip label="Hogyan működik a létra?">
      <p className="font-semibold">Hogyan működik a létra?</p>
      <ol className="grid list-decimal gap-1.5 pl-5">
        {POINTS.map(([title, text]) => (
          <li key={title}>
            <strong>{title}.</strong> {text}
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground">
        Részletesen a <Link to="/rules">szabályzatban</Link>.
      </p>
    </HelpTip>
  );
}

export default function League({ loaderData: page }: Route.ComponentProps) {
  const groups = page.kind === "ladder" ? page.bands.flatMap((band) => band.groups.map((g) => ({ g, band }))) : [];
  const focus = Math.max(0, groups.findIndex(({ g }) => g.mine));
  const where = [page.league.name, page.season].filter(Boolean).join(" · ");
  if (page.kind === "waiting")
    return (
      <AppPage title="Tabella" description={where}>
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">Még nincsenek kint a csoportok</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              {page.starting ??
                (page.next
                  ? `${capitalize(withArticle(page.next.round))} kör ${page.next.startsOn} indul. A csoportok az indulás előtt kerülnek ki ide.`
                  : "A következő szezon időpontja hamarosan kiderül.")}
            </p>
          </CardContent>
        </Card>
      </AppPage>
    );
  return (
    <AppPage
      title="Tabella"
      help={<Explainer />}
      actions={
        // The Ranglista (D137): one tap from the Tabella, also on a phone.
        <Button asChild variant="outline" size="sm">
          <Link to="rankings" relative="path" className="no-underline">
            <Medal aria-hidden />
            Ranglista
          </Link>
        </Button>
      }
      description={
        <>
          {where} · {page.started ? `${page.phase}. kör, ${page.week}. hét (${page.weekFrom} – ${page.weekTo})` : `${page.phase}. kör, indul ${page.startsOn}`}
        </>
      }
    >
      <StandingsLegend />
      {/* Down the ladder, one group under the other (D143); each card names its division. */}
      <LadderScroller
        label="Csoportok"
        focus={focus}
        items={groups.map(({ g, band }) => ({ key: g.number, node: <GroupCard group={g} division={band.division} label={band.label} /> }))}
      />
    </AppPage>
  );
}
