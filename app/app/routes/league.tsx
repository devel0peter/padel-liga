import type { Division } from "@padel-liga/rules";
import { ChevronRight, ListOrdered } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/league";
import { AppPage } from "~/components/app-page";
import { FixtureList } from "~/components/fixture-list";
import { HelpTip } from "~/components/help-tip";
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
// matches open in a side panel (D136). Down the ladder one group is open as a
// full card, the viewer's on load; the others are compact rows above and
// below it (number, division, pairs), and a tap on one opens it (D143). For logged-in players only, inside the app
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

// A group that isn't open: one row with its number, division and pairs; a tap
// opens it. It keeps the region and the division, so the ladder still reads
// top-down.
function GroupRow({ group, division, label, onOpen }: { group: LadderGroup; division: Division; label: string; onOpen: () => void }) {
  return (
    <section aria-label={`${group.number}. csoport`}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${group.number}. csoport megnyitása`}
        className="flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display font-bold">{group.number}. csoport</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden className={`size-2 rounded-full ${DIVISION_DOT[division]}`} />
              {label}
            </span>
            {group.mine && <span className="text-xs font-semibold text-nav-active">a ti csoportotok</span>}
          </span>
          <span className="truncate text-xs text-muted-foreground">{group.rows.map((r) => r.names.join(" – ")).join(" · ")}</span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </section>
  );
}

// The ladder (D143): the open group as a full card, the rest as rows in their
// place. Opening another one brings its card into view.
function Ladder({ groups, initial }: { groups: { g: LadderGroup; division: Division; label: string }[]; initial: number }) {
  const [open, setOpen] = useState(initial);
  const card = useRef<HTMLDivElement>(null);
  const show = (i: number) => {
    setOpen(i);
    requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    });
  };
  return (
    <div className="grid max-w-3xl gap-2">
      {groups.map(({ g, division, label }, i) =>
        i === open ? (
          <div key={g.number} ref={card} className="scroll-mt-4 py-2">
            <GroupCard group={g} division={division} label={label} />
          </div>
        ) : (
          <GroupRow key={g.number} group={g} division={division} label={label} onOpen={() => show(i)} />
        ),
      )}
    </div>
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
  const groups = page.kind === "ladder" ? page.bands.flatMap((band) => band.groups.map((g) => ({ g, division: band.division, label: band.label }))) : [];
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
      description={
        <>
          {where} · {page.started ? `${page.phase}. kör, ${page.week}. hét (${page.weekFrom} – ${page.weekTo})` : `${page.phase}. kör, indul ${page.startsOn}`}
        </>
      }
    >
      <StandingsLegend />
      {/* Down the ladder, one group open, the viewer's on load (D143). */}
      <Ladder groups={groups} initial={focus} />
    </AppPage>
  );
}
