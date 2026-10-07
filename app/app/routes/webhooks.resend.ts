import { env } from "cloudflare:workers";

import type { Route } from "./+types/webhooks.resend";
import { suppress } from "~/lib/email/outbox.server";
import { suppressionsFromEvent, verifyWebhook } from "~/lib/email/webhook";

// Resend calls this on a permanent bounce or a spam complaint (webhook set up
// in the Resend dashboard for email.bounced and email.complained). The address
// goes on email_suppressions, so broadcasts, partner notices and pair intros
// skip it from then on, and the admin sees it.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405 });

  const body = await request.text();
  const ok = await verifyWebhook(
    body,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    env.RESEND_WEBHOOK_SECRET ?? "",
  );
  if (!ok) return new Response(null, { status: 401 });

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  const suppressions = suppressionsFromEvent(event as Parameters<typeof suppressionsFromEvent>[0]);
  // A failure answers 500, so Resend retries the event later.
  for (const s of suppressions) await suppress(s.email, s.reason);
  if (suppressions.length > 0) console.log(`resend webhook: suppressed ${suppressions.length} (${suppressions[0].reason})`);
  return new Response(null, { status: 204 });
}
