// Resend webhooks (bounces and spam complaints). Resend signs them the Svix
// way: HMAC-SHA256 over "<id>.<timestamp>.<raw body>", keyed with the base64
// part of the "whsec_..." secret; the header holds "v1,<base64>" entries.
// https://docs.svix.com/receiving/verifying-payloads/how-manual

// Older events are rejected, so a captured request can't be replayed later.
export const TOLERANCE_SECONDS = 5 * 60;

export type WebhookHeaders = { id: string | null; timestamp: string | null; signature: string | null };

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function verifyWebhook(
  body: string,
  headers: WebhookHeaders,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(secret.replace(/^whsec_/, "")),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return false;
  }
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);

  // Several space-separated signatures during a secret rotation; one is enough.
  for (const entry of signature.split(" ")) {
    const [version, sig] = entry.split(",", 2);
    if (version !== "v1" || !sig) continue;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = base64ToBytes(sig);
    } catch {
      continue;
    }
    // crypto.subtle.verify compares in constant time.
    if (await crypto.subtle.verify("HMAC", key, bytes, signed)) return true;
  }
  return false;
}

export type Suppression = { email: string; reason: "bounced" | "complained" };

type ResendEvent = {
  type?: string;
  data?: { to?: unknown; bounce?: { type?: string } };
};

// Which addresses an event takes off our list. A temporary bounce (mailbox
// full, server down) doesn't: the next email may well arrive.
export function suppressionsFromEvent(event: ResendEvent): Suppression[] {
  const to = Array.isArray(event.data?.to) ? event.data.to.filter((t): t is string => typeof t === "string") : [];
  let reason: Suppression["reason"];
  if (event.type === "email.bounced" && event.data?.bounce?.type === "Permanent") reason = "bounced";
  else if (event.type === "email.complained") reason = "complained";
  else return [];
  return to.map((email) => ({ email: email.trim().toLowerCase(), reason }));
}
