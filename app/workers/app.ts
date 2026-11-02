import { createRequestHandler } from "react-router";

import { deliver } from "../app/lib/email/outbox.server";
import { queueDueReminders } from "../app/lib/reminders.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
  // Hourly: queue the automatic reminders that are due (#155), then send
  // whatever waits. A failed reminder step doesn't stop the sending.
  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(
      queueDueReminders()
        .then((queued) => queued && console.log(`cron: queued ${queued} reminders`))
        .catch((e: unknown) => console.error("cron: reminders failed", e))
        .then(() => deliver())
        .then(({ sent }) => sent && console.log(`cron: sent ${sent} emails`)),
    );
  },
} satisfies ExportedHandler<Env>;
