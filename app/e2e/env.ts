// Where the end-to-end suite (#101) keeps its own world, and the guard that
// keeps it local. Imported by the Playwright config, the server script and
// the specs; no app code imports it.
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const PORT = 5199;
export const BASE_URL = `http://localhost:${PORT}`;

// app/e2e/.state (gitignored): the suite's D1, the dev server's log, the
// saved logins. Never the developer's app/.wrangler/state.
export const E2E_DIR = fileURLToPath(new URL(".", import.meta.url));
export const APP_DIR = join(E2E_DIR, "..");
export const STATE_DIR = join(E2E_DIR, ".state");
export const PERSIST_DIR = join(STATE_DIR, "wrangler");
export const AUTH_DIR = join(STATE_DIR, "auth");
export const SERVER_LOG = join(STATE_DIR, "server.log");

// The wrangler environment name the dev server runs under. It only selects
// app/.dev.vars.e2e (written by server.ts) instead of the developer's
// app/.dev.vars, which may hold a real Resend key. wrangler.jsonc has no such
// environment, so everything else is the top-level config.
export const CLOUDFLARE_ENV = "e2e";
export const DEV_VARS_FILE = join(APP_DIR, `.dev.vars.${CLOUDFLARE_ENV}`);

// The dev server's variables. No Resend key: every email is printed to the
// log instead (resend.server.ts), which is where the suite reads login codes.
export const DEV_VARS: Record<string, string> = {
  RESEND_API_KEY: "",
  EMAIL_SECRET: "e2e-only-not-a-secret",
  GOOGLE_CLIENT_SECRET: "",
  VAPID_PRIVATE_KEY: "",
  TURNSTILE_SITE_KEY: "",
  TURNSTILE_SECRET: "",
  TURNSTILE_HOSTNAMES: "localhost",
  RESEND_WEBHOOK_SECRET: "",
  // A run sends far more than the production quota of 100 (login codes too).
  EMAIL_DAILY_LIMIT: "1000",
};

export type Env = Readonly<Record<string, string | undefined>>;

// Refuses anything that could point the suite at production or make it send
// real email. Runs in the Playwright config (before anything starts) and
// again in server.ts (before the database is touched).
export function assertSafeEnvironment(argv: readonly string[], env: Env): void {
  const remote = argv.find((a) => /^--(remote|preview|production|env)\b/.test(a));
  if (remote) throw new Error(`e2e refused: ${remote}. The suite only runs against its own local D1.`);
  if (env.RESEND_API_KEY) throw new Error("e2e refused: RESEND_API_KEY is set. The suite never sends email.");
  if (env.NODE_ENV === "production") throw new Error("e2e refused: NODE_ENV is production.");
  for (const name of ["CLOUDFLARE_ENV", "CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH", "CLOUDFLARE_INCLUDE_PROCESS_ENV"]) {
    if (env[name] && !(name === "CLOUDFLARE_ENV" && env[name] === CLOUDFLARE_ENV))
      throw new Error(`e2e refused: ${name} is set. The suite picks its own Cloudflare config.`);
  }
  if (env.PLAYWRIGHT_BASE_URL && !env.PLAYWRIGHT_BASE_URL.startsWith(BASE_URL))
    throw new Error(`e2e refused: PLAYWRIGHT_BASE_URL is ${env.PLAYWRIGHT_BASE_URL}. The suite only tests ${BASE_URL}.`);
}

// The variables file the dev server reads, checked the same way: a non-empty
// Resend key in it refuses the run.
export function devVarsText(vars: Record<string, string> = DEV_VARS): string {
  if (vars.RESEND_API_KEY) throw new Error("e2e refused: the dev vars set RESEND_API_KEY.");
  return `# Written by app/e2e/server.ts for the end-to-end suite. Overwritten on every run.\n${Object.entries(vars)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("\n")}\n`;
}

// Every wrangler call of the suite: local, and in the suite's own state dir.
export function wranglerLocal(args: readonly string[]): string[] {
  const full = ["wrangler", ...args, "--local", "--persist-to", PERSIST_DIR];
  const bad = full.find((a) => /^--(remote|preview|env)\b/.test(a));
  if (bad) throw new Error(`e2e refused: the wrangler command has ${bad}.`);
  return full;
}
