import { createRequestHandler } from "react-router";

import { deliver } from "../app/lib/email/outbox.server";
import { autoAcceptResults } from "../app/lib/results.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
  async scheduled(_controller, _env, ctx) {
    // Results waiting 48 hours are accepted first (#28); a failure there
    // must not stop the emails.
    const accepted = autoAcceptResults()
      .then((n) => n && console.log(`cron: auto-accepted ${n} results`))
      .catch((error) => console.error("cron: auto-accept failed", error));
    ctx.waitUntil(accepted.then(() => deliver()).then(({ sent }) => sent && console.log(`cron: sent ${sent} emails`)));
  },
} satisfies ExportedHandler<Env>;
