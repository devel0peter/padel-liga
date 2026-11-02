import { createRequestHandler } from "react-router";

import { deliver } from "../app/lib/email/outbox.server";
import { runMatchReminders } from "../app/lib/match-reminders.server";
import { queueDueReminders } from "../app/lib/reminders.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
  // Hourly: the match reminders and the daily digest when their hour comes
  // (#31; a failure there is only logged), the automatic reminders for people
  // stuck before entering (#155; a failure only logged too), then whatever
  // email waits.
  async scheduled(controller, _env, ctx) {
    ctx.waitUntil(
      runMatchReminders(new Date(controller.scheduledTime))
        .then(() => queueDueReminders())
        .then((queued) => queued && console.log(`cron: queued ${queued} reminders`))
        .catch((e: unknown) => console.error("cron: reminders failed", e))
        .then(() => deliver())
        .then(({ sent }) => sent && console.log(`cron: sent ${sent} emails`)),
    );
  },
} satisfies ExportedHandler<Env>;
