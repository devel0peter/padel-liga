import { createRequestHandler } from "react-router";

import { runCron } from "../app/lib/hourly-job.server";
import { accountOf, beginInvocation, logError, logInfo, logPath, REQUEST_ID_HEADER } from "../app/lib/log";

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
  // Every 10 minutes: the steps of lib/hourly-job.server.ts, in order, each
  // from the run's scheduled time; a failed step is logged and the next one runs.
  async scheduled(controller, _env, ctx) {
    ctx.waitUntil(runCron(new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
