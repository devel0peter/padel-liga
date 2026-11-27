import type { Division } from "@padel-liga/rules";
import { ChevronRight } from "lucide-react";
import { Link, useParams } from "react-router";

import type { Route } from "./+types/league";
import { Page, PageHeader, Segmented, StatusPill } from "~/components/blocks";
import { FixtureList } from "~/components/fixture-list";
import { HelpTip } from "~/components/help-tip";
import { StandingsLegend, StandingsTable } from "~/components/standings-table";
import type { LadderBand, LadderGroup } from "~/lib/ladder";
import { withArticle } from "~/lib/groups";
import { requireUser } from "~/lib/auth/session.server";
import { ladderPage, pairIdsOf } from "~/lib/ladder.server";
import { pairPath } from "~/lib/profiles";
import { SITE_NAME } from "~/lib/site";
import { cn } from "~/lib/utils";

// The league page, the player's "Tabella" (#30, spec section 14; direction A,
// #422, mockup P04): the round's groups top-down by division, each a card
// with one line per pair; the group's matches behind a row under its table,
// the own group's open under it on wider screens. On a phone a "Csoportok /
// Ranglista" switch leads to the Ranglista (D183; the sidebar has it on wider
// screens). For logged-in players only, inside the app shell (D134). Names
// only: no email or phone is selected anywhere on the way here, and no rating.
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

/** The phone's switch between the Tabella and the Ranglista (D183); wider screens have the sidebar item. */
export function TableSwitch({ slug, value }: { slug: string; value: "groups" | "rankings" }) {
  return (
    <div className="md:hidden">
      <Segmented
        label="Nézet"
        value={value}
        options={[
          { value: "groups", label: "Csoportok", to: `/league/${slug}` },
          { value: "rankings", label: "Ranglista", to: `/league/${slug}/rankings` },
        ]}
      />
    </div>
  );
}

// "A csoport meccsei (6)": the group's matches open in place (a native
// disclosure, so it works before the page's script loads).
function MatchesRow({ group, title }: { group: LadderGroup; title: string }) {
  const count = group.weeks.reduce((n, w) => n + w.matches.length, 0);
  return (
    <details className="group/matches border-t border-hairline pt-1">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-bold text-ball [&::-webkit-details-marker]:hidden">
        {title} ({count})
        <ChevronRight aria-hidden className="size-5 transition-transform group-open/matches:rotate-90" />
      </summary>
      <div className="pt-2 pb-1">
        <FixtureList weeks={group.weeks} label={`${group.number}. csoport meccsei`} />
      </div>
    </details>
  );
}

// One group: its table, the pairs withdrawn from it, its matches. The own
// group is outlined and, from lg up, shows its matches open under the table.
function GroupCard({ group }: { group: LadderGroup }) {
  return (
    <section
      aria-label={`${group.number}. csoport`}
      className={cn("flex break-inside-avoid flex-col gap-3 rounded-2xl bg-surface p-4 md:p-5", group.mine && "inset-ring inset-ring-ball/40")}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-lg font-bold">{group.number}. csoport</h3>
        {group.mine && (
          <StatusPill tone="neutral" className="bg-ball-tint text-ball">
            A ti csoportotok
          </StatusPill>
        )}
      </div>
      <StandingsTable rows={group.rows} ranked={group.ranked} linkFor={pairPath} label={`${group.number}. csoport tabellája`} />
      {group.withdrawn.length > 0 && <p className="m-0 text-caption text-muted-foreground">Visszalépett: {group.withdrawn.join(", ")}. A meccseik nem számítanak.</p>}
      {group.mine ? (
        <>
          <div className="hidden flex-col gap-2 border-t border-hairline pt-3 lg:flex">
            <h4 className="type-label m-0 text-muted-foreground">A csoport meccsei</h4>
            <FixtureList weeks={group.weeks} label={`${group.number}. csoport meccsei`} />
          </div>
          <div className="lg:hidden">
            <MatchesRow group={group} title="A csoport meccsei" />
          </div>
        </>
      ) : (
        <MatchesRow group={group} title="A csoport meccsei" />
      )}
    </section>
  );
}

const DOT: Record<Division, string> = { bronz: "bg-division-bronz", rez: "bg-division-rez", rookie: "bg-division-rookie" };

// A division of the ladder: its name with its dot, then its groups top-down.
function Band({ band, top }: { band: LadderBand; top: boolean }) {
  return (
    <section aria-label={band.label} className="flex flex-col gap-3">
      <h2 className="m-0 flex items-center gap-2 text-[17px] font-bold">
        <span aria-hidden className={cn("size-2.5 rounded-full", DOT[band.division])} />
        {band.label}
        {top && <span className="text-caption font-normal text-muted-foreground">· a létra csúcsa</span>}
      </h2>
      {band.groups.map((g) => (
        <GroupCard key={g.number} group={g} />
      ))}
    </section>
  );
}

const POINTS: [title: string, text: string][] = [
  ["Egyetlen létra", "Az összes csoport egy nagy létrát alkot: az 1. csoport a legerősebb, lefelé egyre könnyebbek."],
  ["A divíziók a létra harmadai", "Felül a Bronz, középen a Réz, alul a Rookie divízió. Ez csak címke: a meccseidet, a feljutást és a kiesést nem érinti."],
  ["Egy fel, egy le", "A kör végén a csoport első helyezettje feljebb lép, az utolsó lejjebb kerül."],
];

// "Hogyan működik a létra?" behind the "?" by the legend (D138).
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
  const slug = useParams().league ?? "";
  const where = [page.league.name, page.season].filter(Boolean).join(" · ");
  if (page.kind === "waiting")
    return (
      <Page>
        <PageHeader eyebrow={where} title="Tabella" />
        <TableSwitch slug={slug} value="groups" />
        <section className="flex max-w-2xl flex-col gap-1.5 rounded-2xl bg-surface p-4 md:p-5">
          <h2 className="m-0 text-lg font-bold">Még nincsenek kint a csoportok</h2>
          <p className="m-0 text-sm text-muted-foreground">
            {page.starting ??
              (page.next
                ? `${capitalize(withArticle(page.next.round))} kör ${page.next.startsOn} indul. A csoportok az indulás előtt kerülnek ki ide.`
                : "A következő szezon időpontja hamarosan kiderül.")}
          </p>
        </section>
      </Page>
    );
  const round = page.started
    ? `${page.phase}. kör, ${page.extension ? "hosszabbítás" : `${page.week}. hét`} (${page.weekFrom} – ${page.weekTo})`
    : `${page.phase}. kör, indul ${page.startsOn}`;
  return (
    <Page>
      <PageHeader eyebrow={`${where} · ${round}`} title="Tabella" />
      <TableSwitch slug={slug} value="groups" />
      {/* Down the ladder, band by band; two columns on wide screens. */}
      <div className="gap-x-8 lg:columns-2 [&>*]:mb-6">
        {page.bands.map((band, i) => (
          <Band key={band.division} band={band} top={i === 0 && band.division === "bronz"} />
        ))}
      </div>
      <StandingsLegend>
        <Explainer />
      </StandingsLegend>
    </Page>
  );
}
