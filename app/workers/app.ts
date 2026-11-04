import { createRequestHandler } from "react-router";

import { exportStep } from "../app/lib/backup.server";
import { runCron } from "../app/lib/hourly-job.server";
import { accountOf, beginInvocation, logError, logInfo, logPath, REQUEST_ID_HEADER } from "../app/lib/log";
import { runScheduled } from "../app/lib/scheduled";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  // Every request leaves one line (#227): request id, path (no query string),
  // status, duration and the account id when logged in.
  async fetch(request) {
    const started = Date.now();
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    const end = beginInvocation(requestId);
    const line = { requestId, method: request.method, path: logPath(request.url) };
    try {
      const response = await requestHandler(new Request(request, { headers }));
      logInfo("request", { ...line, status: response.status, ms: Date.now() - started, userId: accountOf(requestId) });
      return response;
    } catch (error) {
      logError("request failed", { ...line, status: 500, ms: Date.now() - started, userId: accountOf(requestId), error });
      throw error;
    } finally {
      end();
    }
  },
  // Two crons (wrangler.jsonc): every 10 minutes the steps of
  // lib/hourly-job.server.ts (runCron), in order, each from the run's scheduled
  // time (a failed step is logged and the next one runs); and the database
  // export in steps (#32) between 03:00 and 05:59 UTC.
  async scheduled(controller, _env, ctx) {
    runScheduled(controller, ctx, { backup: () => exportStep(), steps: (now) => runCron(now) });
  },
} satisfies ExportedHandler<Env>;
