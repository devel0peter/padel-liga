import { data, redirect } from "react-router";

import type { Route } from "./+types/admin.match-decide";
import { requirePermission } from "~/lib/auth/admin.server";
import { decideMatch, decisionPage } from "~/lib/decisions.server";
import { getLeague } from "~/lib/leagues.server";
import { NO_SHOW_REFUSALS } from "~/lib/no-shows";
import { decideNoShow, leagueNoShows } from "~/lib/no-shows.server";
import { parseOutcome } from "~/lib/results";

// Legacy decision address (#433): redirects to the unified match page while
// keeping POST action working for backwards compatibility.

const NOT_FOUND = "Nincs ilyen meccs ebben a ligában.";

async function scope(request: Request, params: { league: string; id: string }) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw data(NOT_FOUND, { status: 404 });
  return { league, actor, id };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, id } = await scope(request, params);
  const page = await decisionPage(league.id, id);
  if (!page) throw data(NOT_FOUND, { status: 404 });
  throw redirect(`/admin/leagues/${league.slug}/matches/${id}?decide=1`);
}

type ActionResult = { intent: string; ok: boolean; message: string };
const NO_SHOW_INTENTS = { "no-show-confirm": "confirm", "no-show-reject": "reject" } as const;

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor, id } = await scope(request, params);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "no-show-confirm" || intent === "no-show-reject") {
    const report = Number(form.get("report"));
    const [waiting] = await leagueNoShows(league.id, id);
    if (!waiting || waiting.id !== report)
      return data<ActionResult>({ intent: "no-show", ok: false, message: NO_SHOW_REFUSALS.not_open }, { status: 400 });
    const done = await decideNoShow(actor.id, league.id, report, NO_SHOW_INTENTS[intent], String(form.get("reason") ?? ""));
    if (done.ok) return data<ActionResult>({ intent: "no-show", ok: true, message: done.notice });
    if (done.notFound) throw data(NOT_FOUND, { status: 404 });
    return data<ActionResult>({ intent: "no-show", ok: false, message: done.error }, { status: 400 });
  }
  const outcome = parseOutcome(form);
  if (!outcome) return data<ActionResult>({ intent: "decide", ok: false, message: "Válassz, mi legyen a meccs kimenetele." }, { status: 400 });
  const done = await decideMatch(actor.id, league.id, id, outcome, String(form.get("reason") ?? ""));
  if (done.ok) return data<ActionResult>({ intent: "decide", ok: true, message: done.notice });
  if (!done.ok && done.notFound) throw data(NOT_FOUND, { status: 404 });
  return data<ActionResult>({ intent: "decide", ok: false, message: done.error }, { status: 400 });
}

export default function MatchDecideRedirect() {
  return null;
}
