import { createRequestHandler } from "react-router";

import { deliver } from "../app/lib/email/outbox.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(deliver().then(({ sent }) => sent && console.log(`cron: sent ${sent} emails`)));
  },
} satisfies ExportedHandler<Env>;
