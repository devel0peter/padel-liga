import type { Division } from "@padel-liga/rules";
import { Link } from "react-router";

import type { Route } from "./+types/league";
import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import { FixtureList } from "~/components/fixture-list";
import { StandingsTable } from "~/components/standings-table";
import type { LadderBand, LadderGroup } from "~/lib/ladder";
import { withArticle } from "~/lib/groups";
import { finishedFirstLogin, getUser } from "~/lib/auth/session.server";
import { ladderPage } from "~/lib/ladder.server";
import { pairPath } from "~/lib/profiles";
import { pageMeta } from "~/lib/site";

// The public league page (#30, spec section 14): the phase's groups top-down
// in division bands, each group's table and this week's matches. Names only:
// no email or phone is selected anywhere on the way here, and no rating
// (D112). For a logged-in member a pair's name in the table leads to its
// profile (#36); a visitor sees plain names, since profiles are for members
// only (D112).
export async function loader({ request, params }: Route.LoaderArgs) {
  const page = await ladderPage(params.league ?? "");
  if (!page) throw new Response("Nincs ilyen liga.", { status: 404 });
  const user = await getUser(request);
  return { ...page, member: !!user && finishedFirstLogin(user) };
}

export function meta({ loaderData, location }: Route.MetaArgs) {
  const name = loaderData?.league.name ?? "Padelpárbaj liga";
  return pageMeta({
    title: `${name}: csoportok és tabella – Padelpárbaj`,
    description: `${name}: a liga összes csoportja, a tabellák és a heti meccsek, divíziókra bontva.`,
    path: location.pathname,
  });
}

// Bands are colored by division: bronze, verdigris (copper's patina), violet.
const BAND: Record<Division, { band: string; chip: string }> = {
  bronz: {
    band: "border-amber-700 bg-amber-50 text-amber-950",
    chip: "bg-amber-700 text-white",
  },
  rez: {
    band: "border-teal-700 bg-teal-50 text-teal-950",
    chip: "bg-teal-700 text-white",
  },
  rookie: {
    band: "border-violet-700 bg-violet-50 text-violet-950",
    chip: "bg-violet-700 text-white",
  },
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function GroupCard({ group, member }: { group: LadderGroup; member: boolean }) {
  return (
    <section aria-label={`${group.number}. csoport`} className="grid gap-4 rounded-2xl border bg-background p-2.5 text-foreground sm:p-5">
      <h3 className="font-display text-xl font-extrabold">{group.number}. csoport</h3>
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div className="grid gap-2">
          <StandingsTable rows={group.rows} ranked={group.ranked} linkFor={member ? pairPath : undefined} />
          {group.withdrawn.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Visszalépett: {group.withdrawn.map((names) => names.join(" – ")).join(", ")}. A meccseik nem számítanak.
            </p>
          )}
        </div>
        <FixtureList weeks={group.weeks} label={`${group.number}. csoport meccsei`} />
      </div>
    </section>
  );
}

function Band({ band, member }: { band: LadderBand; member: boolean }) {
  const colors = BAND[band.division];
  return (
    <section aria-label={band.label} className={`grid gap-3 rounded-3xl border-2 p-1.5 sm:gap-4 sm:p-5 ${colors.band}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 pt-1 sm:p-0">
        <h2 className={`font-display rounded-full px-4 py-1 text-lg font-extrabold ${colors.chip}`}>{band.label}</h2>
        <a href="#hogyan-mukodik" className="text-sm font-bold underline">
          Hogyan működik?
        </a>
      </header>
      {band.groups.map((g) => (
        <GroupCard key={g.number} group={g} member={member} />
      ))}
    </section>
  );
}

const POINTS: [title: string, text: string][] = [
  ["Egyetlen létra", "Az összes csoport egy nagy létrát alkot: az 1. csoport a legerősebb, lefelé egyre könnyebbek."],
  ["A divíziók a létra harmadai", "Felül a Bronz, középen a Réz, alul a Rookie divízió. Ez csak címke: a meccseidet, a feljutást és a kiesést nem érinti."],
  ["Egy fel, egy le", "A kör végén a csoport első helyezettje feljebb lép, az utolsó lejjebb kerül."],
];

function Explainer() {
  return (
    <section id="hogyan-mukodik" aria-label="Hogyan működik?" className="grid scroll-mt-6 gap-4 rounded-2xl border-2 border-court p-5">
      <h2 className="font-display text-2xl font-extrabold">Hogyan működik?</h2>
      <ol className="grid list-decimal gap-3 pl-5">
        {POINTS.map(([title, text]) => (
          <li key={title}>
            <strong>{title}.</strong> {text}
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted-foreground">
        Részletesen a{" "}
        <Link to="/rules" className="underline">
          szabályzatban
        </Link>
        .
      </p>
    </section>
  );
}

export default function League({ loaderData: page }: Route.ComponentProps) {
  return (
    <>
      <SiteHeader />
      <main className="py-8">
        <Wrap className="grid max-w-6xl gap-6">
          <div className="grid gap-1">
            <span className="text-sm font-extrabold tracking-wider text-court uppercase">{page.season}</span>
            <h1 className="font-display text-[clamp(2rem,5vw,3rem)] font-black">{page.league.name}</h1>
          </div>

          {page.kind === "waiting" ? (
            <div className="grid gap-2 rounded-2xl border-2 border-court p-5">
              <h2 className="font-display text-2xl font-bold">Még nincsenek kint a csoportok</h2>
              <p className="text-lg">
                {page.next
                  ? `${capitalize(withArticle(page.next.round))} kör ${page.next.startsOn} indul. A csoportok az indulás előtt kerülnek ki ide.`
                  : "A következő szezon időpontja hamarosan kiderül."}
              </p>
              <p>
                <Link to="/" className="font-bold underline">
                  Vissza a nyitólapra
                </Link>
              </p>
            </div>
          ) : (
            <>
              <p className="text-lg">
                {page.started ? `${page.phase}. kör, ${page.week}. hét (${page.weekFrom} – ${page.weekTo}).` : `${page.phase}. kör, indul ${page.startsOn}.`}
              </p>
              {page.bands.map((band) => (
                <Band key={band.division} band={band} member={page.member} />
              ))}
              <Explainer />
            </>
          )}
        </Wrap>
      </main>
      <SiteFooter />
    </>
  );
}
