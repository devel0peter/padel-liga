import { MAX_BATCH, resendConfigured, sendBatch } from "./resend.server";
import type { OutgoingEmail } from "./sender";
import { relayConfigured, sendViaRelay } from "./smtp.server";

// Who sends an email (#111, README decision log 2026-10-28): Google's SMTP
// relay first; what it refuses or can't take goes through Resend. Without
// either (local dev) emails are printed to the console.

export { MAX_BATCH };
export type { OutgoingEmail };

export type SendResult =
  | { ok: true; id: string }
  // retryLater: no provider could take it now (quota, rate limit, nothing
  // configured); try again later without counting it as a failed attempt.
  | { ok: false; error: string; retryLater: boolean };

// One result per email, in order: one bad address doesn't fail the others.
export async function sendEmails(emails: OutgoingEmail[]): Promise<SendResult[]> {
  if (emails.length === 0) return [];
  const relay = relayConfigured();
  if (!relay && !resendConfigured()) {
    if (import.meta.env.DEV) {
      for (const e of emails) console.log(`[email] to=${e.to} subject=${e.subject}\n${e.text}`);
      return emails.map(() => ({ ok: true, id: `dev-${crypto.randomUUID()}` }));
    }
    console.warn("neither SMTP_USER/SMTP_PASSWORD nor RESEND_API_KEY is set; emails stay queued");
    return emails.map(() => ({ ok: false, error: "no email provider is set", retryLater: true }));
  }

  const results: SendResult[] = new Array(emails.length);
  let fallback = emails.map((_, i) => i);
  const relayErrors = new Map<number, string>();
  if (relay) {
    const sent = await sendViaRelay(emails);
    fallback = [];
    sent.forEach((r, i) => {
      if (r.ok) results[i] = r;
      else {
        relayErrors.set(i, r.error);
        fallback.push(i);
      }
    });
    if (fallback.length) console.warn(`relay refused ${fallback.length} of ${emails.length} emails; trying Resend`);
  }
  if (fallback.length === 0) return results;

  const both = (i: number, error: string) => [relayErrors.get(i), `resend: ${error}`].filter(Boolean).join("; ");
  if (!resendConfigured()) {
    for (const i of fallback) results[i] = { ok: false, error: relayErrors.get(i)!, retryLater: false };
    return results;
  }
  const batch = await sendBatch(fallback.map((i) => emails[i]));
  fallback.forEach((i, k) => {
    results[i] = batch.ok
      ? { ok: true, id: batch.ids[k] ?? "" }
      : { ok: false, error: both(i, batch.error), retryLater: batch.retryLater };
  });
  return results;
}
