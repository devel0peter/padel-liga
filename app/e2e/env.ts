// Where the end-to-end suite (#101) keeps its own world, and the guard that
// keeps it local. Imported by the Playwright config, the server script and
// the specs; no app code imports it.
import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

export type Env = Readonly<Record<string, string | undefined>>;

// The suite's port (#169). Several worktrees on one machine run the suite at
// the same time, so each run takes its own: E2E_PORT when it is set, else a
// free port picked now.
export function suitePort(env: Env, pickFree: () => number): number {
  const raw = env.E2E_PORT;
  if (raw === undefined || raw === "") return pickFree();
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(port >= 1024 && port <= 65535)) throw new Error(`e2e refused: E2E_PORT is ${raw}, not a port between 1024 and 65535.`);
  return port;
}

// A port nothing listens on right now, from the OS. Synchronous, because the
// Playwright config needs it before it returns.
export function pickFreePort(): number {
  const script = "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})";
  return Number(execFileSync(process.execPath, ["-e", script], { encoding: "utf8" }));
}

// Written back to the environment: the server script, the Playwright workers
// and the server of e2e:shots are all started from this process, so they all
// read the same port instead of picking another.
export const PORT = suitePort(process.env, pickFreePort);
process.env.E2E_PORT = String(PORT);
export const BASE_URL = `http://localhost:${PORT}`;

// The line server.ts prints once its own dev server answers. The suite and
// e2e:shots wait for this line, never for "something answers on the port",
// so they can't run against a server they didn't start.
export const readyLine = (port: number) => `e2e server ready on port ${port}`;
export const READY_PATTERN = new RegExp(`^${readyLine(PORT)}$`, "m");

// True once the dev server's output has vite's "Local: http://localhost:<port>/"
// line, which vite prints only after it bound the port itself. Before that,
// whatever answers on the port may be someone else's server (#169).
export function viteListening(output: string, port: number): boolean {
  return new RegExp(`Local:\\s+http://localhost:${port}/`).test(stripVTControlCharacters(output));
}

// Refuses a port that something already listens on (IPv4 or IPv6), naming it.
// server.ts calls it before it touches the state or starts anything.
export async function assertPortFree(port: number): Promise<void> {
  const answers = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = connect({ port, host });
      socket.setTimeout(1000);
      socket.once("connect", () => (socket.destroy(), resolve(true)));
      socket.once("timeout", () => (socket.destroy(), resolve(false)));
      socket.once("error", () => resolve(false));
    });
  const used = await Promise.all(["127.0.0.1", "::1"].map(answers));
  if (used.some(Boolean))
    throw new Error(
      `e2e refused: port ${port} is already in use (another worktree's run?). Leave E2E_PORT unset to get a free port, or set it to another one.`,
    );
}

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
// app/.dev.vars, which may hold a real Resend key or relay login. wrangler.jsonc has no such
// environment, so everything else is the top-level config.
export const CLOUDFLARE_ENV = "e2e";
export const DEV_VARS_FILE = join(APP_DIR, `.dev.vars.${CLOUDFLARE_ENV}`);

// The dev server's variables. No Resend key and no relay login: every email
// is printed to the log instead (send.server.ts), which is where the suite
// reads login codes.
export const DEV_VARS: Record<string, string> = {
  RESEND_API_KEY: "",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  EMAIL_SECRET: "e2e-only-not-a-secret",
  GOOGLE_CLIENT_SECRET: "",
  VAPID_PRIVATE_KEY: "",
  TURNSTILE_SITE_KEY: "",
  TURNSTILE_SECRET: "",
  TURNSTILE_HOSTNAMES: "localhost",
  RESEND_WEBHOOK_SECRET: "",
  // A run sends far more than the production quota of 100 (login codes too).
  EMAIL_DAILY_LIMIT: "1000",
  // No beacon to the production Web Analytics site, no Google button.
  CF_WEB_ANALYTICS_TOKEN: "",
  GOOGLE_CLIENT_ID: "",
};

// Any of these set would send real email: Resend, or the SMTP relay (#111).
const SENDING_SECRETS = ["RESEND_API_KEY", "SMTP_USER", "SMTP_PASSWORD"] as const;

// Refuses anything that could point the suite at production or make it send
// real email. Runs in the Playwright config (before anything starts) and
// again in server.ts (before the database is touched).
export function assertSafeEnvironment(argv: readonly string[], env: Env): void {
  const remote = argv.find((a) => /^--(remote|preview|production|env)\b/.test(a));
  if (remote) throw new Error(`e2e refused: ${remote}. The suite only runs against its own local D1.`);
  for (const name of SENDING_SECRETS)
    if (env[name]) throw new Error(`e2e refused: ${name} is set. The suite never sends email.`);
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
  for (const name of SENDING_SECRETS) if (vars[name]) throw new Error(`e2e refused: the dev vars set ${name}.`);
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

// Left by `npm run e2e:shots --data seed` (shots.ts): the state is the bare seed, so
// `--data walked` (server.ts --keep) refuses it. A new `npm run e2e` wipes it with the state.
export const SEED_ONLY_MARKER = join(STATE_DIR, "seed-only");
