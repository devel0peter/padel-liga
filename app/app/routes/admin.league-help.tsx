import { data, Link } from "react-router";

import type { Route } from "./+types/admin.league-help";
import { Page, PageHeader, SectionLabel } from "~/components/blocks";
import { requirePermission } from "~/lib/auth/admin.server";
import { getLeague } from "~/lib/leagues.server";
import { SITE_NAME } from "~/lib/site";

// Szervezői útmutató (Súgó, #386): short Hungarian step-by-step guide in time
// order linking to the organizer's own league pages and the rules.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Súgó – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export type GuideLink = { label: string; path: (slug: string) => string };
export type GuideSection = {
  id: string;
  title: string;
  steps: { text: string; links: GuideLink[] }[];
};

// Exported so unit tests (#386 req 5) can verify every linked route exists.
export const ORGANIZER_GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    id: "indulas",
    title: "1. Indulás",
    steps: [
      {
        text: "Vedd fel a városod klubjait, állítsd be a liga kapcsolattartóját, és ha szeretnél helyi infókat (klubok, díjak), írd meg a helyi szabályzat-kiegészítést.",
        links: [
          { label: "Beállítások → Liga", path: (s) => `/admin/leagues/${s}/settings?tab=league` },
          { label: "Beállítások → Klubok", path: (s) => `/admin/leagues/${s}/settings?tab=clubs` },
        ],
      },
      {
        text: "Hozd létre az első szezont a minimum nevezéssel, majd oszd meg a regisztrációs linket a játékosokkal és pipáld ki az Áttekintés ellenőrzőlistáján.",
        links: [
          { label: "Szezonok", path: (s) => `/admin/leagues/${s}/seasons` },
          { label: "Áttekintés", path: (s) => `/admin/leagues/${s}` },
        ],
      },
    ],
  },
  {
    id: "nevezes",
    title: "2. Nevezés alatt",
    steps: [
      {
        text: "A Várakozók fülön látod egyben a következő körben kezdő párokat, a még nem nevezett párokat és az egyedül jelentkezőket. Innen egy kattintással tudsz párt alkotni (Párba teszem) vagy benevezni (Benevezés).",
        links: [{ label: "Játékosok → Várakozók", path: (s) => `/admin/leagues/${s}/players?tab=waiting` }],
      },
      {
        text: "Új jelentkezőkről app- és push-értesítést, másnap reggel pedig összesítő levelet kapsz (kikapcsolható a Profil → Értesítések alatt).",
        links: [{ label: "Profil", path: () => "/profile" }],
      },
    ],
  },
  {
    id: "koronkent",
    title: "3. Körönként",
    steps: [
      {
        text: "A kör oldalán a Csoportok fülön ellenőrizd és tedd közzé a csoportbeosztást; ezzel indul a kör és mennek ki a levelek.",
        links: [{ label: "Szezonok", path: (s) => `/admin/leagues/${s}/seasons` }],
      },
      {
        text: "Futó kör közben az Áttekintésen és a kör Meccsek / Statisztika fülén látod az elakadt meccseket; ha szükséges, kapcsold be az automatikus emlékeztetőket.",
        links: [
          { label: "Áttekintés", path: (s) => `/admin/leagues/${s}` },
          { label: "Beállítások → Emlékeztetők", path: (s) => `/admin/leagues/${s}/settings?tab=reminders` },
        ],
      },
    ],
  },
  {
    id: "dontesek",
    title: "4. Döntések",
    steps: [
      {
        text: "Minden vitatott eredmény, „nem jöttek el” bejelentés és jóváhagyásra váró állandó partnercsere a Döntések oldalon gyűlik össze. Ideiglenes helyetteshez nem kell szervezői jóváhagyás.",
        links: [
          { label: "Döntések", path: (s) => `/admin/leagues/${s}/disputes` },
          { label: "Szabályzat", path: () => "/rules" },
        ],
      },
      {
        text: "Bármelyik meccset a saját meccs oldalán (••• → Felülbírálom) bírálhatod felül indoklással; pár visszaléptetését és fekete pontok törlését a Játékosok fülein találod.",
        links: [
          { label: "Játékosok → Párok", path: (s) => `/admin/leagues/${s}/players?tab=pairs` },
          { label: "Játékosok → Fekete pontok", path: (s) => `/admin/leagues/${s}/players?tab=strikes` },
        ],
      },
    ],
  },
  {
    id: "hatarido",
    title: "5. Határidő és körváltás",
    steps: [
      {
        text: "A vasárnap 23:59-es határidő után hétfő 06:00-kor a rendszer automatikusan lezárja a lejátszatlan meccseket és elkészíti a következő kör tervezetét (erről értesítést kapsz).",
        links: [{ label: "Áttekintés", path: (s) => `/admin/leagues/${s}` }],
      },
      {
        text: "Ha minden nyitott vitát eldöntöttél, nézd át és tedd közzé az új kör csoportjait. Rendkívüli esetben a Szezonok → Körök fülön meghosszabbíthatod a futó kört.",
        links: [{ label: "Szezonok", path: (s) => `/admin/leagues/${s}/seasons` }],
      },
    ],
  },
  {
    id: "kommunikacio",
    title: "6. Kommunikáció és adatvédelem",
    steps: [
      {
        text: "A Levelek menüben naponta egy körlevelet küldhetsz a saját ligád játékosainak, és a Kimenő levelek fülön ellenőrizheted, kiment-e. A válaszok a liga kapcsolattartójához érkeznek.",
        links: [
          { label: "Levelek → Körlevél", path: (s) => `/admin/leagues/${s}/mail?tab=broadcast` },
          { label: "Levelek → Kimenő levelek", path: (s) => `/admin/leagues/${s}/mail?tab=outbox` },
        ],
      },
      {
        text: "Játékosok telefonszámát vagy e-mail-címét soha ne tedd ki nyilvános felületre (pl. közösségi média, nyilvános táblázat).",
        links: [{ label: "Beállítások → Napló", path: (s) => `/admin/leagues/${s}/settings?tab=log` }],
      },
    ],
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league };
}

export default function LeagueHelp({ loaderData }: Route.ComponentProps) {
  const { league } = loaderData;
  return (
    <Page>
      <PageHeader
        eyebrow={league.name}
        title="Szervezői útmutató"
      />
      <p className="text-sm text-muted-foreground">
        Rövid, időrendi összefoglaló egy szezon lebonyolításához. A napi „mi jön” lépéseket mindig az{" "}
        <Link to={`/admin/leagues/${league.slug}`} className="underline">
          Áttekintés
        </Link>{" "}
        oldalon látod.
      </p>
      <div className="grid gap-4">
        {ORGANIZER_GUIDE_SECTIONS.map((sec) => (
          <section key={sec.id} className="grid gap-3 rounded-2xl bg-surface p-4 sm:p-5">
            <SectionLabel>{sec.title}</SectionLabel>
            <ol className="grid gap-3 text-sm">
              {sec.steps.map((step, i) => (
                <li key={i} className="grid gap-1.5">
                  <p>{step.text}</p>
                  <div className="flex flex-wrap gap-3">
                    {step.links.map((l) => (
                      <Link key={l.label} to={l.path(league.slug)} className="text-xs font-semibold text-ball underline">
                        {l.label} →
                      </Link>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </Page>
  );
}
