import type { Route } from "./+types/leagues.league";
import { AppPage } from "~/components/app-page";
import { LeagueCard } from "~/components/league-card";
import { requireUser } from "~/lib/auth/session.server";
import { myLeagueCard, myLeaguesAction } from "~/lib/my-leagues.server";
import { SITE_NAME } from "~/lib/site";

// One league's card on Ligáim (#394): /leagues/<league slug>, the slug as on
// the Tabella. A league the player doesn't belong to (D128), or none by that
// name: 404.

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  // With several leagues, `several` gives the way back to all of them.
  const found = await myLeagueCard(user, params.league);
  if (!found) throw new Response("Nincs ilyen liga.", { status: 404 });
  return found;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.card.league.name ?? "Ligáim"} – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function action({ request }: Route.ActionArgs) {
  return myLeaguesAction(await requireUser(request), await request.formData());
}

export default function MyLeague({ loaderData: d, actionData }: Route.ComponentProps) {
  return (
    <AppPage title="Ligáim" back={d.several ? { to: "/leagues", label: "Összes ligám" } : undefined}>
      <LeagueCard card={d.card} actionData={actionData} />
    </AppPage>
  );
}
