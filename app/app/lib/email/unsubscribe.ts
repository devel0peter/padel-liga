// Signed unsubscribe links: /leiratkozas?t=<base64url(email)>.<base64url(hmac)>.
// No database lookup is needed to check a link, and links can't be forged
// for someone else's address. Pure (WebCrypto only).

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function unsubscribeToken(email: string, secret: string): Promise<string> {
  const payload = enc.encode(email.toLowerCase());
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), payload);
  return `${b64url(payload)}.${b64url(new Uint8Array(sig))}`;
}

// Returns the email for a valid token, otherwise null.
export async function verifyUnsubscribeToken(token: string, secret: string): Promise<string | null> {
  const [p, s] = token.split(".");
  if (!p || !s) return null;
  try {
    const payload = fromB64url(p);
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(s), payload);
    return ok ? new TextDecoder().decode(payload) : null;
  } catch {
    return null;
  }
}

export function unsubscribeUrl(siteUrl: string, token: string): string {
  return `${siteUrl}/leiratkozas?t=${token}`;
}

// RFC 8058 one-click unsubscribe, so mail clients can show their own button.
export function unsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
