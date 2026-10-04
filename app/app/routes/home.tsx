import { Link } from "react-router";

import type { Route } from "./+types/home";
import { LadderDemo } from "~/components/ladder-demo";
import { SignupForm, type SignupActionData } from "~/components/signup-form";
import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { CITIES } from "~/lib/cities";
import { normalizeRef, toClubOption } from "~/lib/clubs";
import { listClubs } from "~/lib/clubs.server";
import { parseInterest } from "~/lib/interest";
import { saveInterest } from "~/lib/interest.server";
import { pageMeta } from "~/lib/site";
import { deliver, queueSignupEmails } from "~/lib/email/outbox.server";

export function meta({}: Route.MetaArgs) {
  return pageMeta({
    title: "Padelpárbaj – Ki a legjobb páros a városban?",
    description:
      "Padelpárbaj: szint szerinti 4-es csoportok pároknak, heti egy meccs, feljutás és kiesés. Jelentkezz!",
    path: "/",
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  // Clubs only feed the optional "where do you play most" field.
  const clubs = (await listClubs()).map(toClubOption);
  return { ref: normalizeRef(new URL(request.url).searchParams.get("ref")), clubs };
}

export async function action({ request }: Route.ActionArgs): Promise<SignupActionData> {
  const form = await request.formData();

  // Honeypot filled in: pretend success so bots don't retry.
  const honeypot = form.get("website");
  if (typeof honeypot === "string" && honeypot !== "") return { ok: true };

  const clubs = await listClubs();
  const result = parseInterest(
    form,
    clubs.filter((c) => c.city === form.get("city")).map((c) => c.slug),
  );
  if (!result.ok) return result;

  try {
    await saveInterest(result.data);
  } catch (error) {
    console.error("interest signup insert failed", error);
    return {
      ok: false,
      formError: "Nem sikerült elküldeni a jelentkezést. Próbáld újra pár perc múlva.",
    };
  }
  // The signup is saved; an email problem must not fail it. Anything not sent
  // now stays queued for the hourly cron.
  try {
    await deliver(await queueSignupEmails(result.data));
  } catch (error) {
    console.error("signup email failed", error);
  }
  return { ok: true, cityOther: result.data.cityOther };
}

const btn = "inline-block rounded-full border-2 px-6 py-3 font-bold no-underline";



function SectionHead({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="mb-9 grid max-w-[40em] gap-3">
      <h2 className="font-display text-[clamp(1.7rem,3.6vw,2.4rem)] font-extrabold">{title}</h2>
      {lede && <p className="text-xl text-muted-foreground">{lede}</p>}
    </div>
  );
}

const STEPS = [
  ["Jelentkeztek párban", "Ha még nincs párod, írd fel magad egyedül, és segítünk párt találni."],
  ["Csoportba kerültök", "Szint szerint négy pár kerül egy csoportba, hogy kiegyenlített meccsek legyenek."],
  ["Hetente egy meccs", "Az időpontot az oldalon egyeztetitek az ellenféllel, a pályát bármelyik klubban lefoglalhatjátok a városotokban."],
  ["Feljutás, kiesés", "Három hét után a csoport első helyezettje feljebb lép, a negyedik lejjebb kerül, és indul a következő kör."],
];


const RULES = [
  ["Csoportok", "4 pár csoportonként, szint szerint sorba rendezve. Ha nem jön ki, néhány csoport 3 páros."],
  ["Egy kör", "3 hét, hetente egy meccs, mindenki mindenkivel játszik a csoportban."],
  ["Határidő", "Minden meccsnek megvan a maga hete, érdemes akkor lejátszani. Ha nem jön össze, a kör végéig, a 3. hét vasárnapjáig pótolhatjátok."],
  ["Időpontok", "Legalább 3 időpontot kell ajánlani, legalább 2 különböző napra, 48 órával előre."],
  ["Elmaradt meccs", "Ha a kör végéig sem jön össze, és csak az egyik pár próbált egyeztetni, ők nyernek. Ha egyik sem, mindkettő vereséget kap."],
  ["Meccs", "2 nyert szettig, egy szett 4 játékig, 4:4-nél tie-break, 1:1-nél szuper tie-break 10 pontig. Arany ponttal: 40:40-nél egy pont dönt. Egy óra pályafoglalás általában elég."],
  ["Eredmény", "Az egyik pár rögzíti, a másik megerősíti az oldalon."],
  ["Párcsere", "Csak két kör között lehet. Mindenkinek van egyéni értékszáma, így új párral is a megfelelő csoportba kerülsz."],
];

const FAQ = [
  ["Mennyibe kerül?", "Nevezési díj nincs, csak a pályadíjat kell kifizetni, amit a négy játékos egyenlő arányban áll."],
  ["Mikor indul?", "Amint összegyűlik legalább 12 pár, a cél a novemberi indulás. Mindenkinek írunk e-mailben, aki jelentkezett."],
  ["Nincs párom. Jelentkezhetek?", "Igen. Jelentkezz egyedül, és megpróbálunk hasonló szintű párt találni neked a jelentkezők közül."],
  ["Milyen szinten kell játszanom?", "Bármilyen szinten. A csoportokat szint szerint állítjuk össze, kezdőktől a versenyzőkig."],
  ["Mi van, ha egy héten nem érünk rá?", "Semmi gond: a meccset a kör végéig, a 3. hét vasárnapjáig pótolhatjátok. Azért érdemes a saját hetén lejátszani, különben a kör végére torlódnak a meccsek. Ha a kör végéig sem jön össze, az a pár nyer, amelyik próbált egyeztetni."],
  ["Mi van, ha megsérül a párom?", "A szervező jóváhagyásával helyettes játszhat helyette, egy vagy több meccsen. A pár csak két kör között cserélhető végleg."],
  ["Ki szervezi?", "Padelesek, akiknek ugyanez volt a problémájuk: sok a hétvégi verseny, de nehéz rendszeres meccset összehozni."],
];

export default function Home({ loaderData }: Route.ComponentProps) {
  const { ref, clubs } = loaderData;
  return (
    <>
      <SiteHeader />
      <main className="text-[1.0625rem] leading-relaxed">
        <div className="pt-10 pb-16">
          <Wrap className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
            <div className="grid gap-6">
              <h1 className="font-display text-[clamp(2.4rem,6vw,4.25rem)] font-black tracking-tight">
                Ki a legjobb páros a városban?
              </h1>
              <p className="max-w-[34em] text-xl text-muted-foreground">
                Négyes csoportok, heti egy meccs. Aki nyer, feljebb lép. Aki
                nem, a következő körben visszavághat.
              </p>
              <div className="flex flex-wrap gap-3">
                <a href="#jelentkezes" className={`${btn} border-ball bg-ball text-ball-foreground`}>
                  Jelentkezem
                </a>
                <a href="#hogyan" className={`${btn} border-foreground`}>
                  Hogyan működik?
                </a>
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-extrabold tracking-wider text-muted-foreground uppercase">
                  Ligák
                </span>
                <ul className="flex flex-wrap gap-2">
                  {CITIES.map((c) => (
                    <li key={c.slug}>
                      <a
                        href="#jelentkezes"
                        className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-court bg-court py-2 pr-4 pl-3 font-bold text-white no-underline"
                      >
                        <span className="relative flex size-2.5">
                          <span className="absolute inline-flex size-full rounded-full bg-ball opacity-75 motion-safe:animate-ping" />
                          <span className="relative inline-flex size-2.5 rounded-full bg-ball" />
                        </span>
                        {c.name}
                        <span className="text-sm font-medium opacity-80">· jelentkezés nyitva</span>
                      </a>
                    </li>
                  ))}
                  <li>
                    <a
                      href="#jelentkezes"
                      title="Szólunk, ha nálatok is indul"
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
              lede="A részletes szabályzatot az indulás előtt véglegesítjük, a jelentkezők véleményét is figyelembe véve."
            />
            <dl className="grid max-w-[52rem] sm:grid-cols-[minmax(9rem,14rem)_1fr]">
              {RULES.map(([term, desc]) => (
                <div key={term} className="contents">
                  <dt className="pt-4 font-bold sm:border-b sm:pb-4">{term}</dt>
                  <dd className="border-b pb-4 text-muted-foreground sm:pt-4">{desc}</dd>
                </div>
              ))}
            </dl>
            <Link to="/szabalyzat" className="mt-6 inline-block font-bold underline">
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

        <section id="jelentkezes" className="scroll-mt-4 bg-muted py-16">
          <Wrap className="grid items-start gap-12 lg:grid-cols-[1fr_1.2fr]">
            <SectionHead
              title="Jelentkezz az első szezonra"
              lede="A jelentkezés nem kötelez semmire. Ha összejön elég pár, e-mailben értesítünk az indulásról és a részletekről."
            />
            <SignupForm signupRef={ref} clubs={clubs} />
          </Wrap>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
