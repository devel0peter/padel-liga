import type { Route } from "./+types/admin.league-clubs";
import { ClubsPage, type ClubsData } from "~/components/clubs-page";
import { clubsAction, clubsData, clubsScope } from "~/lib/clubs-page.server";

// A league's clubs: the league city's clubs, for its Szervezők and the Admin.
export async function loader({ request, params }: Route.LoaderArgs) {
  return clubsData(await clubsScope(request, params.league));
}

export async function action({ request, params }: Route.ActionArgs) {
  return clubsAction(request, await clubsScope(request, params.league));
}

export default function LeagueClubs({ loaderData, actionData }: Route.ComponentProps) {
  return <ClubsPage data={loaderData as ClubsData} actionData={actionData} />;
}
