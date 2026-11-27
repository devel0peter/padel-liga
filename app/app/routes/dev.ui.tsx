import { CalendarDays, Check, Clock, Ellipsis, Trophy } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import type { Route } from "./+types/dev.ui";
import {
  ActionCard,
  BigRank,
  IconTile,
  ListCard,
  ListRow,
  MatchRow,
  OverflowRow,
  PageHeader,
  RoundProgress,
  ScoreBoard,
  SectionLabel,
  Segmented,
  SlotPicker,
  StatTile,
  StatusPill,
  TEAM_HUES,
  TeamBadge,
  TeamName,
  type SlotDay,
  type TeamBadgeSize,
} from "~/components/blocks";
import { Button } from "~/components/ui/button";

// The gallery of direction A's building blocks (D181, #418): every block in
// every state, at the window's width. Local development only: a production
// build (`npm run build`, so CI's and the deploy's) answers 404. Fake data.

export function loader() {
  if (!import.meta.env.DEV) throw new Response(null, { status: 404, statusText: "Not Found" });
  return null;
}

export const meta: Route.MetaFunction = () => [{ title: "Építőkockák · Padelpárbaj" }, { name: "robots", content: "noindex" }];

const ANNA: readonly [string, string] = ["KA", "NB"];
const HORVATH: readonly [string, string] = ["HZ", "MD"];
const SZABO: readonly [string, string] = ["SzE", "TG"];

const DAYS: SlotDay[] = [
  { label: "nov. 28., szombat", slots: [{ value: "2026-11-28T19:00", label: "19:00" }, { value: "2026-11-28T20:00", label: "20:00" }] },
  { label: "nov. 29., vasárnap", slots: [{ value: "2026-11-29T18:00", label: "18:00" }, { value: "2026-11-29T19:00", label: "19:00" }] },
  {
    label: "nov. 30., hétfő",
    slots: [
      { value: "2026-11-30T10:00", label: "10:00" },
      { value: "2026-11-30T11:00", label: "11:00", disabled: true },
      { value: "2026-11-30T12:00", label: "12:00" },
    ],
  },
];

