import { isbot } from "isbot";

import type { Route } from "./+types/landing-beacon";
import { getActor } from "~/lib/auth/admin.server";
import { roleLabel } from "~/lib/auth/permissions";
import { landingSource } from "~/lib/traffic";
import { recordLanding } from "~/lib/traffic.server";
import { logError } from "~/lib/log";

// Counts one landing page view (app/lib/traffic.ts). Sent by the landing page
// from the browser, so crawlers that don't run scripts aren't counted. The page
// sends the source it worked out (`?ref=`). Admins and Szervezők checking the
// site aren't visitors, so they aren't counted.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!isbot(request.headers.get("User-Agent"))) {
    const query = new URL(request.url).searchParams;
    try {
      const actor = await getActor(request);
      if (!actor || roleLabel(actor) === "Játékos") await recordLanding(landingSource(query));
    } catch (error) {
      logError("landing count failed", { error });
    }
  }
  return new Response(null, { status: 204 });
}
