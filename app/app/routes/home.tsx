import type { Route } from "./+types/home";
import { SignupForm, type SignupActionData } from "~/components/signup-form";
import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { parseInterest } from "~/lib/interest";
import { saveInterest } from "~/lib/interest.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Padelpárbaj – heti egy meccs, a saját pároddal" },
    {
      name: "description",
      content:
        "Padelbajnokság pároknak. Szint szerinti 4-es csoportok, heti egy meccs, feljutás és kiesés. Jelentkezz!",
    },
  ];
}

export async function action({ request }: Route.ActionArgs): Promise<SignupActionData> {
  const form = await request.formData();

  // Honeypot filled in: pretend success so bots don't retry.
  const honeypot = form.get("website");
  if (typeof honeypot === "string" && honeypot !== "") return { ok: true };

  const result = parseInterest(form);
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
  return { ok: true };
}

const btn = "inline-block rounded-full border-2 px-6 py-3 font-bold no-underline";

const LADDER = [
  {
    title: "1. csoport",
    sub: "legerősebb",
    pairs: ["Szabó – Kiss", "Tóth – Varga", "Horváth – Fekete", "Molnár – Balogh"],
    className: "scale-[.94] origin-bottom",
  },
  {
    title: "2. csoport",
    sub: "3. hét után",
    pairs: ["Nagy – Kovács", "Papp – Takács", "Juhász – Lakatos", "Mészáros – Oláh"],
    up: 0,
    down: 3,
  },
  {
    title: "3. csoport",
    pairs: ["Simon – Rácz", "Fehér – Szilágyi", "Török – Vincze", "Kozma – Hegedűs"],
    className: "scale-[.94] origin-top",
  },
];

function Ladder() {
  return (
    <div
      role="img"
      aria-label="Példa: három csoport, a 2. csoport első helyezettje feljut az 1. csoportba, a negyedik a 3. csoportba kerül."
      className="grid gap-3.5"
    >
      {LADDER.map((box) => (
        <div
          key={box.title}
          className={`relative rounded-[10px] border-[3px] border-white bg-court px-4 pt-3.5 pb-3 text-white outline-2 outline-court-deep after:absolute after:inset-x-0 after:top-1/2 after:border-t-2 after:border-dashed after:border-white/35 ${box.className ?? ""}`}
        >
          <h3 className="font-display mb-2 flex justify-between font-bold">
            {box.title}
            {box.sub && <span className="font-medium opacity-80 [font-stretch:100%]">{box.sub}</span>}
          </h3>
          <ol className="relative z-10 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {box.pairs.map((pair, i) => (
              <li
                key={pair}
                className={`flex items-baseline gap-2 text-[0.95rem] ${i === box.up ? "font-bold text-ball" : ""} ${i === box.down ? "opacity-65" : ""}`}
              >
                <b className="font-semibold tabular-nums opacity-75">{i + 1}</b>
                {pair}
                {(i === box.up || i === box.down) && (
                  <span className="ml-auto rounded-full border border-current px-2 text-xs">
                    {i === box.up ? "feljut" : "lejjebb"}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

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
  ["Csoportok", "4 pár csoportonként, szint szerint sorba rendezve."],
  ["Egy kör", "3 hét, hetente egy meccs, mindenki mindenkivel játszik a csoportban."],
  ["Határidő", "Minden meccsnek megvan a maga hete, érdemes akkor lejátszani. Ha nem jön össze, a kör végéig, a 3. hét vasárnapjáig pótolhatjátok."],
  ["Időpontok", "Legalább 3 időpontot kell ajánlani, legalább 2 különböző napra, 48 órával előre."],
  ["Elmaradt meccs", "Ha a kör végéig sem jön össze, és csak az egyik pár próbált egyeztetni, ők nyernek. Ha egyik sem, mindkettő vereséget kap."],
  ["Eredmény", "Az egyik pár rögzíti, a másik megerősíti az oldalon."],
  ["Párcsere", "Mindenkinek van egyéni értékszáma, így új párral is a megfelelő csoportba kerülsz."],
];

const FAQ = [
  ["Mennyibe kerül?", "Az első szezonban a részvétel ingyenes, csak a pályadíjat kell kifizetni, amit a négy játékos egyenlő arányban áll."],
  ["Mikor indul?", "Amint összegyűlik legalább 8 pár. Mindenkinek írunk e-mailben, aki jelentkezett."],
  ["Nincs párom. Jelentkezhetek?", "Igen. Jelentkezz egyedül, és megpróbálunk hasonló szintű párt találni neked a jelentkezők közül."],
  ["Milyen szinten kell játszanom?", "Bármilyen szinten. A csoportokat szint szerint állítjuk össze, kezdőktől a versenyzőkig."],
  ["Mi van, ha egy héten nem érünk rá?", "Semmi gond: a meccset a kör végéig, a 3. hét vasárnapjáig pótolhatjátok. Azért érdemes a saját hetén lejátszani, különben a kör végére torlódnak a meccsek. Ha a kör végéig sem jön össze, az a pár nyer, amelyik próbált egyeztetni."],
  ["Ki szervezi?", "Padelesek, akiknek ugyanez volt a problémájuk: sok a hétvégi verseny, de nehéz rendszeres meccset összehozni."],
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="text-[1.0625rem] leading-relaxed">
        <div className="pt-10 pb-16">
          <Wrap className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
            <div className="grid gap-6">
              <h1 className="font-display text-[clamp(2.4rem,6vw,4.25rem)] font-black tracking-tight">
                Heti egy meccs, a saját pároddal.
              </h1>
              <p className="max-w-[34em] text-xl text-muted-foreground">
                Padelbajnokság pároknak. Szint szerinti négyes csoportokban
                mindenki mindenkivel játszik, három hét után a csoportgyőztes
                feljebb lép, az utolsó lejjebb kerül.
              </p>
              <div className="flex flex-wrap gap-3">
                <a href="#jelentkezes" className={`${btn} border-ball bg-ball text-ball-foreground`}>
                  Jelentkezem
                </a>
                <a href="#hogyan" className={`${btn} border-foreground`}>
                  Hogyan működik?
                </a>
              </div>
            </div>
            <Ladder />
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
            <SignupForm />
          </Wrap>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
