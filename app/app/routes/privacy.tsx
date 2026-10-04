import type { Route } from "./+types/privacy";
import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import { CONTACT_EMAIL, DATA_CONTROLLER, pageMeta } from "~/lib/site";

// Spec section 17. Update the effective date whenever the content changes.
const EFFECTIVE_FROM = "2026. 10. 03.";

export function meta({}: Route.MetaArgs) {
  return pageMeta({
    title: "Adatkezelési tájékoztató – Padelpárbaj",
    description: "Milyen adatokat kezelünk, miért, és mik a jogaid.",
    path: "/adatkezeles",
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="font-display text-2xl font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

const list = "grid list-disc gap-1.5 pl-5";

export default function Privacy() {
  const mail = (
    <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
      {CONTACT_EMAIL}
    </a>
  );

  return (
    <>
      <SiteHeader cta={false} />
      <main className="py-10 text-[1.0625rem] leading-relaxed">
        <Wrap className="grid max-w-3xl gap-10">
          <div className="grid gap-3">
            <h1 className="font-display text-[clamp(2rem,5vw,3rem)] font-black">
              Adatkezelési tájékoztató
            </h1>
            <p className="text-muted-foreground">
              Röviden és érthetően arról, mit kezelünk rólad, miért, és mit
              tehetsz vele. Hatályos: {EFFECTIVE_FROM}
            </p>
          </div>

          <Section title="Ki kezeli az adataidat?">
            <p>
              {DATA_CONTROLLER.name} (székhely: {DATA_CONTROLLER.seat},
              adószám: {DATA_CONTROLLER.taxNumber}). Bármilyen kérdéssel írj a{" "}
              {mail} címre, vagy postán a székhely címére.
            </p>
          </Section>

          <Section title="Milyen adatokat kezelünk?">
            <p>Most, a jelentkezéskor:</p>
            <ul className={list}>
              <li>a neved és az e-mail-címed,</li>
              <li>a város, ahol játszanál,</li>
              <li>ha párral jelentkezel, a párod neve és (ha megadod) az e-mail-címe,</li>
              <li>a szint, amit megadsz, és a megjegyzésed,</li>
              <li>ha megadod, melyik klubban játszol a legtöbbet,</li>
              <li>
                ha egy klub plakátjáról (QR-kóddal) érkeztél, a klub neve, hogy
                lássuk, melyik plakát hoz jelentkezőket,
              </li>
              <li>a jelentkezés és a hozzájárulás időpontja.</li>
            </ul>
            <p>
              Ha elindul a liga és regisztrálsz, ehhez jön még a fiókod adatai,
              egy nem kötelező telefonszám, a meccseid eredményei és az
              értékszámod. Erről a regisztráció előtt frissítjük ezt az oldalt.
            </p>
          </Section>

          <Section title="Mire használjuk?">
            <p>
              Csak a liga szervezésére: csoportok összeállítására, párkeresésre,
              és arra, hogy e-mailben értesítsünk az indulásról és a liga
              ügyeiről. Nem küldünk reklámot, és senkinek nem adjuk el vagy adjuk
              át az adataidat marketingcélra.
            </p>
            <p>
              Jelentkezéskor küldünk egy visszaigazolást. A körlevelek alján
              mindig van leiratkozó link; ha leiratkozol, a címedet csak azért
              őrizzük meg, hogy ne írjunk rá többet.
            </p>
            <p>
              Az adatkezelés alapja a hozzájárulásod, amit a jelentkezéskor adsz
              meg, és bármikor visszavonhatsz.
            </p>
          </Section>

          <Section title="Ki mit lát?">
            <ul className={list}>
              <li>
                <strong>Nyilvános</strong> (a liga indulása után): a neved, az
                eredményeitek, a tabella és az értékszámok.
              </li>
              <li>
                <strong>Soha nem nyilvános:</strong> az e-mail-címed és a
                telefonszámod.
              </li>
              <li>
                A jelentkezési listát csak a szervező látja, semmi nem
                kerül belőle nyilvánosságra.
              </li>
            </ul>
          </Section>

          <Section title="Ha a párodat is jelentkezteted">
            <p>
              Ha megadod a párod e-mail-címét, egyszer írunk neki, hogy tudjon a
              jelentkezésről, és kérhesse az adatai törlését. Ezen kívül semmit
              nem küldünk neki, amíg ő maga nem regisztrál. Kérjük, csak akkor add
              meg a párod adatait, ha ő is benne van.
            </p>
          </Section>

          <Section title="Hol tároljuk?">
            <p>
              Az adatok a Cloudflare szerverein vannak, nyugat-európai
              helyszínű adatbázisban. Akik a nevünkben hozzáférhetnek az
              adatokhoz (adatfeldolgozók):
            </p>
            <ul className={list}>
              <li>Cloudflare, Inc. – tárhely és adatbázis,</li>
              <li>Google (Google Workspace) – a {CONTACT_EMAIL} postafiók,</li>
              <li>Resend – a liga e-mailjeinek kiküldése.</li>
            </ul>
          </Section>

          <Section title="Meddig őrizzük?">
            <ul className={list}>
              <li>
                <strong>Jelentkezési lista:</strong> az első szezon indulása után
                töröljük, kivéve, ha regisztráltál.
              </li>
              <li>
                <strong>Fiókok</strong> (később): amíg nem kéred a törlést. Utána
                anonimizáljuk, hogy a korábbi eredmények megmaradjanak, de ne
                lehessen hozzád kötni őket.
              </li>
            </ul>
          </Section>

          <Section title="Mik a jogaid?">
            <p>
              Bármikor kérheted, hogy megmutassuk, javítsuk vagy töröljük az
              adataidat, és visszavonhatod a hozzájárulásodat. Ehhez elég egy
              e-mail a {mail} címre, és legkésőbb egy hónapon belül intézzük.
            </p>
            <p>
              Ha úgy érzed, megsértettük a jogaidat, panaszt tehetsz a Nemzeti
              Adatvédelmi és Információszabadság Hatóságnál (
              <a href="https://naih.hu" className="underline">
                naih.hu
              </a>
              ).
            </p>
          </Section>
        </Wrap>
      </main>
      <SiteFooter />
    </>
  );
}
