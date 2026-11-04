import { waitUntil } from "cloudflare:workers";
import { logError } from "~/lib/log";

// Work that runs after the response is sent (#140): the Worker stays alive
// until the promise settles, but the request doesn't wait for it. A failure
// is only logged; whatever it left undone is picked up by the cron.
export function runAfterResponse(label: string, task: () => Promise<unknown>): void {
  waitUntil(
    task().catch((e: unknown) => {
      logError("background task failed", { task: label, error: e });
    }),
  );
}
