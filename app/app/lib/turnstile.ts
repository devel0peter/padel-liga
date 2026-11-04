// Cloudflare Turnstile: a mostly invisible bot check on the signup form. The
// widget only shows a checkbox when Cloudflare isn't sure about the visitor.
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

export const TURNSTILE_FIELD = "cf-turnstile-response";
// Tokens are at most 2048 characters.
const MAX_TOKEN_LENGTH = 2048;

export type SiteverifyResult = {
  success: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
  // Set by Cloudflare's test keys, which return no action and "example.com".
  metadata?: { result_with_testing_key?: boolean };
};

// Comma-separated list, e.g. "padelparbaj.hu" or "localhost,127.0.0.1".
export function parseHostnames(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPlausibleToken(token: unknown): token is string {
  return typeof token === "string" && token.length > 0 && token.length <= MAX_TOKEN_LENGTH;
}

// Siteverify said yes, for this form (action) and on our own site (hostname).
export function isAccepted(result: SiteverifyResult, action: string, hostnames: ReadonlySet<string>): boolean {
  return (
    result.success === true &&
    result.action === action &&
    typeof result.hostname === "string" &&
    hostnames.has(result.hostname.toLowerCase())
  );
}

// What the server made of a form's bot check (#255): "missing" means the
// browser sent no token (the widget hung or never loaded), "rejected" that
// Cloudflare or our checks said no.
export type TurnstileOutcome = "ok" | "missing" | "rejected";

// Shown under the widget when it fails or hasn't finished after a while, and
// in the server errors below: retrying the same way rarely helps.
export const TURNSTILE_HINT =
  "Ha nem megy át, kapcsolódj wifire (vagy mobilnetre, ha wifin vagy), próbáld másik böngészőből, és kapcsold ki a VPN-t vagy a reklámblokkolót.";

export function turnstileError(outcome: Exclude<TurnstileOutcome, "ok">): string {
  return outcome === "missing"
    ? `A robotszűrő nem futott le. ${TURNSTILE_HINT}`
    : `Nem sikerült ellenőrizni, hogy nem vagy robot. ${TURNSTILE_HINT}`;
}
