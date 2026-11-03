import { env } from "cloudflare:workers";

import { countCall } from "~/lib/run-usage";

import { REPLY_TO, SENDER, type OutgoingEmail } from "./sender";

// Minimal Resend client (plain fetch, no SDK), the fallback behind the SMTP
// relay (send.server.ts, #111). Every send uses the batch endpoint: up to 100
// emails per request, all accepted or all refused.
// https://resend.com/docs/api-reference/emails/send-batch-emails

// A display name with a comma must be quoted (RFC 5322).
export const FROM = `"${SENDER.name}" <${SENDER.address}>`;
export const MAX_BATCH = 100;

export type BatchResult =
  | { ok: true; ids: string[] }
  // retryLater: quota or rate limit, or no API key; try again on the next
  // run without counting it as a failed attempt.
  | { ok: false; error: string; retryLater: boolean };

export function resendConfigured(): boolean {
  return !!env.RESEND_API_KEY;
}

export async function sendBatch(emails: OutgoingEmail[]): Promise<BatchResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set", retryLater: true };

  let res: Response;
  try {
    countCall();
    res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        emails.map((e) => ({
          from: FROM,
          reply_to: REPLY_TO,
          to: [e.to],
          subject: e.subject,
          html: e.html,
          text: e.text,
          headers: e.headers,
        })),
      ),
    });
  } catch (error) {
    return { ok: false, error: `network: ${String(error)}`, retryLater: false };
  }

  if (res.ok) {
    const body = (await res.json()) as { data?: { id: string }[] };
    return { ok: true, ids: (body.data ?? []).map((d) => d.id) };
  }
  const body = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
  return {
    ok: false,
    error: `${res.status} ${body.name ?? ""}: ${body.message ?? ""}`.trim(),
    retryLater: res.status === 429,
  };
}
