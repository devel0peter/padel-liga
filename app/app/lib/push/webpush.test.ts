import { describe, expect, it } from "vitest";

import {
  contentKeys,
  encryptPayload,
  fromBase64Url,
  generateVapidKeys,
  pushOutcome,
  pushRequest,
  toBase64Url,
  vapidAuthorization,
} from "./webpush";

// A browser's side of a subscription: its key pair and auth secret.
async function browser() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, pub, auth, keys: { p256dh: toBase64Url(pub), auth: toBase64Url(auth) } };
}

// Decrypts as the browser does (RFC 8291 section 3, RFC 8188 section 2).
async function decrypt(body: Uint8Array, b: Awaited<ReturnType<typeof browser>>) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, b.pair.privateKey, 256));
  const { cek, nonce } = await contentKeys(shared, b.auth, b.pub, asPublic, salt);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, body.slice(21 + idlen)));
  return { plain, recordSize: new DataView(body.buffer, body.byteOffset).getUint32(16), idlen };
}

describe("base64url", () => {
  it("round-trips bytes without padding", () => {
    const bytes = Uint8Array.from([0, 250, 251, 252, 253, 254, 255]);
    const text = toBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(fromBase64Url(text)).toEqual(bytes);
  });
});

describe("encryptPayload", () => {
  it("is decrypted by the subscribing browser", async () => {
    const b = await browser();
    const body = await encryptPayload(new TextEncoder().encode('{"title":"Új jelentkező"}'), b.keys);
    const { plain, recordSize, idlen } = await decrypt(body, b);
    expect(recordSize).toBe(4096);
    expect(idlen).toBe(65);
    // The last byte is the padding delimiter of the final record.
    expect(plain.at(-1)).toBe(2);
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe('{"title":"Új jelentkező"}');
  });

  it("uses a fresh key and salt for every message", async () => {
    const b = await browser();
    const one = await encryptPayload(new Uint8Array([1]), b.keys);
    const two = await encryptPayload(new Uint8Array([1]), b.keys);
    expect(toBase64Url(one)).not.toBe(toBase64Url(two));
  });
});

describe("vapidAuthorization", () => {
  it("signs a JWT for the push service's origin that the public key verifies", async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", { ...keys, subject: "mailto:hello@padelparbaj.hu" }, 1_000_000_000_000);
    const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(p)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_000_000_000 + 12 * 3600,
      sub: "mailto:hello@padelparbaj.hu",
    });
    const pub = await crypto.subtle.importKey("raw", fromBase64Url(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromBase64Url(s), new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });
});

describe("pushRequest", () => {
  it("posts the encrypted body with the Web Push headers", async () => {
    const b = await browser();
    const vapid = { ...(await generateVapidKeys()), subject: "mailto:hello@padelparbaj.hu" };
    const req = await pushRequest({ endpoint: "https://push.example/sub/1", ...b.keys }, "szia", vapid, 60);
    expect(req.method).toBe("POST");
    expect(req.headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(req.headers.get("TTL")).toBe("60");
    expect(req.headers.get("Authorization")).toMatch(/^vapid t=/);
    const { plain } = await decrypt(new Uint8Array(await req.arrayBuffer()), b);
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe("szia");
  });
});

describe("pushOutcome", () => {
  it("forgets subscriptions the push service says are gone", () => {
    expect(pushOutcome(201)).toBe("sent");
    expect(pushOutcome(404)).toBe("gone");
    expect(pushOutcome(410)).toBe("gone");
    expect(pushOutcome(429)).toBe("failed");
    expect(pushOutcome(500)).toBe("failed");
  });
});
