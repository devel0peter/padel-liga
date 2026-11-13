import { env } from "cloudflare:workers";

import type { Route } from "./+types/webhooks.resend";
import { recordDelivery } from "~/lib/email/comms-log.server";
import { deliveryFromEvent } from "~/lib/email/delivery";
import { suppress } from "~/lib/email/outbox.server";
import { suppressionsFromEvent, verifyWebhook } from "~/lib/email/webhook";
import { logInfo } from "~/lib/log";

// Resend calls this on a delivery, a bounce or a spam complaint (webhook set
// up in the Resend dashboard for email.delivered, email.bounced and
// email.complained). A permanent bounce or a complaint puts the address on
// email_suppressions, so broadcasts, partner notices and pair intros skip it
// from then on, and the admin sees it. Every one of them also marks the
// email it names in the person's email log (#242).
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
  if (suppressions.length > 0) logInfo("email suppressed", { count: suppressions.length, reason: suppressions[0].reason });
  // The email the event names gets its delivery state (#242, D157); the log
  // line has the state and whether a stored email matched, never an address.
  const delivery = deliveryFromEvent(event as Parameters<typeof deliveryFromEvent>[0]);
  if (delivery) logInfo("email delivery", { delivery: delivery.delivery, matched: await recordDelivery(delivery) });
  return new Response(null, { status: 204 });
}
