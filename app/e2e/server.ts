// The end-to-end suite's dev server (#101), started by Playwright's webServer
// (playwright.config.ts) and stopped by it when the run ends, pass or fail.
// 1. checks the environment (env.ts), 2. starts from an empty D1 in
// app/e2e/.state, applies the migrations and the #90 seed, 3. runs the dev
// server on its own port with app/.dev.vars.e2e, writing everything it prints
// to app/e2e/.state/server.log: the specs read login codes and emails there.
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { seedSql } from "../app/lib/seed";
import {
  APP_DIR,
  BASE_URL,
  CLOUDFLARE_ENV,
  DEV_VARS_FILE,
  PERSIST_DIR,
  PORT,
  SEED_ONLY_MARKER,
  SERVER_LOG,
  STATE_DIR,
  assertPortFree,
  assertSafeEnvironment,
  devVarsText,
  readyLine,
  viteListening,
  wranglerLocal,
} from "./env";

assertSafeEnvironment(process.argv.slice(2), process.env);
// Before anything is wiped or started: a busy port stops the run at once (#169).
await assertPortFree(PORT);

// --keep (npm run e2e:shots --data walked, #103): start on the state the last
// run left, without wiping or seeding it. Everything else is the same.
const keep = process.argv.includes("--keep");
if (keep) {
  if (!existsSync(PERSIST_DIR)) throw new Error("e2e refused: --keep needs the state of an earlier `npm run e2e` run.");
  // A `--data seed` run of e2e:shots leaves this file: the state is the bare seed, not a walkthrough's.
  if (existsSync(SEED_ONLY_MARKER)) throw new Error("e2e refused: the state was replaced by the bare seed. Run `npm run e2e` again.");
} else {
  rmSync(STATE_DIR, { recursive: true, force: true });
}
mkdirSync(STATE_DIR, { recursive: true });
writeFileSync(DEV_VARS_FILE, devVarsText());
// Without it wrangler would fall back to app/.dev.vars, which may hold a real key.
if (!existsSync(DEV_VARS_FILE)) throw new Error(`e2e refused: ${DEV_VARS_FILE} is missing.`);

const env = { ...process.env, CLOUDFLARE_ENV, E2E_PERSIST_DIR: PERSIST_DIR, FORCE_COLOR: "0" };
const wrangler = (args: string[]) =>
  execFileSync("npx", ["--no-install", ...wranglerLocal(args)], { cwd: APP_DIR, env, stdio: ["ignore", "ignore", "inherit"] });

wrangler(["d1", "migrations", "apply", "DB"]);
if (!keep) {
  const seedFile = join(STATE_DIR, "seed.sql");
  writeFileSync(seedFile, seedSql(new Date()));
  wrangler(["d1", "execute", "DB", "--file", seedFile]);
}

// The setup above takes seconds: check again right before the dev server binds.
await assertPortFree(PORT);
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
let devOutput = "";
dev.stdout.on("data", (d) => (devOutput += d));

const stop = () => dev.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("exit", stop);
let exited = false;
dev.on("exit", (code) => {
  exited = true;
  // A dev server that didn't start says why only in the log: show its end.
  if (code) console.error(readFileSync(SERVER_LOG, "utf8").split("\n").slice(-30).join("\n"));
  process.exit(code ?? 0);
});

// Ready once our own dev server answers. Nothing is asked of the port until
// vite says it bound it (--strictPort: if anything else took the port, vite
// exits instead), so whatever answers after that, while it runs, is ours. The
// suite and e2e:shots wait for this line, not for the port (#169).
while (!exited) {
  const ok =
    viteListening(devOutput, PORT) &&
    (await fetch(`${BASE_URL}/login`).then(
      (r) => r.ok,
      () => false,
    ));
  if (ok && !exited) {
    console.log(readyLine(PORT));
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
