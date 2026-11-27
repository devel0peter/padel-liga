import { currentElo } from "@padel-liga/rules";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { enteredNotice } from "~/components/season-entry";
import { db } from "~/db/client.server";
import { eloChanges, pairs, users } from "~/db/schema";

import type { User } from "./auth/session.server";
import { listedCities } from "./cities.server";
import { ladderPage, pairIdsOf } from "./ladder.server";
import { chooseLeague, playerLeagues, type ListedLeague } from "./league-members.server";
import { roundClock } from "./home";
import { badgeInitials, teamLabel } from "./names";
import { minEntriesByLeague } from "./leagues.server";
import {
  acceptPartnerChange,
  declinePartnerChange,
  partnerChangeView,
  startPartnerChange,
  withdrawPartnerChange,
  type PartnerChangeView,
} from "./partner-changes.server";
import {
  leagueSummary,
  newestFirst,
  ownPlace,
  roundInfo,
  seasonOrder,
  type LeagueSummary,
  type OwnPlace,
  type OwnSeason,
  type RoundInfo,
} from "./my-leagues";
import { optOutView, type OptOutView } from "./opt-out";
import { optOut, optOutCard, undoOptOut } from "./opt-out.server";
import { partnerFinder, type PartnerFinder } from "./partner-search.server";
import { seasonRecords } from "./profiles.server";
import { applyToSeason, entryCounts, entryViews } from "./season-entries.server";
import type { EntryView } from "./season-entries";
import { currentSeason, isWaiting, waitingText, type Season } from "./seasons";
import { getSeason, listSeasons } from "./seasons.server";

// Ligáim (#394): one card per league of the player (D128). The round, the
// summary and the place come from ladderPage, the Tabella's own loader, so
// the numbers are the same as there. The partner is selected by name only;
// the only phone and email on the card are Párkereső's, between two of the
// league's listed seekers (#398, D177, partnerFinder).

export type MyLeagueCard = {
  league: { name: string; slug: string; city: string };
  /** The season on show (currentSeason, as on the Tabella); null before the league has one. */
  season: { id: number; name: string } | null;
  round: RoundInfo;
  /** The partner's name, or null without an active pair in the league. */
  pair: { partner: string } | null;
  /**
   * The pair as a team (#423): its id (the badge's colour), team label, the
   * two players' initials in the pair's order, and the partner's profile.
   */
  team: { pairId: number; label: string; initials: [string, string]; partnerId: string; partnerInitials: string } | null;
  /** The own row's points and the group's division ("Bronz divízió"), from the Tabella's round. */
  standing: { points: number; division: string } | null;
  /** The running round's days left and the share of its time gone (#423). */
  clock: { daysLeft: number; progress: number } | null;
  /** The season's rounds, for "Szezon naptár" (moved from Kezdőlap, #423), and the round being played. */
  calendar: { phases: { number: number; startsAt: Date; deadline: Date }[]; current: number | null };
  /** The player's last Élő-pont change, rounded; null before any. */
  delta: number | null;
  /** The pair's group and place in the Tabella's round, if it plays there. */
  place: OwnPlace | null;
  /** The phase the pair's entry starts in and its start (null: a waiting first season, D124), when it hasn't played yet. */
  joins: { round: number; startsAt: Date | null } | null;
  /** The entry's status, the "Nevezünk" button or why not (#23); null when there's nothing to say. */
  entry: EntryView | null;
  /** Default in or opted out of the next round (#395), with the button the state offers; null when there's nothing to say. */
  optOut: OptOutView | null;
  /** Null before the season's groups are out. */
  summary: LeagueSummary | null;
  /** "Állandó partnercsere" (#402): null when there is nothing to show. */
  partnerChange: PartnerChangeView | null;
  own: OwnSeason;
  /**
   * Párkereső (#398): "Neked már van párod.", or the league's listed seekers,
   * with phone and email only when the player is one too. Its pair link is a
   * path until the route gives it the site's address (withOrigin).
   */
  finder: PartnerFinder | null;
};

/** Párkereső's pair link as a full address, to copy and share (the request's origin). */
export function withOrigin(card: MyLeagueCard, origin: string): MyLeagueCard {
  return card.finder?.kind === "single" ? { ...card, finder: { ...card.finder, link: origin + card.finder.link } } : card;
}

type Partner = { pairId: number; first: boolean; id: string; name: string; surname: string | null; firstName: string | null };

