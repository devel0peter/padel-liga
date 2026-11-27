import { Check, ChevronRight, CircleAlert } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";

import { BigRank, IconTile, ListCard, ListRow, RoundProgress, StatTile, TeamBadge, TeamName } from "~/components/blocks";
import { OptOutForm } from "~/components/opt-out-section";
import { PartnerFinderView } from "~/components/partner-finder";
import { PhaseList } from "~/components/season-calendar";
import { SeasonEntry } from "~/components/season-entry";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import type { MyLeagueCard, MyLeaguesActionData } from "~/lib/my-leagues.server";
import { INVITE_PARTNER, NO_PAIR, NOT_ENTERED, NOT_PUBLISHED, nextRoundText, placeText, startsText } from "~/lib/my-leagues";
import { FINDER_ID, FINDER_OPEN_INLINE, FINDER_TITLE, finderPath } from "~/lib/partner-search";
import { PAIR_SECTION_PATH } from "~/lib/pairs";
import { ASK_TEXT as PARTNER_CHANGE_ASK, NO_CANDIDATES, SECTION_TITLE as PARTNER_CHANGE_TITLE, START_TEXT as PARTNER_CHANGE_START } from "~/lib/partner-changes";
import { cn } from "~/lib/utils";

// One league on Ligáim (#394; direction A, #423, mockup P06): the pair as a
// team with its place and numbers, the round, whether the pair plays on in
// the next round, the partner, and the rare things (the season's calendar,
// the permanent partner change, the Szabályzat). Without a pair: the way to
// invite one and Párkereső. No email or phone except Párkereső's (#398).

export type SectionProps = { card: MyLeagueCard; actionData?: MyLeaguesActionData };

const box = "flex scroll-mt-20 flex-col gap-3 rounded-2xl bg-surface p-4 md:p-5";

