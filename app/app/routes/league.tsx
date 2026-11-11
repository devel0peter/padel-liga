import type { Division } from "@padel-liga/rules";
import { ListOrdered, Table2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/league";
import { AppPage } from "~/components/app-page";
import { FixtureList } from "~/components/fixture-list";
import { HelpTip } from "~/components/help-tip";
import { StandingsLegend, StandingsTable } from "~/components/standings-table";
import { Badge } from "~/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { DIVISION_DOT } from "~/lib/division-colors";
import type { LadderBand, LadderGroup } from "~/lib/ladder";
import { withArticle } from "~/lib/groups";
import { requireUser } from "~/lib/auth/session.server";
import { ladderPage, pairIdsOf } from "~/lib/ladder.server";
import { pairPath } from "~/lib/profiles";
import { SITE_NAME } from "~/lib/site";
import { cn } from "~/lib/utils";

// The league page, the player's "Tabella" (#30, spec section 14): the phase's
// groups top-down, each a card with its division and its table; the group's
// matches beside its table when there is room, behind a "Mérkőzések" switch
// when there isn't; every group open, in division bands on a faint colour of
// their own (D143). For logged-in players only, inside the app
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

// "Tabella | Meccsek" in the card's header, only on a card too narrow for the
// two side by side (D143). Pressed state for a screen reader.
function ViewSwitch({ view, onChange, count }: { view: "table" | "matches"; onChange: (v: "table" | "matches") => void; count: number }) {
  const item = (v: "table" | "matches", icon: React.ReactNode, text: string) => (
    <button
      type="button"
      aria-pressed={view === v}
      onClick={() => onChange(v)}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5",
        view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {text}
    </button>
  );
  return (
    <div role="group" aria-label="Nézet" className="inline-flex rounded-lg bg-muted p-0.5 @[46rem]/group:hidden">
      {item("table", <Table2 aria-hidden />, "Tabella")}
      {item("matches", <ListOrdered aria-hidden />, `Meccsek (${count})`)}
    </div>
  );
}

// One group: its table and, beside it, its matches by week when the card is
// wide enough (a container query on the card, 46rem); on a narrower card one
// of the two shows at a time, switched in the header (D143).
function GroupCard({ group, division, label }: { group: LadderGroup; division: Division; label: string }) {
  const [view, setView] = useState<"table" | "matches">("table");
  const count = group.weeks.reduce((n, w) => n + w.matches.length, 0);
  return (
    <Card role="region" aria-label={`${group.number}. csoport`} className={cn("@container/group", group.mine && "ring-2 ring-nav-active/60")}>
      <CardHeader>
        <CardTitle role="heading" aria-level={3} className="font-display text-lg font-bold whitespace-nowrap">{group.number}. csoport</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span aria-hidden className={`size-2 rounded-full ${DIVISION_DOT[division]}`} />
          {label}
          {/* On a phone the badge sits here; the header's right side has only the switch. */}
          {group.mine && (
            <Badge variant="secondary" className="@[30rem]/group:hidden">
              A ti csoportotok
            </Badge>
          )}
        </CardDescription>
        {/* The badge and the switch side by side once the card has room (D143). */}
        <CardAction className="flex items-center justify-end gap-2">
          {group.mine && (
            <Badge variant="secondary" className="hidden @[30rem]/group:inline-flex">
              A ti csoportotok
            </Badge>
          )}
          <ViewSwitch view={view} onChange={setView} count={count} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 @[46rem]/group:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @[46rem]/group:gap-6">
          <div className={cn("grid content-start gap-2", view === "matches" && "hidden @[46rem]/group:grid")}>
            <StandingsTable rows={group.rows} ranked={group.ranked} linkFor={pairPath} label={`${group.number}. csoport tabellája`} legend={false} />
            {group.withdrawn.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Visszalépett: {group.withdrawn.map((names) => names.join(" – ")).join(", ")}. A meccseik nem számítanak.
              </p>
            )}
          </div>
          <div className={cn("grid content-start gap-2", view === "table" && "hidden @[46rem]/group:grid")}>
            <FixtureList weeks={group.weeks} label={`${group.number}. csoport meccsei`} compact />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Faint division colours behind each band of the ladder (D143), the dots' hues.
const BAND: Record<Division, string> = {
  bronz: "bg-amber-50 ring-amber-200/70 dark:bg-amber-950/25 dark:ring-amber-900/50",
  rez: "bg-teal-50 ring-teal-200/70 dark:bg-teal-950/25 dark:ring-teal-900/50",
  rookie: "bg-violet-50 ring-violet-200/70 dark:bg-violet-950/25 dark:ring-violet-900/50",
};

// A division of the ladder: its name, then its groups top-down, on its colour.
function Band({ band }: { band: LadderBand }) {
  return (
    <section aria-label={band.label} className={cn("-mx-2 grid gap-4 rounded-2xl p-2 ring-1 sm:mx-0 sm:p-4", BAND[band.division])}>
      <h2 className="flex items-center gap-2 px-1 font-display text-base font-bold">
        <span aria-hidden className={`size-2.5 rounded-full ${DIVISION_DOT[band.division]}`} />
        {band.label}
      </h2>
      {band.groups.map((g) => (
        <GroupCard key={g.number} group={g} division={band.division} label={band.label} />
      ))}
    </section>
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
      description={
        <>
          {where} · {page.started
            ? `${page.phase}. kör, ${page.extension ? "hosszabbítás" : `${page.week}. hét`} (${page.weekFrom} – ${page.weekTo})`
            : `${page.phase}. kör, indul ${page.startsOn}`}
        </>
      }
    >
      <StandingsLegend />
      {/* Down the ladder, band by band, every group open (D143). */}
      <div className="grid gap-6">
        {page.bands.map((band) => (
          <Band key={band.division} band={band} />
        ))}
      </div>
    </AppPage>
  );
}
