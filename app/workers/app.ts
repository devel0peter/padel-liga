import { createRequestHandler } from "react-router";

import { runHourlyJob } from "../app/lib/hourly-job.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
  // Hourly: the steps of lib/hourly-job.server.ts, in order, each from the
  // run's scheduled time; a failed step is logged and the next one runs.
  async scheduled(controller, _env, ctx) {
    ctx.waitUntil(runHourlyJob(new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
