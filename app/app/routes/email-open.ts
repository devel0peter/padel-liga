import type { Route } from "./+types/email-open";
import { recordOpen } from "~/lib/email/comms-log.server";
import { OPEN_IMAGE_HEADERS, TRANSPARENT_GIF } from "~/lib/email/opens";
import { logWarn } from "~/lib/log";

// GET /email/open/:token (#243, D161): an email's tracking image. Marks the
// email with that token opened (the time only: no IP, device or account is
// read or kept) and answers a transparent 1x1 GIF that no one may cache.
// An unknown or malformed token gets the very same answer, so the address
// tells nothing about other emails. The request log shows the path with
// the token hidden (lib/log.ts logPath).
export async function loader({ params }: Route.LoaderArgs) {
  try {
    await recordOpen(params.token);
  } catch (error) {
    // The image still loads; the open is just not counted.
    logWarn("email open not recorded", { error });
  }
  return new Response(TRANSPARENT_GIF, { status: 200, headers: OPEN_IMAGE_HEADERS });
}
