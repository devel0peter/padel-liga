import { createRequestHandler } from "react-router";

import { exportStep } from "../app/lib/backup.server";
import { deliver } from "../app/lib/email/outbox.server";
import { runScheduled } from "../app/lib/scheduled";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
  async scheduled(controller, _env, ctx) {
    // Two crons (wrangler.jsonc): the database export in steps (#32) and the
    // hourly email run.
    runScheduled(controller.cron, ctx, { backup: () => exportStep(), email: () => deliver() });
  },
} satisfies ExportedHandler<Env>;
