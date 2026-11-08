import { redirect } from "react-router";

import type { Route } from "./+types/pair";
import { pairSectionUrl } from "~/lib/pairs";

// The old "Párom" address. The pair is a section of Profil now (D141, #346):
// /pair leads to it with the query kept ("?joined=1"), so the links in mail,
// push and in-app notices sent before still land in the right place. No
// page of its own: Profil checks the login.
export function loader({ request }: Route.LoaderArgs) {
  return redirect(pairSectionUrl(new URL(request.url).search));
}
