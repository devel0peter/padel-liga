// The suite's own safety checks (#101): it refuses anything that could reach
// production or send real email, and the app never depends on it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { APP_DIR, BASE_URL, DEV_VARS, assertSafeEnvironment, devVarsText, wranglerLocal } from "./env";

test.describe("guard", () => {
  test("refuses remote and production flags", () => {
    for (const flag of ["--remote", "--preview", "--production", "--env=production", "--env"])
      expect(() => assertSafeEnvironment([flag], {})).toThrow(/refused/);
    expect(() => assertSafeEnvironment(["--grep", "groups"], {})).not.toThrow();
  });

  test("refuses a Resend key, in the environment or in the dev vars", () => {
    expect(() => assertSafeEnvironment([], { RESEND_API_KEY: "re_123" })).toThrow(/RESEND_API_KEY/);
    expect(() => devVarsText({ ...DEV_VARS, RESEND_API_KEY: "re_123" })).toThrow(/RESEND_API_KEY/);
    expect(devVarsText()).toContain('RESEND_API_KEY=""');
    expect(devVarsText()).toContain('TURNSTILE_SITE_KEY=""');
  });

  test("refuses a production environment or another Cloudflare config", () => {
    expect(() => assertSafeEnvironment([], { NODE_ENV: "production" })).toThrow(/NODE_ENV/);
    expect(() => assertSafeEnvironment([], { CLOUDFLARE_ENV: "production" })).toThrow(/CLOUDFLARE_ENV/);
    expect(() => assertSafeEnvironment([], { CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: "x.jsonc" })).toThrow();
    expect(() => assertSafeEnvironment([], { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" })).toThrow();
    expect(() => assertSafeEnvironment([], { PLAYWRIGHT_BASE_URL: "https://padelparbaj.hu" })).toThrow(/BASE_URL/);
    expect(() => assertSafeEnvironment([], { PLAYWRIGHT_BASE_URL: BASE_URL })).not.toThrow();
  });

  test("every wrangler call is local, in the suite's own state dir", () => {
    const args = wranglerLocal(["d1", "execute", "DB", "--command", "select 1"]);
    expect(args).toContain("--local");
    expect(args[args.indexOf("--persist-to") + 1]).toMatch(/e2e\/\.state\/wrangler$/);
    expect(() => wranglerLocal(["d1", "execute", "DB", "--remote"])).toThrow(/--remote/);
  });

  // Logging in reads the code the dev server prints (D38): there is no test
  // route or flag in the app, so nothing of the suite can ship.
  test("no app code imports the suite", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(join(APP_DIR, "app"));
    walk(join(APP_DIR, "workers"));
    expect(files.length).toBeGreaterThan(50);
    const importers = files.filter((f) => /from ["'][^"']*e2e\//.test(readFileSync(f, "utf8")));
    expect(importers).toEqual([]);
  });
});
