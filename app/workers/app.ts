import { createRequestHandler } from "react-router";

import { deliver } from "../app/lib/email/outbox.server";
import { autoAcceptResults } from "../app/lib/results.server";
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
  // Hourly: results waiting 48 hours are accepted (#28), then the match
  // reminders and the daily digest when their hour comes (#31), the automatic
  // reminders for people stuck before entering (#155); a failure in any of
  // them is only logged. Then whatever email waits.
  async scheduled(controller, _env, ctx) {
    const now = new Date(controller.scheduledTime);
    const accepted = autoAcceptResults(now)
      .then((n) => n && console.log(`cron: auto-accepted ${n} results`))
      .catch((error) => console.error("cron: auto-accept failed", error));
    ctx.waitUntil(
      accepted
        .then(() => runMatchReminders(now))
        .then(() => queueDueReminders())
        .then((queued) => queued && console.log(`cron: queued ${queued} reminders`))
        .catch((e: unknown) => console.error("cron: reminders failed", e))
        .then(() => deliver())
        .then(({ sent }) => sent && console.log(`cron: sent ${sent} emails`)),
    );
  },
} satisfies ExportedHandler<Env>;
