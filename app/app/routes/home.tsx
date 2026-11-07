import { useEffect, useState } from "react";
import { data, Link } from "react-router";

import type { Route } from "./+types/home";
import { LadderDemo } from "~/components/ladder-demo";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { OWN_DELETED } from "~/lib/account-deletion";
import { getUser } from "~/lib/auth/session.server";
import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { listedCities } from "~/lib/cities.server";
import { STEPS } from "~/lib/how-it-works";
import { landingByCity } from "~/lib/landing-league";
import { listLeagues, minEntriesByLeague } from "~/lib/leagues.server";
import { publishedPhases } from "~/lib/groups.server";
import { listSeasons } from "~/lib/seasons.server";
import { LeagueStatus } from "~/components/league-status";
import { entryCounts } from "~/lib/season-entries.server";
import { CONTACT_EMAIL, organizationJsonLd, pageMeta } from "~/lib/site";
import { isNewLanding, landingSource, withoutTracking } from "~/lib/traffic";
import { normalizeRef } from "~/lib/slug";

// A tagged link (`?ref=`) keeps its tag in og:url: Facebook sends clicks on
// the link preview card to og:url, so a bare one would drop the source.
export function meta({ location }: Route.MetaArgs) {
  const ref = normalizeRef(new URLSearchParams(location.search).get("ref"));
  return [
    ...pageMeta({
      title: "Padelpárbaj – Ki a legjobb páros a városban?",
      description:
        "Padelpárbaj: szint szerinti 4-es csoportok pároknak, heti egy meccs, feljutás és kiesés. Jelentkezz!",
      path: "/",
      ogQuery: ref ? `?ref=${ref}` : undefined,
    }),
    organizationJsonLd(),
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const listed = await listedCities();
  // A listed city with a league shows where it is and sends visitors to
  // registration (#83). There is no interest form any more (#332, D123):
  // a city without a league isn't shown, the contact line covers it.
  const slugs = new Set(listed.map((c) => c.slug));
  const published = await publishedPhases();
  const leagues = (await listLeagues()).filter((l) => slugs.has(l.city));
  const seasons = await listSeasons();
  // A first season waiting for its minimum entries (D124) shows how many
  // pairs are still needed.
  const waiting = seasons.filter((s) => s.firstPhaseStart === null);
  const [counts, minimums] = await Promise.all([
    entryCounts(waiting.map((s) => s.id)),
    minEntriesByLeague([...new Set(waiting.map((s) => s.leagueId))]),
  ]);
  const league = landingByCity(
    leagues,
    seasons.map((s) => ({
      ...s,
      publishedPhases: published.get(s.id),
      entries: counts.has(s.id) ? { count: counts.get(s.id)!, minimum: minimums.get(s.leagueId) ?? 0 } : undefined,
    })),
    new Date(),
  );
  const cities = listed.flatMap(({ slug, name }) => {
    const block = league.get(slug);
    return block ? [{ slug, name, league: block }] : [];
  });
  const params = new URL(request.url).searchParams;
  const ref = landingSource(params, request.headers.get("Referer"));
  // Back from the player's own "Fiók törlése" (#38), logged out. Only for a
  // visitor without a session, so a link with it can't tell a logged-in
  // player their account is gone.
  const accountDeleted = params.get("accountDeleted") === "1" && !(await getUser(request));
  return { ref, cities, accountDeleted };
}

// The interest form is gone (#332, D123): a post from an old page (or a bot)
// is refused and nothing is stored.
export const INTEREST_CLOSED =
  "Ez a jelentkezés már nem működik. Ha a városodban van liga, regisztrálj és nevezz; ha nincs, írj nekünk: " + CONTACT_EMAIL;

export async function action(_args: Route.ActionArgs) {
  return data({ error: INTEREST_CLOSED }, { status: 410 });
}

function SectionHead({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="mb-9 grid max-w-[40em] gap-3">
      <h2 className="font-display text-[clamp(1.7rem,3.6vw,2.4rem)] font-extrabold">{title}</h2>
      {lede && <p className="text-xl text-muted-foreground">{lede}</p>}
    </div>
  );
}



const RULES = [
  ["Csoportok", "4 pár csoportonként, szint szerint sorba rendezve. Ha nem jön ki, néhány csoport 3 páros."],
  ["Egy kör", "3 hét, hetente egy meccs, mindenki mindenkivel játszik a csoportban."],
  ["Határidő", "Minden meccsnek megvan a maga hete, érdemes akkor lejátszani. Ha nem jön össze, a kör végéig, a 3. hét vasárnapjáig pótolhatjátok."],
  ["Időpontok", "Legalább 3 időpontot kell ajánlani, legalább 2 különböző napra, 48 órával előre."],
  ["Elmaradt meccs", "Ha a kör végéig sem jön össze, és csak az egyik pár próbált egyeztetni, ők nyernek. Ha egyik sem, mindkettő vereséget kap."],
  ["Meccs", "2 nyert szettig, egy szett 4 játékig, 4:4-nél tie-break, 1:1-nél szuper tie-break 10 pontig. Arany ponttal: 40:40-nél egy pont dönt. Egy óra pályafoglalás általában elég."],
  ["Eredmény", "Az egyik pár rögzíti, a másik megerősíti az oldalon."],
  ["Párcsere", "Csak két kör között lehet. Mindenkinek van egyéni Élő-pontja, így új párral is a megfelelő csoportba kerülsz."],
];

const FAQ = [
  ["Mennyibe kerül?", "Nevezési díj nincs, csak a pályadíjat kell kifizetni, amit a négy játékos egyenlő arányban áll."],
  ["Mikor csatlakozhatok?", "Ahol már fut a liga, nevezhetsz rögtön: a következő kör elejétől játszotok, a dátumot az oldal tetején látod. Ahol még nincs liga, írj nekünk, ha játszanál vagy szerveznél."],
  ["Nincs párom. Nevezhetek?", "Igen. Regisztrálj egyedül, és a szervező hasonló szintű párt keres neked."],
  ["Milyen szinten kell játszanom?", "Bármilyen szinten. A csoportokat szint szerint állítjuk össze, kezdőktől a versenyzőkig."],
  ["Mi van, ha egy héten nem érünk rá?", "Semmi gond: a meccset a kör végéig, a 3. hét vasárnapjáig pótolhatjátok. Azért érdemes a saját hetén lejátszani, különben a kör végére torlódnak a meccsek. Ha a kör végéig sem jön össze, az a pár nyer, amelyik próbált egyeztetni."],
  ["Mi van, ha megsérül a párom?", "A szervező jóváhagyásával helyettes játszhat helyette, egy vagy több meccsen. A pár csak két kör között cserélhető végleg."],
  ["Ki szervezi?", "Padelesek, akiknek ugyanez volt a problémájuk: sok a hétvégi verseny, de nehéz rendszeres meccset összehozni."],
];

// One landing count per page load, not per client-side visit back to "/".
let landingCounted = false;

// Counts the landing per source for the admin funnel (app/lib/traffic.ts),
// then takes ?ref= and ad tags out of the address bar. A reload or back and
// forward isn't a new landing: the address no longer has the source, so it
// would only add to "no source".
function useLandingCount(source: string | null) {
  useEffect(() => {
    if (landingCounted) return;
    landingCounted = true;
    const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (isNewLanding(nav?.type)) {
      navigator.sendBeacon?.(`/api/landing${source ? `?ref=${encodeURIComponent(source)}` : ""}`);
    }
    const { search, pathname, hash } = window.location;
    const clean = withoutTracking(search);
    if (clean !== search) window.history.replaceState(window.history.state, "", `${pathname}${clean}${hash}`);
  }, []);
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const { cities } = loaderData;
  // The source as the page was opened. Loaders run again later (a "#" link,
  // back from the rules) on the cleaned address, which has no source.
  const [ref] = useState(loaderData.ref);
  useLandingCount(ref);
  return (
    <>
      <SiteHeader />
      <main className="text-[1.0625rem] leading-relaxed">
        <div className="pt-10 pb-16">
          <Wrap className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
            <div className="grid gap-6">
              {loaderData.accountDeleted && (
                <Alert role="status">
                  <AlertDescription>{OWN_DELETED}</AlertDescription>
                </Alert>
              )}
              {actionData?.error && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{actionData.error}</AlertDescription>
                </Alert>
              )}
              <h1 className="font-display text-[clamp(2.4rem,6vw,4.25rem)] font-black tracking-tight">
                Ki a legjobb páros a városban?
              </h1>
              <p className="max-w-[34em] text-xl text-muted-foreground">
                Négyes csoportok, heti egy meccs. Aki nyer, feljebb lép. Aki
                nem, a következő körben visszavághat.
              </p>
              {cities.map((c) => <LeagueStatus key={c.slug} city={c.name} block={c.league} />)}
              <div className="flex flex-wrap gap-x-6 gap-y-2 font-bold">
                <a href="#hogyan" className="underline">
                  Hogyan működik?
                </a>
                <a href="#mas-varos" className="underline">
                  Más városban játszol?
                </a>
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-extrabold tracking-wider text-muted-foreground uppercase">
                  Ligák
                </span>
                <ul className="flex flex-wrap gap-2">
                  {cities.map((c) => (
                    <li key={c.slug}>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-court bg-court py-2 pr-4 pl-3 font-bold text-white no-underline"
                      >
                        <span className="relative flex size-2.5">
                          <span className="absolute inline-flex size-full rounded-full bg-ball opacity-75 motion-safe:animate-ping" />
                          <span className="relative inline-flex size-2.5 rounded-full bg-ball" />
                        </span>
                        {c.name}
                        <span className="text-sm font-medium opacity-80">
                          · {c.league.chip}
                        </span>
                      </a>
                    </li>
                  ))}
                  <li>
                    <a
                      href="#mas-varos"
                      className="inline-flex items-center rounded-full border-[1.5px] border-dashed px-4 py-2 font-bold text-muted-foreground no-underline"
                    >
                      + A te városod?
                    </a>
                  </li>
                </ul>
              </div>
            </div>
            <LadderDemo />
          </Wrap>
        </div>

        <section id="hogyan" className="scroll-mt-4 bg-muted py-16">
          <Wrap>
            <SectionHead
              title="Hogyan működik?"
              lede="Nem kell egész hétvégét rászánni egy versenyre. Elég heti egy meccs, amikor nektek jó."
            />
            <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(([title, text], i) => (
                <li key={title} className="grid content-start gap-2 border-t-[3px] border-court pt-4">
                  <span className="font-display text-4xl font-black text-court [font-stretch:125%]">{i + 1}</span>
                  <h3 className="font-display text-xl font-bold">{title}</h3>
                  <p className="text-muted-foreground">{text}</p>
                </li>
              ))}
            </ol>
          </Wrap>
        </section>


        <section className="bg-muted py-16">
          <Wrap>
            <SectionHead
              title="A szabályok röviden"
              lede="A részleteket a teljes szabályzatban találod."
            />
            <dl className="grid max-w-[52rem] sm:grid-cols-[minmax(9rem,14rem)_1fr]">
              {RULES.map(([term, desc]) => (
                <div key={term} className="contents">
                  <dt className="pt-4 font-bold sm:border-b sm:pb-4">{term}</dt>
                  <dd className="border-b pb-4 text-muted-foreground sm:pt-4">{desc}</dd>
                </div>
              ))}
            </dl>
            <Link to="/rules" className="mt-6 inline-block font-bold underline">
              A teljes szabályzat
            </Link>
          </Wrap>
        </section>

        <section className="py-16">
          <Wrap>
            <SectionHead title="Gyakori kérdések" />
            <Accordion type="multiple" className="max-w-[48rem]">
              {FAQ.map(([q, a]) => (
                <AccordionItem key={q} value={q}>
                  <AccordionTrigger className="py-4 text-base font-bold">{q}</AccordionTrigger>
                  <AccordionContent className="max-w-[40em] text-base text-muted-foreground">{a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Wrap>
        </section>

        <section id="mas-varos" className="scroll-mt-4 bg-muted py-16">
          <Wrap>
            <p className="max-w-[40em] text-xl font-semibold">
              Nincs még liga a városodban? Ha játszanál vagy szerveznél, írj nekünk:{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-bold underline">
                {CONTACT_EMAIL}
              </a>
            </p>
          </Wrap>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
