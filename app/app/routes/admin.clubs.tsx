import { redirect } from "react-router";

import type { Route } from "./+types/admin.clubs";
import { ClubsPage, type ClubsData } from "~/components/clubs-page";
import { clubsAction, clubsData, clubsScope } from "~/lib/clubs-page.server";
import { listLeagues } from "~/lib/leagues.server";

// Every city's clubs, Admin only. Once there are leagues, clubs are managed
// per league (admin.league-clubs.tsx), so this opens the first league's.
export async function loader({ request }: Route.LoaderArgs) {
  const scope = await clubsScope(request);
  const [first] = await listLeagues();
  if (first) throw redirect(`/admin/leagues/${first.slug}/clubs${new URL(request.url).search}`);
  return clubsData(scope);
}

export async function action({ request }: Route.ActionArgs) {
  return clubsAction(request, await clubsScope(request));
}

export default function AdminClubs({ loaderData, actionData }: Route.ComponentProps) {
  return <ClubsPage data={loaderData as ClubsData} actionData={actionData} />;
}
