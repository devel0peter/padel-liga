import type { Route } from "./+types/leagues.league";
import { AppPage } from "~/components/app-page";
import { LeagueCard } from "~/components/league-card";
import { requireUser } from "~/lib/auth/session.server";
import { playerLeagues } from "~/lib/league-members.server";
import { myLeagueCards, myLeaguesAction } from "~/lib/my-leagues.server";
import { SITE_NAME } from "~/lib/site";

// One league's card on Ligáim (#394): /leagues/<league slug>, the slug as on
// the Tabella. A league the player doesn't belong to (D128), or none by that
// name: 404.

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const [card] = await myLeagueCards(user, new Date(), params.league);
  if (!card) throw new Response("Nincs ilyen liga.", { status: 404 });
  // With several leagues, the way back to all of them.
  return { card, several: (await playerLeagues(user.id)).length > 1 };
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
