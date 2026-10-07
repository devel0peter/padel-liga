import { env } from "cloudflare:workers";

// Minimal Resend client (plain fetch, no SDK). Every send uses the batch
// endpoint: up to 100 emails per request.
// https://resend.com/docs/api-reference/emails/send-batch-emails

// A real, read mailbox (Google Workspace): Resend advises against noreply
// senders, and people do answer these emails.
// A display name with a comma must be quoted (RFC 5322).
export const FROM = `"Péter, Padelpárbaj" <hello@padelparbaj.hu>`;
export const REPLY_TO = "hello@padelparbaj.hu";
export const MAX_BATCH = 100;

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export type BatchResult =
  | { ok: true; ids: string[] }
  // retryLater: quota or rate limit, or no API key yet; try again on the next
  // run without counting it as a failed attempt.
  | { ok: false; error: string; retryLater: boolean };

export async function sendBatch(emails: OutgoingEmail[]): Promise<BatchResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    if (import.meta.env.DEV) {
      for (const e of emails) console.log(`[email] to=${e.to} subject=${e.subject}\n${e.text}`);
      return { ok: true, ids: emails.map(() => `dev-${crypto.randomUUID()}`) };
    }
    console.warn("RESEND_API_KEY is not set; emails stay queued");
    return { ok: false, error: "RESEND_API_KEY is not set", retryLater: true };
  }

  let res: Response;
  try {
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
