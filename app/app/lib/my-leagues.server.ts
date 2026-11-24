import { currentElo } from "@padel-liga/rules";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { enteredNotice } from "~/components/season-entry";
import { db } from "~/db/client.server";
import { pairs, users } from "~/db/schema";

import type { User } from "./auth/session.server";
import { listedCities } from "./cities.server";
import { ladderPage, pairIdsOf } from "./ladder.server";
import { chooseLeague, playerLeagues, type ListedLeague } from "./league-members.server";
import { minEntriesByLeague } from "./leagues.server";
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

/** The partner's name in each league where the player has an active pair. */
async function partners(userId: string, leagueIds: number[]): Promise<Map<number, string>> {
  if (leagueIds.length === 0) return new Map();
  const partner = alias(users, "my_leagues_partner");
  const rows = await db
    .select({ leagueId: pairs.leagueId, name: partner.name, deletedAt: partner.deletedAt })
    .from(pairs)
    .innerJoin(partner, sql`${partner.id} = case when ${pairs.playerA} = ${userId} then ${pairs.playerB} else ${pairs.playerA} end`)
    .where(and(inArray(pairs.leagueId, leagueIds), eq(pairs.status, "active"), or(eq(pairs.playerA, userId), eq(pairs.playerB, userId))));
  return new Map(rows.map((r) => [r.leagueId, r.deletedAt ? "Törölt játékos" : r.name || "Névtelen"]));
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
  const [cities, allSeasons, mine, partnerNames] = await Promise.all([
    listedCities(),
    listSeasons(),
    pairIdsOf(user.id),
    partners(user.id, ids),
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
    const optOut = season && !isWaiting(season) ? await optOutCard(user.id, league.id, season, now) : null;
    cards.push({
      league: { name: league.name, slug: league.slug, city: cities.find((c) => c.slug === league.city)?.name ?? league.city },
      season: season ? { id: season.id, name: season.name } : null,
      round: roundInfo(calendar, now),
      pair: partnerNames.has(league.id) ? { partner: partnerNames.get(league.id)! } : null,
      place,
      joins: place || !season ? null : joinsOf(season, entry, now),
      entry,
      optOut: optOut ? optOutView(optOut) : null,
      summary: ladder?.kind === "ladder" ? leagueSummary(ladder.phase, bands) : null,
      own: { matches: record?.matches ?? 0, wins: record?.wins ?? 0, elo: rating === null ? null : Math.round(rating) },
      finder: await partnerFinder(user, league.id, now),
      order: seasonOrder(calendar),
    });
  }
  return newestFirst(cards).map(({ order: _, ...card }) => card);
}

export type MyLeaguesActionData = { season: number; error?: string; notice?: string; ok?: true };

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
  const intent = form.get("intent");
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
