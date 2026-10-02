import { env } from "cloudflare:workers";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Admin pages sit behind Cloudflare Access (Zero Trust). Access handles the
// login; here we verify the signed token it adds to every request, so the
// admin stays closed even if the Access app is misconfigured or bypassed.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

export type Admin = { email: string };

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function forbidden(): never {
  throw new Response("Nincs hozzáférésed ehhez az oldalhoz.", { status: 403 });
}

export async function requireAdmin(request: Request): Promise<Admin> {
  // Local dev has no Access in front of it.
  if (import.meta.env.DEV) return { email: "dev@localhost" };

  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  // Fail closed until Access is configured.
  if (!team || !aud) forbidden();

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) forbidden();

  jwks ??= createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://${team}`,
      audience: aud,
    });
    if (typeof payload.email !== "string") forbidden();
    return { email: payload.email };
  } catch (error) {
    if (error instanceof Response) throw error;
    console.warn("Access token rejected", error);
    forbidden();
  }
}
