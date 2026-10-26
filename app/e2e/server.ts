// The end-to-end suite's dev server (#101), started by Playwright's webServer
// (playwright.config.ts) and stopped by it when the run ends, pass or fail.
// 1. checks the environment (env.ts), 2. starts from an empty D1 in
// app/e2e/.state, applies the migrations and the #90 seed, 3. runs the dev
// server on its own port with app/.dev.vars.e2e, writing everything it prints
// to app/e2e/.state/server.log: the specs read login codes and emails there.
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { seedSql } from "../app/lib/seed";
import {
  APP_DIR,
  CLOUDFLARE_ENV,
  DEV_VARS_FILE,
  PERSIST_DIR,
  PORT,
  SERVER_LOG,
  STATE_DIR,
  assertSafeEnvironment,
  devVarsText,
  wranglerLocal,
} from "./env";

assertSafeEnvironment(process.argv.slice(2), process.env);

rmSync(STATE_DIR, { recursive: true, force: true });
mkdirSync(STATE_DIR, { recursive: true });
writeFileSync(DEV_VARS_FILE, devVarsText());

const env = { ...process.env, CLOUDFLARE_ENV, E2E_PERSIST_DIR: PERSIST_DIR, FORCE_COLOR: "0" };
const wrangler = (args: string[]) =>
  execFileSync("npx", ["--no-install", ...wranglerLocal(args)], { cwd: APP_DIR, env, stdio: ["ignore", "ignore", "inherit"] });

wrangler(["d1", "migrations", "apply", "DB"]);
const seedFile = join(STATE_DIR, "seed.sql");
writeFileSync(seedFile, seedSql(new Date()));
wrangler(["d1", "execute", "DB", "--file", seedFile]);

const log = createWriteStream(SERVER_LOG, { flags: "a" });
const dev = spawn("npx", ["--no-install", "react-router", "dev", "--port", String(PORT), "--strictPort"], {
  cwd: APP_DIR,
  env,
  // Same process group as this script: Playwright stops the whole group
  // (vite and workerd too) when the run ends.
  stdio: ["ignore", "pipe", "pipe"],
});
dev.stdout.pipe(log);
dev.stderr.pipe(log);

const stop = () => dev.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("exit", stop);
dev.on("exit", (code) => process.exit(code ?? 0));
