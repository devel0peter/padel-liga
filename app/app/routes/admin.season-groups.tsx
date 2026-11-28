import { data, redirect } from "react-router";

import type { Route } from "./+types/admin.season-groups";
import { requirePermission } from "~/lib/auth/admin.server";
import { FIRST_PHASE } from "~/lib/groups";
import { generateDraft, moveDraftPair, phasesWithGroups, publishGroups } from "~/lib/groups.server";
import { getLeague } from "~/lib/leagues.server";
import { shownPhase } from "~/lib/round-switch";
import { generateRoundSwitchDraft, publishRoundSwitch } from "~/lib/round-switch.server";
import { seasonOfLeague } from "~/lib/season-entries.server";
import { isWaiting, WAITING_NO_GROUPS } from "~/lib/seasons";
import { SITE_NAME } from "~/lib/site";

// Legacy /seasons/:season/groups route (#437): GET redirects to the Round
// page's Csoportok tab; POST action remains functional for compatibility.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Csoportok – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

async function scope(request: Request, params: Route.LoaderArgs["params"]) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  const id = Number(params.season);
  const season = Number.isInteger(id) && id > 0 ? await seasonOfLeague(id, league.id) : undefined;
  if (!season) throw data("Nincs ilyen szezon.", { status: 404 });
  return { league, actor, season };
}

function phaseParam(value: FormDataEntryValue | string | null): number | null {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, season } = await scope(request, params);
  const now = new Date();
  const withGroups = await phasesWithGroups(season.id);
  const number = shownPhase(season.phases, withGroups, phaseParam(new URL(request.url).searchParams.get("phase")), now);
  return redirect(`/admin/leagues/${league.slug}/seasons/${season.id}/rounds/${number}?tab=groups`);
}

type ActionData = { error?: string; notice?: string };

export async function action({ request, params }: Route.ActionArgs): Promise<ActionData> {
  const { actor, season } = await scope(request, params);
  const form = await request.formData();
  const intent = form.get("intent");
  const phase = phaseParam(form.get("phase")) ?? FIRST_PHASE;
  if (isWaiting(season)) return { error: WAITING_NO_GROUPS };
  if (!season.phases.some((p) => p.number === phase)) throw new Response("Hibás kérés.", { status: 400 });
  if (intent === "generate") {
    if (phase === FIRST_PHASE) {
      const result = await generateDraft(season.id, actor.id);
      return result.ok ? { notice: "Kész a javaslat. Áthelyezhetsz párokat, aztán közzéteheted." } : { error: result.error };
    }
    const result = await generateRoundSwitchDraft(season.id, phase, actor.id);
    return result.ok ? { notice: "Újraszámoltuk a tervezetet a mostani eredményekből." } : { error: result.error };
  }
  if (intent === "move") {
    const pair = Number(form.get("pair") || 0);
    const group = Number(form.get("group") || 0);
    if (!Number.isInteger(pair) || pair <= 0 || !Number.isInteger(group) || group <= 0) {
      throw new Response("Hibás kérés.", { status: 400 });
    }
    const result = await moveDraftPair(season.id, pair, group, actor.id, phase);
    return result.ok ? {} : { error: result.error };
  }
  if (intent === "publish") {
    const result = phase === FIRST_PHASE ? await publishGroups(season.id, actor.id) : await publishRoundSwitch(season.id, phase, actor.id);
    return result.ok ? { notice: "Közzétetted a csoportokat. A játékosok most kapják meg az e-mailt." } : { error: result.error };
  }
  throw new Response("Hibás kérés.", { status: 400 });
}

export default function SeasonGroups() {
  return null;
}
