import { env } from "cloudflare:workers";

// Cloudflare Web Analytics site token, or null when not set up (no beacon).
export function webAnalyticsToken(): string | null {
  return env.CF_WEB_ANALYTICS_TOKEN || null;
}
