import type { Route } from "./+types/player-profile";
import { AppPage } from "~/components/app-page";
import { PlayerProfileView } from "~/components/player-profile-view";
import { requireUser } from "~/lib/auth/session.server";
import { playerProfile } from "~/lib/profiles.server";
import { SITE_NAME } from "~/lib/site";

// A player's profile (#36, spec sections 11, 14, 17): name, the summary
// (D136), current Élő-pont, its history and the final matches. For logged-in members only
// (D112): a visitor goes to the login page and comes back. Names and ratings
// only: no email or phone is selected on the way here. A deleted or
// anonymized account has none (404).
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);
  const profile = await playerProfile(params.id ?? "");
  if (!profile) throw new Response("Nincs ilyen játékos.", { status: 404 });
  return profile;
}

// Not for search engines or link previews (D112): a title only.
export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.player.name ?? "Játékos";
  return [{ title: `${name} – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

export default function PlayerProfile({ loaderData: d }: Route.ComponentProps) {
  return (
    <AppPage title={d.player.name} description="Játékos">
      <PlayerProfileView profile={d} />
    </AppPage>
  );
}
