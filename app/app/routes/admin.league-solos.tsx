import { redirect } from "react-router";

import type { Route } from "./+types/admin.league-solos";
import { playersPath } from "~/lib/league-players";

// Párkeresők went into Játékosok (#301, D155): the old address (bookmarks,
// older links) opens it with the "Párt keres" filter. Játékosok checks the
// permission; the admin layout already checked the session.
export function loader({ params }: Route.LoaderArgs) {
  throw redirect(playersPath(params.league, { filter: "seeking" }));
}
