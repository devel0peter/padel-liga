import { Form, Link, useNavigation } from "react-router";

import { PartnerFinderView } from "~/components/partner-finder";
import { SeasonEntry } from "~/components/season-entry";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
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
import { FINDER_ID, FINDER_OPEN_INLINE, FINDER_TITLE, finderPath } from "~/lib/partner-search";
import { PAIR_SECTION_PATH } from "~/lib/pairs";
import { ASK_TEXT as PARTNER_CHANGE_ASK, NO_CANDIDATES, SECTION_TITLE as PARTNER_CHANGE_TITLE, START_TEXT as PARTNER_CHANGE_START } from "~/lib/partner-changes";

// One league on Ligáim (#394): a card made of sections, one per topic, so a
// later item adds its own section to SECTIONS without reshaping the card
// (the opt-out #395, Párkereső #398, permanent partner change #402). Each
// section gets the card's data and the page's last form answer.

export type SectionProps = { card: MyLeagueCard; actionData?: MyLeaguesActionData };

/** A section of the card: a small title and its lines. */
export function CardSection({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-label={title} className="grid scroll-mt-20 content-start gap-1">
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
          {", vagy "}
          <Link to={finderPath(card.league.slug)!} className="font-semibold underline">
            {FINDER_OPEN_INLINE}
          </Link>
          .
        </p>
      )}
    </CardSection>
  );
}

/** Párkereső (#398): the league's seekers for a player without a pair; with one, one line. */
export function FinderSection({ card }: SectionProps) {
  if (!card.finder) return null;
  return (
    <CardSection title={FINDER_TITLE} id={FINDER_ID}>
      <PartnerFinderView finder={card.finder} />
    </CardSection>
  );
}

/** Where the pair is in the season: its group and place, the round it starts in, or the entry. */
export function PlaceSection({ card, actionData }: SectionProps) {
  if (!card.season) return null;
  const answered = actionData?.season === card.season.id && !actionData.topic ? actionData : undefined;
  const entry = card.entry;
  return (
    <CardSection title="Helyetek">
      {card.place ? (
        <p className="font-medium">{placeText(card.place, card.round.kind === "running" ? card.round.round : null)}</p>
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

/**
 * "Állandó partnercsere" (#402): the changes the player takes part in (the
 * new partner answers here, the one who sent it can take it back), and the
 * picker of a new partner by name while the player may start one.
 */
export function PartnerChangeSection({ card, actionData }: SectionProps) {
  const busy = useNavigation().state !== "idle";
  const view = card.partnerChange;
  if (!view || !card.season) return null;
  const answered = actionData?.topic === "partner_change" && actionData.season === card.season.id ? actionData : undefined;
  const seasonId = card.season.id;
  return (
    <CardSection title={PARTNER_CHANGE_TITLE}>
      {answered && (
        <p role={answered.error ? "alert" : "status"} className={answered.error ? "font-semibold text-destructive" : "font-medium"}>
          {answered.error ?? answered.notice}
        </p>
      )}
      {view.items.map((item) => (
        <div key={item.id} className="grid gap-2">
          <p>{item.text}</p>
          {(item.canAnswer || item.canWithdraw) && (
            <Form method="post" className="flex flex-wrap gap-2">
              <input type="hidden" name="season" value={seasonId} />
              <input type="hidden" name="change" value={item.id} />
              {item.canAnswer && (
                <>
                  <Button type="submit" name="intent" value="partner_change_accept" size="sm" disabled={busy}>
                    Elfogadom
                  </Button>
                  <Button type="submit" name="intent" value="partner_change_decline" size="sm" variant="outline" disabled={busy}>
                    Nem fogadom el
                  </Button>
                </>
              )}
              {item.canWithdraw && (
                <Button type="submit" name="intent" value="partner_change_withdraw" size="sm" variant="outline" disabled={busy}>
                  Visszavonom
                </Button>
              )}
            </Form>
          )}
        </div>
      ))}
      {/* Rarely needed: folded until opened, open again after a refused start. */}
      {view.start && (
        <details open={!!answered?.error}>
          <summary className="cursor-pointer font-medium underline-offset-2 hover:underline">{PARTNER_CHANGE_ASK}</summary>
          <div className="mt-2 grid gap-2">
            <p className="text-muted-foreground">{PARTNER_CHANGE_START}</p>
            {view.start.candidates.length === 0 ? (
              <p className="text-muted-foreground">{NO_CANDIDATES}</p>
            ) : (
              <Form method="post" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="partner_change_start" />
                <input type="hidden" name="season" value={seasonId} />
                <input type="hidden" name="league" value={card.league.slug} />
                <div className="grid min-w-0 flex-1 basis-48 gap-1">
                  <Label htmlFor={`partner-${seasonId}`}>Új partner</Label>
                  <Select name="partner" required>
                    <SelectTrigger id={`partner-${seasonId}`} className="w-full">
                      <SelectValue placeholder="Válassz játékost" />
                    </SelectTrigger>
                    <SelectContent>
                      {view.start.candidates.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" size="sm" disabled={busy}>
                  Kérés küldése
                </Button>
              </Form>
            )}
          </div>
        </details>
      )}
    </CardSection>
  );
}

/** The card's sections, in order. A later item adds its section here. */
export const SECTIONS: React.ComponentType<SectionProps>[] = [
  RoundSection,
  PairSection,
  FinderSection,
  PartnerChangeSection,
  PlaceSection,
  SummarySection,
  OwnSeasonSection,
  LinksSection,
];

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
