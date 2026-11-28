import { data, redirect } from "react-router";

import type { Route } from "./+types/admin.league-pairs";
import { requirePermission } from "~/lib/auth/admin.server";
import { RETIRED_NO_PAIR } from "~/lib/league-pairs-view";
import { playersPath } from "~/lib/league-players";
import { pairUp } from "~/lib/league-players.server";
import { getLeague } from "~/lib/leagues.server";
import { changePartner, dissolvePair } from "~/lib/pairs.server";
import { approvePartnerChange, rejectPartnerChange, undoPartnerChange } from "~/lib/partner-changes.server";
import { enterPairByOrganizer, removePairFromSeason, withdrawPairMidPhase } from "~/lib/season-entries.server";
import { SITE_NAME } from "~/lib/site";
import { cancelStrike } from "~/lib/strikes.server";

// Legacy /pairs route (#435): GET redirects to Játékosok → Párok tab
// preserving search/filter params; POST action remains active because
// components/pair-actions.tsx and Admin player profile post pair mutations here.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Párok – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

async function scope(request: Request, slug: string) {
  const league = await getLeague(slug);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league, actor };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league } = await scope(request, params.league);
  const search = new URL(request.url).searchParams;
  if (search.get("entry") === RETIRED_NO_PAIR) {
    throw redirect(playersPath(league.slug, { filter: "no_pair", q: search.get("q")?.trim() ?? "" }));
  }
  const next = new URLSearchParams(search);
  next.set("tab", "pairs");
  return redirect(`/admin/leagues/${league.slug}/players?${next.toString()}`);
}

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor } = await scope(request, params.league);
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");
  const pairId = Number(field("pair"));
  const seasonId = Number(field("season"));
  const intent = field("intent");
  const valid = (n: number) => Number.isInteger(n) && n > 0;
  let result: { ok: true } | { ok: false; error: string };
  if (intent === "create") result = await pairUp(actor.id, league, field("a"), field("b"));
  else if ((intent === "dissolve" || intent === "change") && valid(pairId))
    result =
      intent === "dissolve"
        ? await dissolvePair(actor.id, league.id, pairId)
        : await changePartner(actor.id, league.id, pairId, field("keep"), field("partner"));
  else if ((intent === "enter" || intent === "remove") && valid(pairId) && valid(seasonId))
    result =
      intent === "enter"
        ? await enterPairByOrganizer(actor, league.id, pairId, seasonId)
        : await removePairFromSeason(actor, league.id, pairId, seasonId);
  else if (intent === "withdraw" && valid(pairId) && valid(seasonId))
    result = await withdrawPairMidPhase(actor, league.id, pairId, seasonId, field("reason"));
  else if (intent === "strike-cancel" && valid(Number(field("strike"))))
    result = await cancelStrike(actor.id, league.id, Number(field("strike")), field("reason"));
  else if (intent === "partner-change-undo" && valid(Number(field("change"))))
    result = await undoPartnerChange(actor.id, league.id, Number(field("change")));
  else if (intent === "partner-change-approve" && valid(Number(field("change"))))
    result = await approvePartnerChange(actor.id, league.id, Number(field("change")));
  else if (intent === "partner-change-reject" && valid(Number(field("change"))))
    result = await rejectPartnerChange(actor.id, league.id, Number(field("change")), field("reason"));
  else throw new Response("Hibás kérés.", { status: 400 });
  return result.ok ? { ok: true as const } : { error: result.error };
}

export default function LeaguePairs() {
  return null;
}
