import { env } from "cloudflare:workers";

import {
  isAccepted,
  isPlausibleToken,
  parseHostnames,
  TURNSTILE_FIELD,
  type SiteverifyResult,
  type TurnstileOutcome,
} from "./turnstile";

// The site key is public (it ships in the page). Empty: no widget and no check,
// like before Turnstile (local dev without .dev.vars, or switched off).
export function turnstileSiteKey(): string | null {
  return env.TURNSTILE_SITE_KEY || null;
}

// Checks the form's Turnstile token with Cloudflare. Fails closed: no token,
// a missing secret or Cloudflare not answering all count as "no".
export async function verifyTurnstile(form: FormData, request: Request, action: string): Promise<TurnstileOutcome> {
  if (!turnstileSiteKey()) return "ok";

  const token = form.get(TURNSTILE_FIELD);
  if (!isPlausibleToken(token)) {
    // The widget never produced a token: hung, blocked or not loaded (#255).
    // No email or IP here, the browser is enough to spot a pattern.
    console.warn("turnstile: no token", action, request.headers.get("User-Agent"));
    return "missing";
  }
  const hostnames = parseHostnames(env.TURNSTILE_HOSTNAMES);
  if (hostnames.size === 0 || !env.TURNSTILE_SECRET) {
    console.error("turnstile: TURNSTILE_SECRET or TURNSTILE_HOSTNAMES not set");
    return "rejected";
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
    console.error("turnstile: siteverify failed", error);
    return "rejected";
  }

  // Local dev with Cloudflare's test keys (.dev.vars.example).
  if (import.meta.env.DEV && result.metadata?.result_with_testing_key) return result.success === true ? "ok" : "rejected";

  if (isAccepted(result, action, hostnames)) return "ok";
  console.warn("turnstile: rejected", result["error-codes"], result.action, result.hostname);
  return "rejected";
}
