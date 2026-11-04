import { env } from "cloudflare:workers";

import { isAccepted, isPlausibleToken, parseHostnames, TURNSTILE_FIELD, type SiteverifyResult } from "./turnstile";
import { logError, logWarn } from "~/lib/log";

// The site key is public (it ships in the page). Empty: no widget and no check,
// like before Turnstile (local dev without .dev.vars, or switched off).
export function turnstileSiteKey(): string | null {
  return env.TURNSTILE_SITE_KEY || null;
}

// Checks the form's Turnstile token with Cloudflare. Fails closed: no token,
// a missing secret or Cloudflare not answering all count as "no".
export async function verifyTurnstile(form: FormData, request: Request, action: string): Promise<boolean> {
  if (!turnstileSiteKey()) return true;

  const token = form.get(TURNSTILE_FIELD);
  const hostnames = parseHostnames(env.TURNSTILE_HOSTNAMES);
  if (!isPlausibleToken(token) || hostnames.size === 0 || !env.TURNSTILE_SECRET) {
    if (!env.TURNSTILE_SECRET || hostnames.size === 0) logError("turnstile not configured");
    return false;
  }

  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);

  let result: SiteverifyResult;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    result = await res.json();
  } catch (error) {
    logError("turnstile siteverify failed", { error });
    return false;
  }

  // Local dev with Cloudflare's test keys (.dev.vars.example).
  if (import.meta.env.DEV && result.metadata?.result_with_testing_key) return result.success === true;

  const accepted = isAccepted(result, action, hostnames);
  if (!accepted) logWarn("turnstile rejected", { errors: result["error-codes"], action: result.action, host: result.hostname });
  return accepted;
}
