// Prints a new VAPID key pair for web push (app/lib/push/webpush.ts).
// The public key goes in wrangler.jsonc (VAPID_PUBLIC_KEY), the private one is
// a secret: `npx wrangler secret put VAPID_PRIVATE_KEY`, locally in .dev.vars.
// A new pair invalidates every existing subscription: browsers must subscribe again.
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
console.log(`VAPID_PUBLIC_KEY=${b64url(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
