import { Link } from "react-router";

import { SeasonEntry } from "~/components/season-entry";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import type { MyLeagueCard, MyLeaguesActionData } from "~/lib/my-leagues.server";
import {
  INVITE_PARTNER,
  NO_PAIR,
  NOT_ENTERED,
  NOT_PUBLISHED,
  nextRoundText,
  placeText,
  startsText,
} from "~/lib/my-leagues";
import { PAIR_SECTION_PATH } from "~/lib/pairs";

// One league on Ligáim (#394): a card made of sections, one per topic, so a
// later item adds its own section to SECTIONS without reshaping the card
// (the opt-out #395, Párkereső #398, permanent partner change #402). Each
// section gets the card's data and the page's last form answer.

export type SectionProps = { card: MyLeagueCard; actionData?: MyLeaguesActionData };

/** A section of the card: a small title and its lines. */
export function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="grid content-start gap-1">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** The round being played and its deadline; between rounds when the next one starts. */
export function RoundSection({ card }: SectionProps) {
  const r = card.round;
  return (
    <CardSection title="Kör">
      {r.kind === "running" && (
        <>
          <p className="font-medium">
            {r.round}. kör: {r.from} – {r.to}
          </p>
          <p>Határidő: {r.deadline}</p>
        </>
      )}
      {r.kind === "next" && <p>{nextRoundText(r)}</p>}
      {r.kind === "waiting" && <p>{r.text}</p>}
      {r.kind === "over" && <p>A szezon véget ért.</p>}
      {r.kind === "none" && <p>Még nincs kiírt szezon.</p>}
    </CardSection>
  );
}

/** The partner by name only; without one, the way to invite one. */
export function PairSection({ card }: SectionProps) {
  return (
    <CardSection title="Párod">
      {card.pair ? (
        <p className="font-medium">{card.pair.partner}</p>
      ) : (
        <p>
          {NO_PAIR}.{" "}
          <Link to={PAIR_SECTION_PATH} className="font-semibold underline">
            {INVITE_PARTNER}
          </Link>
        </p>
      )}
    </CardSection>
  );
}

/** Where the pair is in the season: its group and place, the round it starts in, or the entry. */
export function PlaceSection({ card, actionData }: SectionProps) {
  if (!card.season) return null;
  const answered = actionData?.season === card.season.id ? actionData : undefined;
  const entry = card.entry;
  return (
    <CardSection title="Helyetek">
      {card.place ? (
        <p className="font-medium">{placeText(card.place)}</p>
      ) : card.joins ? (
        <p className="font-medium">{startsText(card.joins.round, card.joins.startsAt ? new Date(card.joins.startsAt) : null)}</p>
      ) : entry?.kind === "status" ? null : (
        <p className="font-medium">{NOT_ENTERED}</p>
      )}
      {answered && (
        <p role={answered.error ? "alert" : "status"} className={answered.error ? "font-semibold text-destructive" : "font-medium"}>
          {answered.error ?? answered.notice}
        </p>
      )}
      {/* The action that exists for the state: "Nevezünk", or why not; the entry's status. */}
      {!card.place && !card.joins && entry && !answered?.notice && <SeasonEntry seasonId={card.season.id} view={entry} />}
    </CardSection>
  );
}

/** The league in numbers, for the round the Tabella shows. */
export function SummarySection({ card }: SectionProps) {
  if (!card.season) return null;
  const s = card.summary;
  return (
    <CardSection title="A liga">
      {s ? (
        <>
          <p>
            {s.round}. kör: {s.pairs} pár, {s.groups} csoport
          </p>
          <p>
            Lejátszott meccsek: {s.played} / {s.total}
          </p>
        </>
      ) : (
        <p>{NOT_PUBLISHED}</p>
      )}
    </CardSection>
  );
}

/** The player's own season so far. */
export function OwnSeasonSection({ card }: SectionProps) {
  if (!card.season) return null;
  const stats: [string, string | number][] = [
    ["Meccs", card.own.matches],
    ["Győzelem", card.own.wins],
    ["Élő-pontod", card.own.elo ?? "–"],
  ];
  return (
    <CardSection title="A szezonod">
      <dl className="grid grid-cols-3 gap-2">
        {stats.map(([label, value]) => (
          <div key={label} className="grid gap-0.5 rounded-md bg-muted/50 px-2 py-1.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-display text-lg font-bold">{value}</dd>
          </div>
        ))}
      </dl>
    </CardSection>
  );
}

/** Tabella and Szabályzat. */
export function LinksSection({ card }: SectionProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm">
        <Link to={`/league/${card.league.slug}`} className="no-underline">
          Tabella
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link to="/rules" className="no-underline">
          Szabályzat
        </Link>
      </Button>
    </div>
  );
}

/** The card's sections, in order. A later item adds its section here. */
export const SECTIONS: React.ComponentType<SectionProps>[] = [RoundSection, PairSection, PlaceSection, SummarySection, OwnSeasonSection, LinksSection];

/** `link`: the league's own address, on the title, when the page lists several. */
export function LeagueCard({ card, actionData, link }: SectionProps & { link?: string }) {
  const title = card.league.name;
  return (
    <Card role="region" aria-label={title} className="max-w-2xl">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">
          {link ? (
            <Link to={link} className="no-underline hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </CardTitle>
        <CardDescription>{[card.league.city, card.season?.name].filter(Boolean).join(" · ")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {SECTIONS.map((Section, i) => (
          <Section key={i} card={card} actionData={actionData} />
        ))}
      </CardContent>
    </Card>
  );
}
