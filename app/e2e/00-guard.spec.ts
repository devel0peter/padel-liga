// The suite's own safety checks (#101): it refuses anything that could reach
// production or send real email, and the app never depends on it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  APP_DIR,
  BASE_URL,
  DEV_VARS,
  PORT,
  READY_PATTERN,
  assertPortFree,
  assertSafeEnvironment,
  devVarsText,
  pickFreePort,
  readyLine,
  suitePort,
  wranglerLocal,
} from "./env";

const listen = (port: number, host: string) =>
  new Promise<Server>((resolve, reject) => {
    const server = createServer().once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
const close = (server: Server) => new Promise((resolve) => server.close(resolve));

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
    // Nothing reaches the production analytics site either.
    expect(devVarsText()).toContain('CF_WEB_ANALYTICS_TOKEN=""');
  });

  test("refuses an SMTP relay login, in the environment or in the dev vars (#111)", () => {
    for (const name of ["SMTP_USER", "SMTP_PASSWORD"]) {
      expect(() => assertSafeEnvironment([], { [name]: "x" })).toThrow(new RegExp(name));
      expect(() => devVarsText({ ...DEV_VARS, [name]: "x" })).toThrow(new RegExp(name));
      expect(devVarsText()).toContain(`${name}=""`);
    }
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

  // Several worktrees run the suite at once (#169): each on its own port.
  test("the port is E2E_PORT, else a free one, the same in every process", () => {
    expect(suitePort({ E2E_PORT: "5300" }, () => 1)).toBe(5300);
    expect(suitePort({}, () => 40123)).toBe(40123);
    expect(suitePort({ E2E_PORT: "" }, () => 40123)).toBe(40123);
    for (const bad of ["abc", "80", "70000", "5199x", "-1"])
      expect(() => suitePort({ E2E_PORT: bad }, () => 1)).toThrow(/E2E_PORT/);
    // The runner wrote its port back, so this worker uses the same server.
    expect(process.env.E2E_PORT).toBe(String(PORT));
    expect(BASE_URL).toBe(`http://localhost:${PORT}`);
  });

  test("a picked port is free to listen on", async () => {
    const port = pickFreePort();
    expect(port).toBeGreaterThanOrEqual(1024);
    await close(await listen(port, "127.0.0.1"));
  });

  test("refuses a busy port and names it, before anything starts", async () => {
    for (const host of ["127.0.0.1", "::1"]) {
      // A machine without IPv6 on loopback has nothing to check there.
      const server = await listen(0, host).catch(() => null);
      if (!server) continue;
      const port = (server.address() as { port: number }).port;
      await expect(assertPortFree(port)).rejects.toThrow(new RegExp(`port ${port} is already in use`));
      await close(server);
      await expect(assertPortFree(port)).resolves.toBeUndefined();
    }
  });

  test("only the server's own ready line counts as started", () => {
    expect(READY_PATTERN.test(`vite up\n${readyLine(PORT)}\n`)).toBe(true);
    expect(READY_PATTERN.test(readyLine(PORT + 1))).toBe(false);
    expect(READY_PATTERN.test(`  ➜  Local:   ${BASE_URL}/`)).toBe(false);
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
    // `from "…/e2e/…"`, `import "…/e2e/…"` and `import("…/e2e/…")`.
    const importers = files.filter((f) => /(from|import)\s*\(?\s*["'][^"']*\be2e\//.test(readFileSync(f, "utf8")));
    expect(importers).toEqual([]);
  });
});
