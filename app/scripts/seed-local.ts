// Fills the LOCAL D1 with fake data for the milestone 1 walkthrough (#90,
// docs/walkthrough.md). Run from the repo root:
//   npm run db:seed:local -w app
// Takes no options. It cannot touch the remote database: the arguments and
// the environment are checked first, and the wrangler call is always --local.
// Running it again resets the fake rows (everything @example.test, the city
// "minta" with its league and clubs) and writes them anew.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertLocalOnly, seedSql, summary, wranglerArgs } from "../app/lib/seed";

try {
  assertLocalOnly(process.argv.slice(2), process.env);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const now = new Date();
const dir = mkdtempSync(join(tmpdir(), "padel-seed-"));
const file = join(dir, "seed.sql");
try {
  writeFileSync(file, seedSql(now));
  execFileSync("npx", ["--no-install", ...wranglerArgs(file)], { stdio: "inherit" });
  console.log(`\n${summary(now)}`);
} catch (e) {
  console.error(`\nSeeding failed: ${(e as Error).message}`);
  console.error("Is the local database migrated? Run the local migration script of the app workspace first.");
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
