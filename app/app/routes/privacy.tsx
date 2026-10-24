import type { Route } from "./+types/privacy";
import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import { CONTACT_EMAIL, DATA_CONTROLLER, pageMeta } from "~/lib/site";

// Spec section 17. Update the effective date whenever the content changes.
const EFFECTIVE_FROM = "2026. 10. 24.";

export function meta({}: Route.MetaArgs) {
  return pageMeta({
    title: "Adatkezelési tájékoztató – Padelpárbaj",
    description: "Milyen adatokat kezelünk, miért, és mik a jogaid.",
    path: "/privacy",
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
              <li>
                ha hirdetésből vagy más megjelölt linkről érkeztél, a link
                forrása (pl. „facebook”), hogy lássuk, mi hoz jelentkezőket,
              </li>
              <li>a jelentkezés és a hozzájárulás időpontja.</li>
            </ul>
            <p>Ha fiókot hozol létre:</p>
            <ul className={list}>
              <li>a neved és az e-mail-címed,</li>
              <li>
                a szinted (kezdő, középhaladó, haladó vagy versenyző), amit te
                állítasz be, és amiből az induló értékszámod lesz,
              </li>
              <li>
                ha megadod, a telefonszámod (magyar szám lehet, nem kötelező, a
                profilodban bármikor módosíthatod vagy törölheted),
              </li>
              <li>
                ha Google-lel lépsz be, a Google-fiókod azonosítója (ebből
                tudjuk, hogy te vagy) és a profilképed,
              </li>
              <li>a fiók létrehozásának és a hozzájárulásodnak az időpontja,</li>
              <li>
                a párod a ligában, és a pármeghívók, amiket küldtél vagy kaptál
                (kinek az e-mail-címére, mikor, és elfogadták-e),
              </li>
              <li>
                a párotok nevezései a szezonokra (mikor neveztetek), és a szervező
                döntése az üzenetével együtt.
              </li>
            </ul>
            <p>
              Amikor elindul a liga, ehhez jön még a meccseid története
              (kivel, mikor és milyen eredménnyel játszottál) és az értékszámod.
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
                <strong>A telefonszámodat</strong> csak azok látják, akikkel az
                aktuális körben meccsed van, hogy egyeztetni tudjatok. Más
                játékos nem látja, és a szervezői felületeken sem jelenik meg. Ezt a funkciót a liga
                indulásával kapcsoljuk be; addig a számod sehol nem jelenik meg.
              </li>
              <li>
                A jelentkezési listát csak a szervező látja, semmi nem
                kerül belőle nyilvánosságra. A városod ligájának szervezője az
                egyedül jelentkezők nevét, szintjét, megjegyzését és azt, hogy hol
                játszanak a legtöbbet, hogy párt találjon nekik; az
                e-mail-címüket nem.
              </li>
              <li>
                A nevezéseket a liga szervezője látja: a pár két tagjának nevét,
                szintjét és azt, hogy mikor neveztetek; az e-mail-címeteket és a
                telefonszámotokat nem.
              </li>
              <li>
                A csoportok összeállításakor a szervező a pár két tagjának nevét
                és az értékszámotokat látja. A csoportbeosztásról mindenki
                e-mailt kap, benne az ellenfelei nevével; az e-mail-címeteket és
                a telefonszámotokat nem.
              </li>
            </ul>
          </Section>

          <Section title="Ha a párodat is jelentkezteted">
            <p>
              Ha megadod a párod e-mail-címét, egyszer írunk neki, hogy tudjon a
              jelentkezésről, és kérhesse az adatai törlését. Amikor indul a
              regisztráció, neki is küldünk egy meghívót. Ezen kívül semmit nem
              küldünk neki, amíg ő maga nem regisztrál. Kérjük, csak akkor add
              meg a párod adatait, ha ő is benne van.
            </p>
            <p>
              Ha mindketten regisztráltatok, a ligában magától pár lesztek. Amíg
              csak egyikőtök regisztrált, ő a Párom oldalon látja a másik nevét a
              jelentkezésből, az e-mail-címét nem.
            </p>
          </Section>

          <Section title="Ha párnak hívsz meg valakit">
            <p>
              A párodat az e-mail-címével hívod meg. Eltároljuk a címet, és
              küldünk rá egy levelet a neveddel és egy linkkel, amivel elfogadhatja
              vagy jelezheti, hogy nem kéri. Ha még nincs fiókja, ezzel a címmel
              regisztrálhat. A válaszáról e-mailt kapsz. A meghívót csak az
              fogadhatja el, akinek a címére ment. Kérjük, csak olyat hívj meg,
              aki tud róla.
            </p>
            <p>
              A pár oldalán a párod csak a neved látja, az e-mail-címedet és a
              telefonszámodat nem. Ha megszünteted a párt, e-mailt kap róla a
              neveddel.
            </p>
          </Section>

          <Section title="Ha egyedül jelentkezel">
            <p>
              Ha a szervező talál neked hasonló szintű párt a többi egyedül
              jelentkező közül, egy e-mailben elküldjük nektek egymás nevét,
              szintjét és e-mail-címét, hogy megbeszélhessétek. Mást nem adunk át,
              és a szervező sem látja az e-mail-címedet. Ha ezt nem szeretnéd,
              írd meg a megjegyzésben, vagy írj nekünk.
            </p>
            <p>
              Ha párt kaptál, a regisztráció indulásakor mindketten meghívót
              kaptok, és ha mindketten regisztráltatok, a ligában magától pár
              lesztek. Amíg csak egyikőtök regisztrált, ő a Párom oldalon látja a
              másik nevét.
            </p>
          </Section>

          <Section title="Belépés és süti">
            <p>
              Jelszót nem kérünk és nem tárolunk. Belépni Google-lel vagy egy
              e-mailben küldött, 10 percig érvényes kóddal lehet.
            </p>
            <p>
              Belépés után egy sütit (cookie) teszünk a böngésződbe, hogy 90
              napig ne kelljen újra belépned. Ez a működéshez szükséges, nem
              követ, és nem ad ki rólad semmit. Kilépéskor töröljük.
            </p>
            <p>
              Ha Google-lel lépsz be, a Google átadja nekünk a neved, az
              e-mail-címed, a fiókod azonosítóját és a profilképed címét. A
              profilképet csak a fiókodban mutatjuk, és a Google szerveréről
              töltődik be. Ezen kívül a Google semmit nem tud meg rólad tőlünk.
            </p>
          </Section>

          <Section title="Látogatási statisztika">
            <p>
              Az oldal látogatottságát a Cloudflare Web Analytics méri. Nem
              használ sütit, nem követ más oldalakon, és nem azonosít téged: csak
              összesített számokat látunk (hány látogatás, melyik oldal, honnan
              érkeztek, milyen eszközről).
            </p>
            <p>
              A főoldal megnyitásait mi is megszámoljuk naponta és forrásonként
              (pl. plakát vagy hirdetés), de rólad semmit nem tárolunk hozzá.
            </p>
          </Section>

          <Section title="Hol tároljuk?">
            <p>
              Az adatok a Cloudflare szerverein vannak, az adatbázis az Európai
              Unióban (Prágában). Akik a nevünkben hozzáférhetnek az adatokhoz
              (adatfeldolgozók):
            </p>
            <ul className={list}>
              <li>Cloudflare, Inc. – tárhely, adatbázis, látogatási statisztika és a jelentkezési űrlap robotszűrője (Turnstile),</li>
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
                <strong>Fiókok:</strong> amíg nem kéred a törlést. Utána
                anonimizáljuk, hogy a korábbi eredmények megmaradjanak, de ne
                lehessen hozzád kötni őket. A telefonszámodat ilyenkor teljesen
                töröljük.
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
