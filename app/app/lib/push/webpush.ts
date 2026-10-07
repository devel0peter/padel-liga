// Web Push without a library: the payload encryption of RFC 8291
// (aes128gcm, RFC 8188) and the VAPID authorization of RFC 8292, on WebCrypto
// only, so it runs in a Worker. Pure (no I/O): pushRequest() builds the
// request, the caller sends it (push.server.ts). Unit tested by decrypting
// what it encrypts, as a browser would.

export type PushSubscriptionKeys = {
  endpoint: string;
  // Base64url, from the browser's PushSubscription.toJSON().keys.
  p256dh: string;
  auth: string;
};

export type VapidKeys = {
  // Base64url: the 65-byte uncompressed P-256 point, and the 32-byte scalar.
  publicKey: string;
  privateKey: string;
  // Who the push service may contact about abuse, e.g. "mailto:hello@…".
  subject: string;
};

const enc = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// HKDF extract and expand in one step (RFC 5869).
async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// The derivation shared by sender and receiver (RFC 8291 section 3.4).
export async function contentKeys(shared: Uint8Array<ArrayBuffer>, auth: Uint8Array<ArrayBuffer>, uaPublic: Uint8Array, asPublic: Uint8Array, salt: Uint8Array<ArrayBuffer>) {
  const ikm = await hkdf(auth, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  return {
    cek: await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16),
    nonce: await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12),
  };
}

const RECORD_SIZE = 4096;

// The encrypted body: header (salt, record size, sender's public key), then
// one record with the padding delimiter 0x02.
export async function encryptPayload(payload: Uint8Array, keys: Pick<PushSubscriptionKeys, "p256dh" | "auth">) {
  const uaPublic = fromBase64Url(keys.p256dh);
  const auth = fromBase64Url(keys.auth);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, pair.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { cek, nonce } = await contentKeys(shared, auth, uaPublic, asPublic, salt);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

async function vapidSigningKey(vapid: VapidKeys): Promise<CryptoKey> {
  const pub = fromBase64Url(vapid.publicKey);
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: toBase64Url(pub.slice(1, 33)),
      y: toBase64Url(pub.slice(33, 65)),
      d: vapid.privateKey,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

// The VAPID JWT (ES256) for the push service's origin, valid for 12 hours.
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const json = (o: object) => toBase64Url(enc.encode(JSON.stringify(o)));
  const unsigned = `${json({ typ: "JWT", alg: "ES256" })}.${json({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: vapid.subject,
  })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidSigningKey(vapid), enc.encode(unsigned));
  return `vapid t=${unsigned}.${toBase64Url(new Uint8Array(sig))}, k=${vapid.publicKey}`;
}

// `ttl`: how long the push service keeps it for an offline device (seconds).
export async function pushRequest(sub: PushSubscriptionKeys, payload: string, vapid: VapidKeys, ttl = 24 * 3600): Promise<Request> {
  return new Request(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "normal",
    },
    body: await encryptPayload(enc.encode(payload), sub),
  });
}

// What the push service's answer means for the stored subscription.
export function pushOutcome(status: number): "sent" | "gone" | "failed" {
  if (status >= 200 && status < 300) return "sent";
  // The browser unsubscribed or the subscription expired: forget it.
  if (status === 404 || status === 410) return "gone";
  return "failed";
}

// A new VAPID key pair (scripts/vapid-keys.mjs does the same).
export async function generateVapidKeys(): Promise<Omit<VapidKeys, "subject">> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  return { publicKey: toBase64Url(pub), privateKey: jwk.d! };
}