/** The partner in each league where the player has an active pair: names only, no contact data. */
async function partners(userId: string, leagueIds: number[]): Promise<Map<number, Partner>> {
  if (leagueIds.length === 0) return new Map();
  const partner = alias(users, "my_leagues_partner");
  const rows = await db
    .select({
      leagueId: pairs.leagueId,
      pairId: pairs.id,
      playerA: pairs.playerA,
      id: partner.id,
      name: partner.name,
      surname: partner.surname,
      firstName: partner.firstName,
      deletedAt: partner.deletedAt,
    })
    .from(pairs)
    .innerJoin(partner, sql`${partner.id} = case when ${pairs.playerA} = ${userId} then ${pairs.playerB} else ${pairs.playerA} end`)
    .where(and(inArray(pairs.leagueId, leagueIds), eq(pairs.status, "active"), or(eq(pairs.playerA, userId), eq(pairs.playerB, userId))));
  return new Map(
    rows.map((r) => [
      r.leagueId,
      {
        pairId: r.pairId,
        first: r.playerA === userId,
        id: r.id,
        name: r.deletedAt ? "Törölt játékos" : r.name || "Névtelen",
        surname: r.deletedAt ? null : r.surname,
        firstName: r.deletedAt ? null : r.firstName,
      },
    ]),
  );
}

// The pair as a team on the card (#423), in the pair's player order.
function teamOf(user: User, p: Partner): NonNullable<MyLeagueCard["team"]> {
  const me = { id: user.id, name: user.name || "Névtelen", surname: user.surname, firstName: user.firstName };
  const players = p.first ? [me, p] : [p, me];
  return {
    pairId: p.pairId,
    label: teamLabel(players),
    initials: [badgeInitials(players[0]!), badgeInitials(players[1]!)],
    partnerId: p.id,
    partnerInitials: badgeInitials(p),
  };
}

/** The approved entry's starting phase, for "A 2. körben kezdtek (dec. 7.)": only before that phase starts. */
function joinsOf(season: Season, entry: EntryView | null, now: Date): MyLeagueCard["joins"] {
  if (entry?.kind !== "status" || entry.status !== "approved" || entry.joinsPhase === null) return null;
  const round = entry.joinsPhase;
  const startsAt = season.phases.find((p) => p.number === round)?.startsAt ?? null;
  if (startsAt && startsAt <= now) return null;
  return { round, startsAt };
}

/** The player's league cards, newest season first; `only`: one league's slug. */
export async function myLeagueCards(user: User, now = new Date(), only?: string): Promise<MyLeagueCard[]> {
  return cardsFor(user, (await playerLeagues(user.id)).filter((l) => !only || l.slug === only), now);
}

/**
 * One league's card (`/leagues/<slug>`), null when the player doesn't belong
 * to it; `several`: the player has more leagues (the way back to all).
 */
export async function myLeagueCard(user: User, slug: string, now = new Date()): Promise<{ card: MyLeagueCard; several: boolean } | null> {
  const leagues = await playerLeagues(user.id);
  const [card] = await cardsFor(
    user,
    leagues.filter((l) => l.slug === slug),
    now,
  );
  return card ? { card, several: leagues.length > 1 } : null;
}

async function cardsFor(user: User, leagues: ListedLeague[], now: Date): Promise<MyLeagueCard[]> {
  if (leagues.length === 0) return [];
  const ids = leagues.map((l) => l.id);
  const [cities, allSeasons, mine, partnerOf, [last]] = await Promise.all([
    listedCities(),
    listSeasons(),
    pairIdsOf(user.id),
    partners(user.id, ids),
    db.select({ delta: eloChanges.delta }).from(eloChanges).where(eq(eloChanges.userId, user.id)).orderBy(desc(eloChanges.at)).limit(1),
  ]);
  const seasonOf = new Map(leagues.map((l) => [l.id, currentSeason(allSeasons.filter((s) => s.leagueId === l.id), now)]));
  const shown = [...seasonOf.values()].filter((s): s is Season => !!s);
  const waiting = shown.filter(isWaiting);
  const [views, counts, minimums, records] = await Promise.all([
    entryViews(user, shown, now),
    entryCounts(waiting.map((s) => s.id)),
    minEntriesByLeague([...new Set(waiting.map((s) => s.leagueId))]),
    seasonRecords(
      user.id,
      shown.map((s) => s.id),
      now,
    ),
  ]);
  const rating = currentElo(user.elo, user.level);
  const cards: (MyLeagueCard & { order: number })[] = [];
  for (const league of leagues) {
    const season = seasonOf.get(league.id) ?? null;
    const waitText = season && isWaiting(season) ? waitingText(counts.get(season.id) ?? 0, minimums.get(league.id) ?? 0) : null;
    const calendar = season ? { phases: season.phases, waiting: waitText } : null;
    // The Tabella's own page: its round, its groups and our place there.
    const ladder = season ? await ladderPage(league.slug, now, mine) : null;
    const bands = ladder?.kind === "ladder" ? ladder.bands : [];
    const place = ladder?.kind === "ladder" ? ownPlace(ladder.phase, bands) : null;
    const entry = season ? (views.get(season.id) ?? null) : null;
    const record = season ? records.get(season.id) : undefined;
    const partnerChange = await partnerChangeView(user.id, league.id, season ?? undefined, now);
    const optOut = season && !isWaiting(season) ? await optOutCard(user.id, league.id, season, now) : null;
    const partner = partnerOf.get(league.id);
    // The own row of the Tabella's round: its points and its division.
    const band = bands.find((b) => b.groups.some((g) => g.mine));
    const row = band?.groups.find((g) => g.mine)?.rows.find((r) => r.mine);
    const running = season?.phases.find((p) => p.startsAt <= now && now <= p.deadline);
    cards.push({
      league: { name: league.name, slug: league.slug, city: cities.find((c) => c.slug === league.city)?.name ?? league.city },
      season: season ? { id: season.id, name: season.name } : null,
      round: roundInfo(calendar, now),
      pair: partner ? { partner: partner.name } : null,
      team: partner ? teamOf(user, partner) : null,
      standing: band && row ? { points: row.points, division: band.label } : null,
      clock: running ? roundClock(running.startsAt, running.deadline, now) : null,
      calendar: {
        phases: (season?.phases ?? []).map((p) => ({ number: p.number, startsAt: p.startsAt, deadline: p.deadline })),
        current: running?.number ?? null,
      },
      delta: last ? Math.round(last.delta) : null,
      place,
      joins: place || !season ? null : joinsOf(season, entry, now),
      entry,
      optOut: optOut ? optOutView(optOut) : null,
      summary: ladder?.kind === "ladder" ? leagueSummary(ladder.phase, bands) : null,
      partnerChange,
      own: { matches: record?.matches ?? 0, wins: record?.wins ?? 0, elo: rating === null ? null : Math.round(rating) },
      finder: await partnerFinder(user, league.id, now),
      order: seasonOrder(calendar),
    });
  }
  return newestFirst(cards).map(({ order: _, ...card }) => card);
}

