import { ChevronRight, Mail, Phone } from "lucide-react";
import { Link } from "react-router";

import { PairLinkBox } from "~/components/pair-link";
import { PartnerSearchBox } from "~/components/partner-search";
import { SeasonEntry } from "~/components/season-entry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { NO_LEAGUE_TEXT } from "~/lib/league-members";
import { telHref } from "~/lib/matches";
import type { PairSection as PairSectionData, PairSectionActionData } from "~/lib/pair-section.server";
import { NO_PAIR_TEXT, PAIR_LINK_ACCEPTED, PAIR_SECTION_ID, pairPageDescription } from "~/lib/pairs";
import type { FormerPairView } from "~/lib/profiles";
import { CONTACT_EMAIL } from "~/lib/site";

// Profil's "Párod" section (D141, #346; the "Párom" page before) and
// "Korábbi párjaid" under it (D142, #347), on the Játékosprofil tab. The data
// comes from pair-section.server.ts and formerPairs (profiles.server.ts).

type Overview = PairSectionData["overview"][number];
type Entry = PairSectionData["entries"][number];

function Entries({ entries }: { entries: Entry[] }) {
  return (
    <div className="grid content-start gap-3">
      <div className="grid gap-1">
        <h3 className="font-display text-base font-bold">Nevezés</h3>
        <p className="text-muted-foreground">Elég, ha egyikőtök nevez: a nevezés azonnal érvényes, mindkettőtöknek.</p>
      </div>
      {entries.map((e) => (
        <section key={e.id} aria-label={e.name} className="grid gap-2">
          <h4 className="font-semibold">{e.name}</h4>
          <SeasonEntry seasonId={e.id} view={e.view} />
        </section>
      ))}
    </div>
  );
}

function ActivePair({ pair, profile }: { pair: NonNullable<Overview["pair"]>; profile: string | null }) {
  return (
    <div className="grid content-start gap-3">
      <div className="grid gap-0.5">
        <p className="text-muted-foreground">A párod</p>
        <p className="font-display text-xl font-bold break-words">{pair.partnerName}</p>
      </div>
      <ul aria-label="A párod elérhetősége" className="grid gap-1">
        <li className="min-w-0">
          <a href={`mailto:${pair.partnerEmail}`} className="inline-flex max-w-full items-center gap-1.5 underline">
            <Mail className="size-4 shrink-0" />
            <span className="break-all">{pair.partnerEmail}</span>
          </a>
        </li>
        <li className="min-w-0">
          {pair.partnerPhone ? (
            <a href={telHref(pair.partnerPhone)} className="inline-flex items-center gap-1.5 underline">
              <Phone className="size-4 shrink-0" />
              {pair.partnerPhone}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Phone className="size-4 shrink-0" />
              Nincs megadva telefonszám
            </span>
          )}
        </li>
      </ul>
      {profile && (
        <Link to={profile} className="font-semibold underline">
          A párotok oldala
        </Link>
      )}
    </div>
  );
}

// Under the "Párt keresek" switch, for those with nobody to invite.
function NoPair() {
  return (
    <p className="text-muted-foreground">
      {NO_PAIR_TEXT}{" "}
      <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
        {CONTACT_EMAIL}
      </a>
    </p>
  );
}

// One league's part: the partner and the entry, or the pair link and the
// "Párt keresek" switch. Side by side on a wide card.
function LeagueBody({ o, entries, wide }: { o: Overview; entries: Entry[]; wide: boolean }) {
  const columns = cn("grid gap-6", wide && "md:grid-cols-2");
  if (o.pair)
    return (
      <div className={columns}>
        <ActivePair pair={o.pair} profile={o.profile} />
        {entries.length > 0 && <Entries entries={entries} />}
      </div>
    );
  return (
    <div className={columns}>
      {o.link && <PairLinkBox url={o.link} bare />}
      <div className="grid content-start gap-4">
        {o.seeking != null && <PartnerSearchBox leagueId={o.league.id} seeking={o.seeking} bare />}
        <NoPair />
      </div>
    </div>
  );
}

const TITLE_ID = `${PAIR_SECTION_ID}-title`;

export function PairSection({ data: d, actionData }: { data: PairSectionData; actionData?: PairSectionActionData | null }) {
  const description = pairPageDescription(d.hasPair, CONTACT_EMAIL);
  const entriesOf = (o: Overview) => d.entries.filter((e) => e.leagueId === o.league.id);
  const notices = (
    <>
      {d.joined && !actionData && (
        <p role="status" className="rounded-md border border-nav-active bg-nav-active-bg p-3 font-medium">
          {PAIR_LINK_ACCEPTED}
        </p>
      )}
      {actionData?.notice && (
        <p role="status" className="rounded-md border border-nav-active bg-nav-active-bg p-3 font-medium">
          {actionData.notice}
        </p>
      )}
      {actionData?.error && (
        <p role="alert" className="font-semibold text-destructive">
          {actionData.error}
        </p>
      )}
      {d.overview.length === 0 && (
        <p className="text-muted-foreground">
          {NO_LEAGUE_TEXT}{" "}
          <Link to="/home" className="underline">
            Kezdőlap
          </Link>
        </p>
      )}
    </>
  );
  // One league (or none): the section is one card, without the league's name.
  if (!d.multi) {
    const o = d.overview[0];
    return (
      <Card role="region" id={PAIR_SECTION_ID} aria-labelledby={TITLE_ID} className="scroll-mt-6">
        <CardHeader>
          <CardTitle role="heading" aria-level={2} id={TITLE_ID} className="font-display text-lg font-bold">
            Párod
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {notices}
          {o && <LeagueBody o={o} entries={entriesOf(o)} wide />}
        </CardContent>
      </Card>
    );
  }
  // Several leagues (D128): a card per league, each naming it.
  return (
    <section id={PAIR_SECTION_ID} aria-labelledby={TITLE_ID} className="grid scroll-mt-6 gap-3">
      <div className="grid gap-1">
        <h2 id={TITLE_ID} className="font-display text-lg font-bold">
          Párod
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {notices}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {d.overview.map((o) => (
          <Card key={o.league.id} role="region" aria-label={o.league.name}>
            <CardHeader>
              <CardTitle role="heading" aria-level={3} className="font-display text-lg font-bold">
                {o.league.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LeagueBody o={o} entries={entriesOf(o)} wide={false} />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

// "Korábbi párjaid" (D142, #347): only when there is one. Names only, never
// a former partner's email or phone; a deleted partner without a link.
export function FormerPairs({ list }: { list: FormerPairView[] }) {
  if (list.length === 0) return null;
  return (
    <Card role="region" aria-label="Korábbi párjaid">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">
          Korábbi párjaid
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 lg:grid-cols-2">
          {list.map((p) => {
            const body = (
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-semibold break-words">{p.partner.name}</span>
                <span className="text-muted-foreground">
                  {p.league}, {p.rounds}
                </span>
                <span>
                  {p.end}
                  {p.endedOn && <span className="text-muted-foreground">: {p.endedOn}</span>}
                </span>
              </span>
            );
            const row = "flex items-center gap-2 rounded-lg border px-3 py-2 text-foreground no-underline";
            return (
              <li key={p.pairId}>
                {p.link ? (
                  <Link to={p.link} className={cn(row, "hover:bg-muted/50")}>
                    {body}
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ) : (
                  <div className={row}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
