import { healthResponse } from "~/lib/health.server";

// GET /health (#228): plain "ok" (200) or "unavailable" (503) for the watchdog
// (watchdog/, #318). No page around it, so no analytics beacon and no landing
// count: it never shows on the traffic page.
export function loader() {
  return healthResponse();
}