// `topic`: the card section the answer is for; none: the entry (#23).
export type MyLeaguesActionData = { season: number; topic?: "partner_change"; error?: string; notice?: string; ok?: true };

const PARTNER_CHANGE_INTENTS: readonly string[] = ["partner_change_start", "partner_change_withdraw", "partner_change_accept", "partner_change_decline"];

/**
 * Ligáim's form posts, the same as Kezdőlap's: "Nevezünk" on a card (#23),
 * "Csatlakozom" on the join card (#331, audited), and "Nem folytatom" /
 * "Mégis folytatom" (#395, audited; the card's own fetcher reads the
 * answer). `season` 0: not about a card.
 */
export async function myLeaguesAction(user: User, form: FormData, now = new Date()): Promise<MyLeaguesActionData> {
  if (form.get("intent") === "join_league") {
    if (!(await chooseLeague(user.id, Number(form.get("league"))))) throw new Response("Hibás kérés.", { status: 400 });
    return { season: 0, ok: true };
  }
  const season = Number(form.get("season") || 0);
  const intent = String(form.get("intent") ?? "");
  if (PARTNER_CHANGE_INTENTS.includes(intent)) return partnerChangeAction(user, intent, season, form);
  if ((intent === "opt_out" || intent === "undo_opt_out") && Number.isInteger(season) && season > 0) {
    const leagueId = (await getSeason(season))?.leagueId;
    if (leagueId === undefined) throw new Response("Hibás kérés.", { status: 400 });
    const result = await (intent === "opt_out" ? optOut : undoOptOut)(user, leagueId, season, now);
    return result.ok ? { season, ok: true } : { season, error: result.error };
  }
  if (form.get("intent") !== "enter" || !Number.isInteger(season) || season <= 0) throw new Response("Hibás kérés.", { status: 400 });
  const result = await applyToSeason(user, season);
  return result.ok ? { season, notice: enteredNotice(result.joins) } : { season, error: result.error };
}

// "Állandó partnercsere" on a card (#402): start (in the card's league), take
// back, accept or decline. The answer goes to the card of `season`.
async function partnerChangeAction(user: User, intent: string, season: number, form: FormData): Promise<MyLeaguesActionData> {
  if (!Number.isInteger(season) || season <= 0) throw new Response("Hibás kérés.", { status: 400 });
  const now = new Date();
  let result;
  if (intent === "partner_change_start") {
    const league = (await playerLeagues(user.id)).find((l) => l.slug === String(form.get("league") ?? ""));
    if (!league) throw new Response("Hibás kérés.", { status: 400 });
    result = await startPartnerChange(user, league.id, String(form.get("partner") ?? ""), now);
  } else {
    const change = Number(form.get("change") || 0);
    if (!Number.isInteger(change) || change <= 0) throw new Response("Hibás kérés.", { status: 400 });
    result =
      intent === "partner_change_withdraw"
        ? await withdrawPartnerChange(user, change, now)
        : intent === "partner_change_accept"
          ? await acceptPartnerChange(user, change, now)
          : await declinePartnerChange(user, change, now);
  }
  return result.ok ? { season, topic: "partner_change", notice: result.notice } : { season, topic: "partner_change", error: result.error };
}