/** A section with a small title, for the partner change and Párkereső. */
export function CardSection({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-label={title} className={cn(box, "text-sm")}>
      <h3 className="type-label m-0 text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** The pair as a team: its place, its numbers and the Tabella; before a group, the entry or when it starts. */
export function PlaceSection({ card, actionData }: SectionProps) {
  const answered = card.season && actionData?.season === card.season.id && !actionData.topic ? actionData : undefined;
  const entry = card.entry;
  const place = card.place;
  const running = card.round.kind === "running" ? card.round.round : null;
  return (
    <section aria-label="Helyetek" className={cn(box, "gap-4")}>
      {card.team && (
        <div className="flex items-center gap-2.5">
          <TeamBadge pairId={card.team.pairId} initials={card.team.initials} size={30} />
          <TeamName name={card.team.label} variant="display" className="text-[22px] md:text-[26px]" />
        </div>
      )}
      {card.season &&
        (place && place.rank !== null && (running === null || running === place.round) ? (
          <BigRank
            place={place.rank}
            caption={card.standing ? `hely, ${card.standing.points} ponttal` : "hely"}
            detail={[card.standing?.division, `${place.group}. csoport`].filter(Boolean).join(" · ")}
          />
        ) : place ? (
          <p className="m-0 font-bold">{placeText(place, running)}</p>
        ) : card.joins ? (
          <p className="m-0 font-bold">{startsText(card.joins.round, card.joins.startsAt ? new Date(card.joins.startsAt) : null)}</p>
        ) : entry?.kind === "status" ? null : (
          <p className="m-0 font-bold">{NOT_ENTERED}</p>
        ))}
      {place && <span className="sr-only">{placeText(place, running)}</span>}
      {answered && (
        <p role={answered.error ? "alert" : "status"} className={cn("m-0 text-sm", answered.error ? "font-semibold text-danger" : "font-medium")}>
          {answered.error ?? answered.notice}
        </p>
      )}
      {/* The action that exists for the state: "Nevezünk", or why not; the entry's status. */}
      {card.season && !place && !card.joins && entry && !answered?.notice && (
        <div className="text-sm">
          <SeasonEntry seasonId={card.season.id} view={entry} />
        </div>
      )}
      {card.season && (
        <dl className="m-0 grid grid-cols-3 gap-2">
          {(
            [
              ["Meccs", card.own.matches, undefined],
              ["Győzelem", card.own.wins, undefined],
              ["Élő-pontod", card.own.elo ?? "–", card.delta ?? undefined],
            ] as const
          ).map(([label, value, delta]) => (
            <div key={label} className="contents">
              <dt className="sr-only">{label}</dt>
              <dd className="m-0">
                <StatTile label={label} value={value} delta={delta} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Link to={`/league/${card.league.slug}`} className="flex min-h-11 w-fit items-center gap-1 text-sm font-bold text-ball no-underline hover:underline">
        Tabella
        <ChevronRight aria-hidden className="size-[18px]" />
      </Link>
    </section>
  );
}

/** The round: its progress and the league's numbers, or when the next one starts; the season's calendar folded under it. */
export function RoundSection({ card }: SectionProps) {
  const r = card.round;
  const s = card.summary;
  const numbers = s ? `A ligában ${s.played} / ${s.total} meccs kész · ${s.pairs} pár, ${s.groups} csoport` : card.season ? NOT_PUBLISHED : null;
  return (
    <section aria-label="Kör" className="flex flex-col gap-2">
      {r.kind === "running" && card.clock ? (
        <RoundProgress
          round={r.round}
          deadline={r.deadline.replace(/^(\S+ \d+\.), \S+ /, "$1, ")}
          daysLeft={card.clock.daysLeft}
          progress={card.clock.progress}
          note={numbers}
        />
      ) : (
        <div className={cn(box, "gap-1 text-sm")}>
          {r.kind === "next" && <p className="m-0 font-bold">{nextRoundText(r)}</p>}
          {r.kind === "waiting" && <p className="m-0 font-bold">{r.text}</p>}
          {r.kind === "over" && <p className="m-0 font-bold">A szezon véget ért.</p>}
          {r.kind === "none" && <p className="m-0 font-bold">Még nincs kiírt szezon.</p>}
          {numbers && <p className="m-0 text-caption text-muted-foreground">{numbers}</p>}
        </div>
      )}
      {card.calendar.phases.length > 0 && (
        <details className="group rounded-2xl bg-surface px-4 text-sm md:px-5">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-semibold [&::-webkit-details-marker]:hidden">
            Szezon naptár
            <ChevronRight aria-hidden className="size-5 text-muted-foreground transition-transform group-open:rotate-90" />
          </summary>
          <div className="pb-4">
            <PhaseList phases={card.calendar.phases.map((p) => ({ ...p, startsAt: new Date(p.startsAt), deadline: new Date(p.deadline) }))} current={card.calendar.current} />
          </div>
        </details>
      )}
    </section>
  );
}

/** Default in, or opted out (#395), with the button the state offers; nothing when there's nothing to say. */
export function NextRoundSection({ card }: SectionProps) {
  if (!card.season || !card.optOut) return null;
  const out = card.optOut.action !== "opt_out";
  return (
    <section aria-label="Következő kör" className={cn(box, "flex-row items-start gap-3.5 text-sm")}>
      <IconTile tone={out ? "warning" : "success"}>{out ? <CircleAlert /> : <Check />}</IconTile>
      <div className="min-w-0 flex-1">
        <OptOutForm seasonId={card.season.id} view={card.optOut} />
      </div>
    </section>
  );
}

/** The partner (a link to their profile) and the Szabályzat; without a pair, the ways to find one. */
export function PairSection({ card }: SectionProps) {
  return (
    <section aria-label="Párod">
    <ListCard>
      {card.pair && card.team ? (
        <ListRow
          to={`/players/${card.team.partnerId}`}
          leading={
            <span aria-hidden className="grid size-10 place-items-center rounded-full bg-surface-3 text-[13px] font-bold">
              {card.team.partnerInitials}
            </span>
          }
        >
          <span className="flex flex-col">
            <span className="text-xs text-muted-foreground">Párod</span>
            <span className="font-bold">{card.pair.partner}</span>
          </span>
        </ListRow>
      ) : (
        <li>
          <div className="flex flex-col gap-1 px-4 py-3.5 text-sm md:px-5">
            <span className="text-xs text-muted-foreground">Párod</span>
            <p className="m-0">
              {NO_PAIR}.{" "}
              <Link to={PAIR_SECTION_PATH} className="font-semibold text-ball">
                {INVITE_PARTNER}
              </Link>
              {", vagy "}
              <Link to={finderPath(card.league.slug)!} className="font-semibold text-ball">
                {FINDER_OPEN_INLINE}
              </Link>
              .
            </p>
          </div>
        </li>
      )}
      <ListRow to="/rules">Szabályzat</ListRow>
    </ListCard>
    </section>
  );
}

/** Párkereső (#398): the league's seekers, for a player without a pair only (#423). */
export function FinderSection({ card }: SectionProps) {
  if (!card.finder || card.finder.kind === "paired") return null;
  return (
    <CardSection title={FINDER_TITLE} id={FINDER_ID}>
      <PartnerFinderView finder={card.finder} />
    </CardSection>
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

/** `link`: the league's own address, on the title, when the page lists several. */
export function LeagueCard({ card, actionData, link }: SectionProps & { link?: string }) {
  const title = card.league.name;
  const props = { card, actionData };
  return (
    <section role="region" aria-label={title} className="flex flex-col gap-4">
      {link && (
        <h2 className="m-0 text-xl font-bold">
          <Link to={link} className="text-inherit no-underline hover:underline">
            {title}
          </Link>
          {card.season && <span className="ml-2 text-sm font-normal text-muted-foreground">{card.season.name}</span>}
        </h2>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4">
          <PlaceSection {...props} />
          <RoundSection {...props} />
        </div>
        <div className="flex flex-col gap-4">
          <NextRoundSection {...props} />
          <PairSection {...props} />
          <FinderSection {...props} />
          <PartnerChangeSection {...props} />
        </div>
      </div>
    </section>
  );
}
