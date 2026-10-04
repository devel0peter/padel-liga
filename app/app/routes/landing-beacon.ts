import { isbot } from "isbot";

import type { Route } from "./+types/landing-beacon";
import { landingSource } from "~/lib/traffic";
import { recordLanding } from "~/lib/traffic.server";

// Counts one landing page view (app/lib/traffic.ts). Sent by the landing page
// from the browser, so crawlers that don't run scripts aren't counted.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!isbot(request.headers.get("User-Agent"))) {
    const query = new URL(request.url).searchParams;
    try {
      await recordLanding(landingSource(query));
    } catch (error) {
      console.error("landing count failed", error);
    }
  }
  return new Response(null, { status: 204 });
}
