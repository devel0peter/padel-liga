import type { User } from "~/lib/auth/session.server";
import { enteredNotice } from "~/components/season-entry";
import { playerLeagues } from "~/lib/league-members.server";
import { pairLinkBoxes, pairLinkPath } from "~/lib/pair-links.server";
import { pairOverview } from "~/lib/pairs.server";
import { partnerSearchState, setPartnerSearch } from "~/lib/partner-search.server";
import { pairPath } from "~/lib/profiles";
import { profilePairIds } from "~/lib/profiles.server";
import { applyToSeason, entryViews } from "~/lib/season-entries.server";
import { homeSeasons } from "~/lib/seasons";
import { listSeasons } from "~/lib/seasons.server";

// The "Párod" section of Profil (D140, #346; the "Párom" page before): the
// pair (by pair link, or made by a Szervező, #97) and the league's open
// seasons to enter together (#23). Without a pair: the player's own pair
// link to send to a partner (2026-10-31), and the "Párt keresek" switch
// (D59) for the organizer to find them one. The partner's address and phone
// (D121) so the two can reach each other: only to the pair's own players,
// never on a public page. Players can't change their pair here: a Szervező
// does that on the Párok page (#97). One card per league of the player
// (D128); the league is only named when there are several.

export async function pairSection(user: User, request: Request) {
  // Only the player's own leagues (D128, #331).
  const leagues = await playerLeagues(user.id);
  // Without a pair: the player's own link to invite one.
  const [pairs, links, searching] = await Promise.all([
    pairOverview(user, leagues),
    pairLinkBoxes(user, leagues),
    partnerSearchState(user, leagues),
  ]);
  const url = new URL(request.url);
  // The pair's profile (#36, members only: D112), once it has been in a published group.
  const open = await profilePairIds(pairs.flatMap((o) => (o.pair ? [o.pair.id] : [])));
  const overview = pairs.map((o) => {
    const link = o.pair ? undefined : links.find((l) => l.league.id === o.league.id);
    return {
      ...o,
      profile: o.pair && open.has(o.pair.id) ? pairPath(o.pair.id) : null,
      link: link ? url.origin + pairLinkPath(link.token) : null,
      seeking: o.pair ? null : (searching.get(o.league.id) ?? false),
    };
  });
  // The seasons the home page shows (the current or next one per league),
  // with this pair's entry or the "Nevezünk" button.
  const now = new Date();
  const ids = new Set(leagues.map((l) => l.id));
  const seasons = homeSeasons((await listSeasons()).filter((s) => ids.has(s.leagueId)), now);
  const views = await entryViews(user, seasons, now);
  return {
    // Just accepted a pair link.
    joined: url.searchParams.has("joined"),
    multi: leagues.length > 1,
    hasPair: overview.some((o) => o.pair),
    overview,
    entries: seasons.flatMap((s) => {
      const view = views.get(s.id);
      return view ? [{ id: s.id, name: s.name, leagueId: s.leagueId, view }] : [];
    }),
  };
}

export type PairSection = Awaited<ReturnType<typeof pairSection>>;

export type PairSectionActionData = { intent: string; error?: string; notice?: string; ok?: true };

// "Nevezünk" (#23) and "Párt keresek" (D59) of the Párod section; null for
// any other intent, which the page's own action handles.
export async function pairSectionAction(user: User, form: FormData): Promise<PairSectionActionData | null> {
  const intent = String(form.get("intent") ?? "");
  if (intent === "partner_search") {
    const league = Number(form.get("league"));
    const ok = await setPartnerSearch(user, league, form.get("seeking") === "1", await playerLeagues(user.id));
    if (!ok) throw new Response("Hibás kérés.", { status: 400 });
    return { intent, ok: true };
  }
  if (intent !== "enter") return null;
  const id = Number(form.get("season") || 0);
  if (!Number.isInteger(id) || id <= 0) throw new Response("Hibás kérés.", { status: 400 });
  const result = await applyToSeason(user, id);
  return result.ok ? { intent, notice: enteredNotice(result.joins) } : { intent, error: result.error };
}
