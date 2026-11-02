import { createRequestHandler } from "react-router";

import { cronJob } from "../app/lib/backup";
import { exportStep } from "../app/lib/backup.server";
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
    if (cronJob(controller.cron) === "backup") {
      // Not caught: a failed export shows as a failed cron run in the logs.
      ctx.waitUntil(
        exportStep().then((r) => {
          // "done" is every run after the day's file exists: stay quiet.
          if (r.status === "progress") console.log(`backup: step done, ${r.parts} pieces, ${r.ops} calls`);
          if (r.status === "finished") console.log(`backup: ${r.key}, ${r.bytes} bytes from ${r.parts} pieces, ${r.deleted} old files deleted, ${r.ops} calls`);
        }),
      );
      return;
    }
    ctx.waitUntil(deliver().then(({ sent }) => sent && console.log(`cron: sent ${sent} emails`)));
  },
} satisfies ExportedHandler<Env>;
