import { createRequestHandler } from "react-router";

import { BACKUP_CRON } from "../app/lib/backup";
import { exportDatabase } from "../app/lib/backup.server";
import { deliver } from "../app/lib/email/outbox.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
  async scheduled(controller, _env, ctx) {
    // Two crons (wrangler.jsonc): the daily database export (#32) and the
    // hourly email run.
    if (controller.cron === BACKUP_CRON) {
      // Not caught: a failed export shows as a failed cron run in the logs.
      ctx.waitUntil(
        exportDatabase().then((r) => r && console.log(`backup: ${r.key}, ${r.tables} tables, ${r.rows} rows, ${r.bytes} bytes, ${r.deleted} old files deleted`)),
      );
      return;
    }
    ctx.waitUntil(deliver().then(({ sent }) => sent && console.log(`cron: sent ${sent} emails`)));
  },
} satisfies ExportedHandler<Env>;