function Block({ name, note, children }: { name: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`block-${name}`} className="flex flex-col gap-4 border-t border-hairline pt-8">
      <div className="flex flex-col gap-1">
        <h2 id={`block-${name}`} className="m-0 font-mono text-lg font-bold">
          {name}
        </h2>
        {note && <p className="m-0 text-caption text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

// One state of a block, named.
function State({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      <div className={className}>{children}</div>
    </div>
  );
}

const grid = "grid gap-6 md:grid-cols-2";

function Swatch({ name, color, text }: { name: string; color: string; text?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg text-xs font-bold ring-1 ring-white/10" style={{ background: `var(${color})`, color: text ? `var(${text})` : undefined }}>
        {text ? "Aa" : null}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-bold">{name}</span>
        <span className="font-mono text-xs text-muted-foreground">{color}</span>
      </span>
    </div>
  );
}

function Tokens() {
  const swatches: [string, string, string?][] = [
    ["Alap (ground)", "--ground", "--foreground"],
    ["Oldalsáv", "--sidebar", "--soft-foreground"],
    ["Kártya (surface)", "--surface", "--foreground"],
    ["Csempe (surface-2)", "--surface-2", "--muted-foreground"],
    ["Másodlagos (surface-3)", "--surface-3", "--foreground"],
    ["Nyertes szett (surface-4)", "--surface-4", "--foreground"],
    ["Labda (fő gomb)", "--ball", "--ball-foreground"],
    ["Siker", "--success-tint", "--success"],
    ["Rád vár", "--warning-tint", "--warning"],
    ["Időpont kell", "--info-tint", "--info"],
    ["Hiba, vereség", "--danger-tint", "--danger"],
    ["Bronz", "--division-bronz"],
    ["Réz", "--division-rez"],
    ["Rookie", "--division-rookie"],
  ];
  return (
    <Block name="Tokens" note="app/app/app.css: színek és betűk. Minden szöveg/háttér pár legalább 4,5:1.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {swatches.map(([name, color, text]) => (
          <Swatch key={color} name={name} color={color} text={text} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: TEAM_HUES }, (_, i) => (
          <TeamBadge key={i} pairId={i} initials={ANNA} size={40} on="ground" />
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4">
        <span className="type-display text-5xl">Display 48</span>
        <span className="type-display text-[34px]">Display 34 · 1604</span>
        <span className="text-body">Szöveg 15 px: Horváth / Molnár ellen, nov. 24., kedd 19:00.</span>
        <span className="text-caption text-muted-foreground">Felirat 13 px: dec. 6., 23:59-ig</span>
        <span className="type-label text-muted-foreground">Szakasz címke 13 px</span>
      </div>
    </Block>
  );
}

export default function DevUi() {
  const [slot, setSlot] = useState<string | null>("2026-11-29T19:00");
  const [view, setView] = useState("groups");
  const [three, setThree] = useState("week");
  const [who, setWho] = useState("players");
  const [params] = useSearchParams();
  const linked = params.get("tab") ?? "profile";
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 md:px-8">
      <PageHeader eyebrow="Csak helyi fejlesztésben · #418" title="Építőkockák" />

      <Tokens />

      <Block name="PageHeader" note="Szemöldöksor, display cím, jobb oldali hely; opcionális vissza link.">
        <State label="szemöldök + cím">
          <PageHeader eyebrow="Teszt szezon · Mintaváros" title="Szia, Anna!" />
        </State>
        <State label="vissza link + csapatok a címben">
          <PageHeader
            back={{ to: "/dev/ui", label: "Kezdőlap" }}
            eyebrow="Bronz · 1. csoport · 2. hét · nov. 24., kedd 19:00"
            title={
              <span className="flex flex-col gap-2 text-[32px] md:text-[40px]">
                <span className="flex items-center gap-2.5">
                  <TeamBadge pairId={0} initials={ANNA} size={30} on="ground" />
                  <TeamName name="Kovács / Nagy" variant="display" own />
                </span>
                <span className="text-caption text-muted-foreground [font-stretch:100%]">VS</span>
                <span className="flex items-center gap-2.5">
                  <TeamBadge pairId={2} initials={HORVATH} size={30} on="ground" />
                  <TeamName name="Horváth / Molnár" variant="display" />
                </span>
              </span>
            }
          />
        </State>
        <State label="jobb oldali hely: kör állása">
          <PageHeader
            eyebrow="Teszt szezon · Mintaváros"
            title="Szia, Anna!"
            aside={
              <div className="w-[358px] max-w-full md:w-[340px]">
                <RoundProgress round={1} week={2} deadline="dec. 6., 23:59" daysLeft={9} progress={0.57} />
              </div>
            }
          />
        </State>
        <State label="sárga szemöldök + gomb">
          <PageHeader
            eyebrow={<span className="font-bold text-warning">2 olvasatlan</span>}
            title="Értesítések"
            aside={
              <Button variant="secondary" className="h-9 rounded-full px-3">
                Mind olvasott
              </Button>
            }
          />
        </State>
        <State label="hosszú cím">
          <PageHeader eyebrow="Ligáim · Teszt szezon" title="Padelpárbaj Mintaváros" />
        </State>
      </Block>

      <Block name="TeamBadge" note="20 / 30 / 40 / 56 px, a szín a pár azonosítójából; 20 px-en nincs betű.">
        {(["ground", "surface"] as const).map((on) => (
          <State key={on} label={`on="${on}"`} className={on === "surface" ? "flex flex-wrap items-center gap-6 rounded-2xl bg-surface p-4" : "flex flex-wrap items-center gap-6"}>
            {([20, 30, 40, 56] as TeamBadgeSize[]).map((size) => (
              <TeamBadge key={size} pairId={size} initials={ANNA} size={size} on={on} />
            ))}
          </State>
        ))}
      </Block>

      <Block name="TeamName" note="A szöveg a hívótól jön (#419). Display vagy szöveg stílus, opcionális TI / TE jel.">
        <div className={grid}>
          <State label="body">
            <TeamName name="Szabó / Tóth" />
          </State>
          <State label="body, own">
            <TeamName name="Kovács / Nagy" own />
          </State>
          <State label="display" className="text-[32px]">
            <TeamName name="Horváth / Molnár" variant="display" />
          </State>
          <State label="display, own (TI)" className="text-[32px]">
            <TeamName name="Kovács / Nagy" variant="display" own />
          </State>
          <State label="body, own player (TE)">
            <TeamName name="Kovács Anna" own ownTag="TE" />
          </State>
          <State label="display, long, own" className="max-w-[300px] text-[32px]">
            <TeamName name="Mészárosné Kiss / Simon-Fehér" variant="display" own />
          </State>
        </div>
      </Block>

      <Block name="StatusPill" note="success / warning / info / danger / neutral; emphasis: a nagybetűs RÁD VÁR.">
        <State label="normal" className="flex flex-wrap gap-2">
          <StatusPill tone="success">Győzelem · 1. hét</StatusPill>
          <StatusPill tone="warning">Megerősítésre vár · 2. hét</StatusPill>
          <StatusPill tone="info">Időpont kell · 3. hét</StatusPill>
          <StatusPill tone="danger">Vereség</StatusPill>
          <StatusPill tone="neutral">Fix időpont</StatusPill>
        </State>
        <State label="emphasis" className="flex flex-wrap gap-2">
          <StatusPill tone="warning" emphasis>
            Rád vár
          </StatusPill>
          <StatusPill tone="info" emphasis>
            Időpont kell
          </StatusPill>
          <StatusPill tone="danger" emphasis>
            Vitatott
          </StatusPill>
        </State>
        <State label="on a card" className="flex flex-wrap gap-2 rounded-2xl bg-surface p-4">
          <StatusPill tone="success">Győzelem</StatusPill>
          <StatusPill tone="warning">Megerősítésre vár</StatusPill>
          <StatusPill tone="info">Időpont kell</StatusPill>
          <StatusPill tone="danger">Vereség</StatusPill>
          <StatusPill tone="neutral">Lejátszva</StatusPill>
        </State>
      </Block>

      <Block name="SectionLabel" note="13 px, félkövér, ritkított, nagybetűs; sárga csak a Rád vár.">
        <State label="muted">
          <SectionLabel>Meccseid az 1. körben</SectionLabel>
        </State>
        <State label="warning">
          <SectionLabel tone="warning">Rád vár · 2</SectionLabel>
        </State>
      </Block>

      <Block name="ActionCard" note="A Rád vár kártya: jel vagy ikon, cím, egy-két sor, legfeljebb egy fő gomb; vagy link a teendő oldalára.">
        <div className="grid gap-6 lg:grid-cols-2">
          <State label="urgent, primary + secondary" className="flex flex-col gap-3">
            <ActionCard
              urgent
              leading={<TeamBadge pairId={2} initials={HORVATH} size={30} />}
              title="Erősítsd meg az eredményt"
              description={
                <>
                  Horváth / Molnár ellen: <strong className="text-foreground">4:5, 2:4</strong>
                </>
              }
              note="Ma 11:54-kor magától elfogadjuk."
              actions={
                <>
                  <Button size="xl">Megerősítem</Button>
                  <Button size="xl" variant="secondary">
                    Nem így volt
                  </Button>
                </>
              }
            />
          </State>
          <State label="link, with link label (desktop)">
            <ActionCard
              to="/dev/ui"
              linkLabel="Megnézem"
              leading={<TeamBadge pairId={1} initials={SZABO} size={30} />}
              title="Válassz időpontot"
              description="Szabó / Tóth 7 időpontot ajánlott a 3. hétre"
            />
          </State>
          <State label="one primary, no leading">
            <ActionCard urgent title="Nevezzetek a 2. körre" description="dec. 6., 23:59-ig" actions={<Button size="xl">Nevezünk</Button>} />
          </State>
          <State label="icon, no action">
            <ActionCard
              leading={
                <IconTile tone="success">
                  <Check strokeWidth={2.6} />
                </IconTile>
              }
              title="Benne vagytok a 2. körben"
              description="dec. 7-től, nem kell tenned semmit"
            />
          </State>
          <State label="link, no label">
            <ActionCard
              to="/dev/ui"
              leading={
                <IconTile tone="info">
                  <CalendarDays />
                </IconTile>
              }
              title="Rögzítsétek az időpontot"
              description="Megbeszéltétek? Két koppintás."
            />
          </State>
        </div>
      </Block>

      <Block name="RoundProgress" note="Kör, hét, határidő, hátralévő napok, sáv.">
        <div className={grid}>
          <State label="mid-round, with note">
            <RoundProgress round={1} week={2} deadline="dec. 6., vas. 23:59" daysLeft={9} progress={0.57} note="1 / 3 meccsetek kész" />
          </State>
          <State label="just started">
            <RoundProgress round={2} week={1} deadline="jan. 3., 23:59" daysLeft={27} progress={0.04} />
          </State>
          <State label="last day">
            <RoundProgress round={1} week={3} deadline="dec. 6., 23:59" daysLeft={0} progress={0.98} />
          </State>
          <State label="no week">
            <RoundProgress round={3} deadline="febr. 1., 23:59" daysLeft={12} progress={0.4} note="A ligában 4 / 15 meccs kész · 11 pár, 3 csoport" />
          </State>
        </div>
      </Block>

      <Block name="BigRank" note="A nagy, keskeny helyezés a felirattal.">
        <div className={grid}>
          <State label="md, with detail" className="rounded-2xl bg-surface p-5">
            <BigRank place={1} caption="hely, 3 ponttal" detail="Bronz divízió · 1. csoport" />
          </State>
          <State label="lg, no detail" className="rounded-2xl bg-surface p-5">
            <BigRank place={4} caption="hely, 1 ponttal" size="lg" />
          </State>
        </div>
      </Block>

      <Block name="StatTile" note="Felirat + keskeny szám, opcionális változás; kártyán, az oldalon, és a nagy változat.">
        <State label='on="card"' className="grid grid-cols-3 gap-2 rounded-2xl bg-surface p-4">
          <StatTile label="Meccs" value={1} />
          <StatTile label="Győzelem" value={1} tone="success" />
          <StatTile label="Élő-pontod" value={1604} delta={4} />
        </State>
        <State label='on="page"' className="grid grid-cols-3 gap-2">
          <StatTile on="page" label="Meccs" value={12} />
          <StatTile on="page" label="Élő-pont" value={1287.5} delta={-3.5} />
          <StatTile on="page" label="Vereség" value={0} delta={0} />
        </State>
        <div className={grid}>
          <State label='size="lg", up'>
            <StatTile size="lg" label="Élő-pont" value={1604} delta={4} deltaCaption="az utolsó meccsen" />
          </State>
          <State label='size="lg", down, no change line'>
            <StatTile size="lg" label="Élő-pont" value={1196} delta={-8} />
          </State>
        </div>
      </Block>

      <Block name="ListCard + ListRow" note="Sorok vékony elválasztóval: sima, link (nyíllal), gomb, kiemelt link.">
        <div className={grid}>
          <State label="plain, description, trailing">
            <ListCard label="Példa">
              <ListRow leading={<IconTile><Clock /></IconTile>}>Példa Padel Club</ListRow>
              <ListRow description="nov. 24., kedd 19:00" trailing={<StatusPill tone="neutral">Fix</StatusPill>}>
                Időpont
              </ListRow>
            </ListCard>
          </State>
          <State label="links + accent">
            <ListCard>
              <ListRow to="/dev/ui">Egyik sem jó? Ajánlj te időpontot</ListRow>
              <ListRow to="/dev/ui">Máshogy beszéltétek meg? Rögzítsd</ListRow>
              <ListRow to="/dev/ui" tone="accent">
                A csoport meccsei (6)
              </ListRow>
            </ListCard>
          </State>
          <State label="link with avatar, button with ellipsis">
            <ListCard>
              <ListRow
                to="/dev/ui"
                leading={<span className="grid size-10 place-items-center rounded-full text-sm font-bold" style={{ background: "var(--team-0-light)" }}>NB</span>}
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Párod</span>
                  <span className="text-base font-bold">Nagy Bence</span>
                </span>
              </ListRow>
              <ListRow onClick={() => {}} leading={<Ellipsis aria-hidden className="size-5 text-muted-foreground" />}>
                Partnercsere, szabályzat
              </ListRow>
            </ListCard>
          </State>
          <State label="no chevron on a link">
            <ListCard>
              <ListRow to="/dev/ui" chevron={false} description="Bronz divízió, 1. csoport · nov. 15.">
                Kész az 1. kör beosztása
              </ListRow>
            </ListCard>
          </State>
        </div>
      </Block>

      <Block name="MatchRow" note="Állapot (pill, héttel), ellenfél, jobbra az eredmény vagy az időszak.">
        <ListCard label="Meccseid az 1. körben">
          <MatchRow status={{ tone: "success", label: "Győzelem" }} week="1. hét" opponent="Farkas / Papp" score="4:2, 4:1" to="/dev/ui" />
          <MatchRow status={{ tone: "warning", label: "Megerősítésre vár" }} week="2. hét" opponent="Horváth / Molnár" score="4:5, 2:4" />
          <MatchRow status={{ tone: "info", label: "Időpont kell" }} week="3. hét" opponent="Szabó / Tóth" when="nov. 30. – dec. 6." />
          <MatchRow status={{ tone: "danger", label: "Vereség" }} opponent="Mészáros / Simon" score="2:6, 3:6" />
          <MatchRow status={{ tone: "neutral", label: "Fix időpont" }} week="3. hét" opponent="Szabó / Tóth" when="kedd 19:00" />
          <MatchRow status={{ tone: "danger", label: "Vitatott" }} week="2. hét" opponent={<TeamName name="Lakatos / Gulyás" />} />
        </ListCard>
      </Block>

      <Block name="ScoreBoard" note="Két csapat sora × szettek, a nyertes jelölve; győztes nélkül egyformák.">
        <div className="grid gap-6 lg:grid-cols-3">
          <State label="second team won" className="rounded-2xl bg-surface p-4">
            <ScoreBoard teams={["Kovács / Nagy", "Horváth / Molnár"]} sets={[[4, 5], [2, 4]]} winner={1} />
          </State>
          <State label="first won, super tie-break" className="rounded-2xl bg-surface p-4">
            <ScoreBoard teams={["Kovács / Nagy", "Szabó / Tóth"]} sets={[[6, 4], [5, 7], [10, 7]]} winner={0} />
          </State>
          <State label="no winner yet" className="rounded-2xl bg-surface p-4">
            <ScoreBoard teams={["Kovács / Nagy", "Farkas / Papp"]} sets={[[6, 3], [4, 6]]} />
          </State>
        </div>
      </Block>

      <Block name="SlotPicker" note="Időpont csipek naponként, egy választható; rádiógombok, így űrlapban is megy.">
        <div className={grid}>
          <State label="controlled, one selected, one disabled" className="rounded-2xl bg-surface p-4">
            <SlotPicker name="start" label="Kezdés" days={DAYS} value={slot} onValueChange={setSlot} />
            <p className="mt-3 mb-0 font-mono text-xs text-muted-foreground">value: {slot ?? "–"}</p>
          </State>
          <State label="nothing selected" className="rounded-2xl bg-surface p-4">
            <SlotPicker name="start-empty" label="Kezdés" days={DAYS.slice(0, 2)} />
          </State>
        </div>
      </Block>

      <Block name="Segmented" note="Két- vagy háromállású kapcsoló: tabs (nézetek) vagy pills (szűrő); linkekkel nav.">
        <div className={grid}>
          <State label="tabs, buttons">
            <Segmented
              label="Nézet"
              value={view}
              onValueChange={setView}
              options={[
                { value: "groups", label: "Csoportok" },
                { value: "rankings", label: "Ranglista" },
              ]}
            />
          </State>
          <State label="tabs, three">
            <Segmented
              label="Időszak"
              value={three}
              onValueChange={setThree}
              options={[
                { value: "week", label: "Hét" },
                { value: "round", label: "Kör" },
                { value: "season", label: "Szezon" },
              ]}
            />
          </State>
          <State label="tabs, links (?tab=)">
            <Segmented
              label="Profil nézet"
              value={linked}
              options={[
                { value: "profile", label: "Profil", to: "/dev/ui?tab=profile" },
                { value: "settings", label: "Beállítások", to: "/dev/ui?tab=settings" },
              ]}
            />
          </State>
          <State label="pills">
            <Segmented
              label="Ranglista"
              variant="pills"
              value={who}
              onValueChange={setWho}
              options={[
                { value: "players", label: "Játékosok" },
                { value: "pairs", label: "Párok" },
              ]}
            />
          </State>
        </div>
      </Block>

      <Block name="OverflowRow" note="A ••• sor a ritka vagy romboló lépéseknek, az oldal végén.">
        <div className={grid}>
          <State label="opens in place">
            <OverflowRow label="Helyettes, segítség">
              <ListCard>
                <ListRow to="/dev/ui">Valaki nem tud játszani</ListRow>
                <ListRow to="/dev/ui">Nem jelentek meg</ListRow>
              </ListCard>
            </OverflowRow>
          </State>
          <State label="link">
            <OverflowRow label="Partnercsere, szabályzat" to="/dev/ui" />
          </State>
        </div>
      </Block>

      <Block name="Button (shadcn, size=xl)" note="A blokkok gombjai: egy képernyőn legfeljebb egy sárga.">
        <State label="default / secondary / outline / destructive" className="flex flex-wrap gap-2">
          <Button size="xl">Elfogadom: vas. 19:00</Button>
          <Button size="xl" variant="secondary">
            Nem így volt
          </Button>
          <Button size="xl" variant="outline">
            Nem így volt
          </Button>
          <Button size="xl" variant="destructive">
            Nem folytatom
          </Button>
          <Button size="xl" disabled>
            Megerősítem
          </Button>
        </State>
        <State label="a page in blocks (phone width)" className="max-w-[390px] rounded-2xl bg-background p-4 ring-1 ring-hairline">
          <div className="flex flex-col gap-5">
            <PageHeader eyebrow="Mintaváros · Teszt szezon" title="Tabella" />
            <Segmented label="Nézet" value={view} onValueChange={setView} options={[{ value: "groups", label: "Csoportok" }, { value: "rankings", label: "Ranglista" }]} />
            <div className="flex items-center gap-2 text-[15px] font-extrabold">
              <span aria-hidden className="size-2.5 rounded-full bg-division-bronz" />
              Bronz divízió
              <Trophy aria-hidden className="size-4 text-muted-foreground" />
            </div>
          </div>
        </State>
      </Block>
    </main>
  );
}
