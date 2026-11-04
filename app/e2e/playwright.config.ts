// End-to-end suite (#101): `npm run e2e` from the repo root. It starts its
// own dev server on a fresh local D1 (server.ts) and walks through milestone 1
// as docs/walkthrough.md describes it, in Chromium. Its port is E2E_PORT or a
// free one (env.ts, #169), so several worktrees can run it at the same time.
import { defineConfig, devices } from "@playwright/test";

import { BASE_URL, E2E_DIR, READY_PATTERN, assertSafeEnvironment } from "./env";

assertSafeEnvironment(process.argv.slice(2), process.env);

export default defineConfig({
  testDir: E2E_DIR,
  testMatch: "*.spec.ts",
  // The specs are one walkthrough: each builds on the state the previous one
  // left (accounts, pairs, entries, groups). Files run in name order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: `${E2E_DIR}/test-results`,
  reporter: [["list"], ["html", { outputFolder: `${E2E_DIR}/playwright-report`, open: "never" }]],
  use: {
    baseURL: BASE_URL,
    locale: "hu-HU",
    timezoneId: "Europe/Budapest",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx --no-install tsx e2e/server.ts",
    cwd: `${E2E_DIR}/..`,
    // Ready only when server.ts says its own dev server answers, never when
    // something answers on the port: the suite needs its own server and D1
    // (#169). server.ts refuses a busy port before it starts anything.
    wait: { stdout: READY_PATTERN },
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
