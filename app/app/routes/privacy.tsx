import type { Route } from "./+types/privacy";
import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import { CONTACT_EMAIL, DATA_CONTROLLER, pageMeta } from "~/lib/site";

// Spec section 17. Update the effective date whenever the content changes.
const EFFECTIVE_FROM = "2026. 11. 08.";

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
            <p>Ha fiókot hozol létre:</p>
            <ul className={list}>
              <li>a neved és az e-mail-címed,</li>
              <li>
                a szinted (kezdő, középhaladó, haladó vagy versenyző), amit te
                állítasz be, és amiből az induló Élő-pontod lesz; amint részt veszel egy szezonban, a profilodban már nem módosíthatod, mert innentől a liga eredményei döntik el,
              </li>
              <li>
                a telefonszámod (magyar szám lehet; kötelező, mert a meccseket
                telefonon egyeztetitek; a profilodban bármikor módosíthatod),
              </li>
              <li>
                hogy férfi vagy nő vagy (kötelező, te választod, sosem a nevedből
                találjuk ki; azért kérdezzük, hogy egy-egy levelet csak egy
                csoportnak küldhessünk, pl. női eseményről; nem nyilvános, más
                játékos nem látja, a profilodban módosíthatod),
              </li>
              <li>
                ha Google-fiókkal lépsz be, a Google-fiókod azonosítója (ebből
                tudjuk, hogy te vagy) és a profilképed,
              </li>
              <li>a fiók létrehozásának, a hozzájárulásodnak és az utolsó belépésednek az időpontja,</li>
              <li>
                melyik ligákhoz csatlakoztál, mikor és hogyan (a liga
                regisztrációs gombjával, párlinkkel, vagy mert párod lett
                benne),
              </li>
              <li>
                a párod a ligában (akivel a párlinkeddel összeálltatok, vagy
                akivel a szervező párba tett), és ha korábban pármeghívót
                küldtél vagy kaptál, az is (kinek az e-mail-címére, mikor, és
                elfogadták-e),
              </li>
              <li>
                a párotok nevezései a szezonokra (mikor neveztetek, melyik körtől
                játszotok), és ha korábban a szervező döntött róluk, a döntése az
                üzenetével együtt,
              </li>
              <li>
                az értesítéseid listája, és hogy e-mailben, push értesítésben
                vagy mindkettőben kéred-e őket (alapból mindkettő be van
                kapcsolva, a profilodban bármikor átállíthatod),
              </li>
              <li>
                ha egy eszközön bekapcsolod a push értesítést, a böngésződ
                értesítési címe az adott eszközre. Az értesítést titkosítva a
                böngésződ gyártójának értesítő szolgáltatása (pl. Google, Apple,
                Mozilla) juttatja el hozzád.
              </li>
            </ul>
            <p>
              Amikor elindul a liga, ehhez jön még a meccseid története
              (kivel, mikor és milyen eredménnyel játszottál), az Élő-pontod,
              és ha kapsz, a fekete pontjaid (mikor és miért; ha a szervező
              töröl egyet, az indoka is). A fekete pontjaidat csak te és a
              szervező látja; ha törlöd a fiókodat, a törlések indokát is
              töröljük.
            </p>
          </Section>

          <Section title="Mire használjuk?">
            <p>
              Csak a liga szervezésére: csoportok összeállítására, párkeresésre,
              és arra, hogy értesítsünk az indulásról és a liga ügyeiről. Nem
              küldünk reklámot, és senkinek nem adjuk el vagy adjuk át az
              adataidat marketingcélra.
            </p>
            <p>
              Az értesítéseidet a fiókodban mindig látod. A profilodban
              választod ki, hogy e-mailben, push értesítésben vagy mindkettőben
              is szóljunk. A belépési kódot mindig e-mailben küldjük. Ha időpontot ajánlanak a meccsedre vagy
              meg kell erősítened egyet, egy meccsről naponta legfeljebb egy
              levelet kapsz, a többit az oldalon és push értesítésben látod. A
              meccseid kevésbé sürgős híreiről, a meccs-emlékeztetőkről és a holnapi
              meccsedről csak az oldalon és push értesítésben szólunk, e-mailben
              nem. A fekete pontról az oldalon és push értesítésben szólunk; a
              másodiknál egy figyelmeztető levelet is küldünk. Ha egy új liga
              első szezonja összegyűjti a szükséges nevezéseket, minden nevezett
              játékosnak egy levelet küldünk az indulás napjával. Ha a szervező
              meghosszabbítja a futó kört, a kör minden játékosának küldünk egy
              levelet az új határidővel.
            </p>
            <p>
              Ha elakadsz a nevezés előtt (nem fejezted be a regisztrációt;
              nincs párod; vagy a pároddal nem neveztetek), és a liga szervezője bekapcsolta,
              szezononként legfeljebb egy emlékeztetőt küldünk a következő
              lépésről. Ehhez az e-mail-címeddel együtt feljegyezzük, melyik
              szezonban kaptál; a fiókod törlésével ezt is töröljük. Benne lehet
              a párod neve, de más e-mail-címe vagy telefonszáma soha. Ha
              kikapcsolod az e-mailt vagy leiratkozol, nem kapsz ilyet.
            </p>
            <p>
              A körlevelek alján mindig van leiratkozó link; ha leiratkozol, a címedet csak azért
              őrizzük meg, hogy ne írjunk rá többet.
            </p>
            <p>
              Az adatkezelés alapja a hozzájárulásod, amit az első belépéskor
              adsz meg, és bármikor visszavonhatsz.
            </p>
          </Section>

          <Section title="Ki mit lát?">
            <ul className={list}>
              <li>
                <strong>Nyilvánosan semmi</strong> nem jelenik meg a ligáról:
                se a neved, se a tabella, se az eredmények.
              </li>
              <li>
                <strong>Csak a belépett játékosok látják:</strong> a ligaoldalt
                (a csoportok kihirdetésétől a neved, a párod neve és a csoportod
                tabellája, a liga indulása után a meccsek eredménye is), a pár
                és a játékos profilját (a csoportjaitokat, a liga indulása után
                az eredményeiteket és a statisztikádat), és az Élő-pontodat meg
                annak alakulását.
              </li>
              <li>
                <strong>Soha nem nyilvános:</strong> az e-mail-címed és a
                telefonszámod.
              </li>
              <li>
                <strong>A párod</strong> látja az e-mail-címedet és a
                telefonszámodat a Profil oldalon, és megkapja a levélben, amiben
                a szervező értesít, hogy párba tett titeket, hogy el tudjátok
                érni egymást. Te is az övét.
              </li>
              <li>
                <strong>A telefonszámodat és az e-mail-címedet</strong> rajta kívül
                azok látják, akikkel az aktuális körben meccsed van, hogy egyeztetni
                tudjatok: a csoportok kihirdetése után a Kezdőlapjukon és a meccs
                oldalán, amíg a meccs eredménye nem végleges, legfeljebb a kör
                határidejéig; utána már nem. A telefonszámodat látja még a ligád szervezője és az
                oldal adminja is, hogy fel tudjanak hívni a ligával kapcsolatban
                (párkeresés, nevezés, elakadt meccs): a szervező a ligája
                játékosaiét a szervezői oldalakon, az admin mindenkiét. Más
                játékos nem látja.
              </li>
              <li>
                <strong>Az időpont-egyeztetést és az eredményt</strong> (ki,
                mikor, milyen időpontot ajánlott, fogadott el, erősített meg vagy
                mondott le, és hol lesz a meccs; ki rögzítette, erősítette meg
                vagy vitatta az eredményt, a vitához írt megjegyzéssel együtt) a
                meccs két párja látja a meccs oldalán, és a liga szervezője meg
                az oldal adminja is (a nevekkel, telefonszám és e-mail-cím
                nélkül), hogy lássák, melyik meccs akadt el, és dönthessenek a
                vitás eredményekről. Megőrizzük, mert a határidőig le nem
                játszott meccsekről ez alapján dönt a rendszer, a vitás
                eredményekről pedig a szervező. Ha a szervező dönt egy meccsről,
                a döntése a nevével, idejével és indoklásával bekerül a naplóba,
                amit mindkét pár lát.
              </li>
              <li>
                <strong>A helyettes kérést</strong> (ki kérte, ki helyett ki
                játszana, és a szervező döntése) a pár és a liga szervezője meg
                az oldal adminja látja; a szervező a két játékos Élő-pontját is,
                hogy dönthessen. A jóváhagyott helyettes nevét az ellenfeleid is
                látják a meccs oldalán. A szervező indoklását csak a pár látja,
                és ha törlöd a fiókodat, töröljük. Ha regisztráltál, a neved
                (csak a neved, soha az e-mail-címed vagy a telefonszámod)
                megjelenhet a ligád játékosainak helyettes-választó listájában,
                amikor egy meccsükre helyettest kérnek.
              </li>
              <li>
                <strong>A „nem jöttek el” bejelentést</strong> (melyik pár
                jelezte és mikor, és a szervező döntése az indoklásával) mindkét
                pár, a liga szervezője és az oldal adminja látja. Ha a szervező
                jóváhagyja, a döntése a nevével és idejével a meccs naplójába is
                bekerül, a másik pár játékosai pedig fekete pontot kapnak. A
                szervező indoklását, ha törlöd a fiókodat, töröljük.
              </li>
              <li>
                A nevezéseket a liga szervezője látja: a pár két tagjának nevét,
                szintjét és azt, hogy mikor neveztetek; az e-mail-címeteket és a
                telefonszámotokat nem.
              </li>
              <li>
                Ha a szervező visszaléptet egy párt a kihirdetett csoportból, az indokát csak a
                szervező, az admin és a pár két tagja látja. A csoport többi
                párja és a nyilvános tabella csak azt, hogy a pár visszalépett.
              </li>
              <li>
                A csoportok összeállításakor a szervező a pár két tagjának nevét
                és az Élő-pontotokat látja. A csoportbeosztásról mindenki
                értesítést kap (e-mailben is, ha nem kapcsolta ki), benne az
                ellenfelei nevével; az e-mail-címeteket és a telefonszámotokat
                nem.
              </li>
            </ul>
          </Section>

          <Section title="Ha linkkel hívod meg a párodat">
            <p>
              Amíg nincs párod, a Kezdőlapon és a Profil oldalon kapsz egy saját
              linket, amit te küldesz el annak, akivel játszanál. Aki megnyitja,
              a neved és a liga nevét látja, az e-mail-címedet és a
              telefonszámodat nem. Ha regisztrál és elfogadja, pár lesztek. A
              linket mi nem küldjük el senkinek, és erről nem megy e-mail.
            </p>
          </Section>
          <Section title="Ha párt keresel">
            <p>
              Amíg nincs párod, a Profil oldalon bekapcsolhatod a „Párt keresek”
              jelzést. Ilyenkor a szervező látja a neved, a szinted, a
              telefonszámod és azt, hogy mióta keresel párt, és párba tehet egy
              másik párkeresővel. Erről az oldalon és e-mailben is szólunk, benne
              a párod nevével, e-mail-címével és telefonszámával. A jelzés
              alapból ki van kapcsolva, és bármikor kikapcsolhatod.
            </p>
          </Section>

          <Section title="Ha változik a párod">
            <p>
              Felbontani vagy cserélni a párt a szervező tud: írj
              nekünk, ha változna a párod. Ha a szervező párba tesz valakivel
              (új pár vagy partnercsere), az oldalon és e-mailben is szólunk,
              benne a párod nevével, e-mail-címével és telefonszámával, hogy el
              tudjátok érni egymást. A felbontásról nem küldünk e-mailt, a
              szervező szól nektek. A Párok oldalon a szervező a játékosok nevét,
              szintjét és telefonszámát látja, az e-mail-címeteket nem.
              Ugyanitt be is nevezhet titeket egy szezonra, vagy kivehet belőle;
              ezt az oldalon (és push értesítésben, ha bekapcsoltad) jelezzük,
              e-mailben nem. Hogy ki és mikor tette, eltároljuk. A Párok oldalon
              a regisztrált, még pár nélküli játékosok is szerepelnek: a nevük, a
              szintjük és az, hogy párt keresnek-e. Az Admin innen körlevelet
              írhat a listán látott játékosoknak (például akik még nem neveztek);
              aki leiratkozott vagy kikapcsolta az e-mailt, nem kapja meg.
            </p>
          </Section>

          <Section title="Belépés és süti">
            <p>
              Jelszót nem kérünk és nem tárolunk. Belépni Google-fiókkal vagy egy
              e-mailben küldött, 10 percig érvényes kóddal lehet.
            </p>
            <p>
              Belépés után egy sütit (cookie) teszünk a böngésződbe, hogy 90
              napig ne kelljen újra belépned. Ez a működéshez szükséges, nem
              követ, és nem ad ki rólad semmit. Kilépéskor töröljük.
            </p>
            <p>
              Ha Google-fiókkal lépsz be, a Google átadja nekünk a neved, az
              e-mail-címed, a fiókod azonosítóját és a profilképed címét. A
              profilképet csak a fiókodban mutatjuk, és a Google szerveréről
              töltődik be. A leveleinket is a Google küldi ki (lásd lent).
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
              <li>Cloudflare, Inc. – tárhely, adatbázis, látogatási statisztika és a belépési kód kérésének robotszűrője (Turnstile),</li>
              <li>Google (Google Workspace) – a {CONTACT_EMAIL} postafiók és a liga e-mailjeinek kiküldése,</li>
              <li>Resend – a liga e-mailjeinek kiküldése, ha a Google épp nem tudja.</li>
            </ul>
          </Section>

          <Section title="Meddig őrizzük?">
            <ul className={list}>
              <li>
                <strong>Fiókok:</strong> amíg nem törlöd (a Profil oldalon) vagy
                nem kéred a törlést. Ha még nem
                játszottál kihirdetett csoportban, és jóváhagyott helyettes sem
                voltál, a fiókodat mindenestül töröljük. Ha már igen, anonimizáljuk: a neved helyén „Törölt
                játékos” áll, hogy a korábbi eredmények megmaradjanak, de ne
                lehessen hozzád kötni őket. Az e-mail-címedet, a
                telefonszámodat, a nemedet, a belépéseidet és az eszközeidet
                ilyenkor teljesen töröljük.
              </li>
              <li>
                <strong>Levelek:</strong> a levél szövegét csak a kiküldésig
                őrizzük (ha a napi limit miatt várnia kell, addig), utána csak
                azt, hogy kinek, mikor és milyen tárggyal ment, és ha a Resend
                visszajelzi, azt is, hogy megérkezett-e, visszapattant-e vagy
                spamnek jelölted-e. Ezt csak az admin látja.
              </li>
              <li>
                <strong>Belépési kód:</strong> magát a kódot nem tároljuk,
                csak egy lenyomatát, az e-mail-címeddel, a próbálkozásaid és a
                kért kódok számával együtt. Belépéskor
                azonnal töröljük, különben a kód lejárta után nagyjából egy
                órával magától törlődik.
              </li>
              <li>
                <strong>Technikai napló:</strong> a hibák kereséséhez a
                szerver feljegyzi, mikor melyik oldalt kérték, mi lett a
                válasz, és belépve a fiókod azonosítóját. Neved, e-mail-címed,
                telefonszámod nincs benne. A Cloudflare 3 napig őrzi, utána
                magától törlődik.
              </li>
              <li>
                <strong>Biztonsági mentés:</strong> naponta másolat készül az
                egész adatbázisról, a Cloudflare EU-s tárhelyén. A mentéseket 35
                napig őrizzük, ezért a törölt vagy anonimizált adataid a
                mentésekből is legfeljebb 35 nap alatt tűnnek el.
              </li>
            </ul>
          </Section>

          <Section title="Mik a jogaid?">
            <p>
              Bármikor kérheted, hogy megmutassuk, javítsuk vagy töröljük az
              adataidat, és visszavonhatod a hozzájárulásodat. Ehhez elég egy
              e-mail a {mail} címre, és legkésőbb egy hónapon belül intézzük.
              A fiókodat te magad is törölheted a Profil oldalon („Fiók
              törlése”): ugyanaz történik, mint ha mi törölnénk, és minden
              eszközön kiléptetünk.
            </p>
            <p>
              Törléskor a fiókoddal együtt töröljük a neked szóló leveleket,
              és a neved meg a címed a másoknak szóló, még ki nem küldött
              levelekből is. Amíg a párod
              kihirdetett csoportban játszik, és a kör még nem ért véget, a
              Profil oldalon nem tudod törölni a fiókodat; ha ilyenkor kéred
              e-mailben, a kör végén törlünk. A címedhez tartozó minden tárolt adatot
              törlünk, a leiratkozásodat vagy a visszapattanó levelek
              nyomát is. Csak a régi eredményekben marad meg a neved
              névtelenítve („Törölt játékos”). Ha később újra regisztrálsz
              ezzel a címmel, tiszta lappal indulsz. A törlésről nem
              küldünk levelet.
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
