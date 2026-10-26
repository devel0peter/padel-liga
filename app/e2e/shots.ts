// `npm run e2e:shots -- [--data seed|walked] [--as admin|organizer|player|anon]...
//   [--click "Name"] [--label name] <path>...` (#103). What the e2e-tester agent
// uses to look at changed pages: it starts the suite's own dev server (the same
// local D1, port and guards as `npm run e2e`), logs in as seeded accounts with
// the code the server prints, opens every path as every role, notes the
// status, the final URL, script errors and a sideways scroll at phone width,
// and saves a desktop and a 390px screenshot of each into
// app/e2e/.reports/shots/<label>/. Exit code 1 when a page answers 5xx or
// throws; a 4xx or a redirect is reported, not failed (a refused page is
// supposed to refuse).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Browser, type Page } from "@playwright/test";

import { APP_DIR, BASE_URL, E2E_DIR, assertSafeEnvironment } from "./env";
import { WIDTHS, parseShotsArgs, shotName, type Role, type ShotsArgs, type Size } from "./shots-args";
import { ADMIN, ORGANIZER, PAIRS, as, visit } from "./support";

const argv = process.argv.slice(2);
assertSafeEnvironment(argv, process.env);
const args = parseShotsArgs(argv);

const OUT = join(E2E_DIR, ".reports", "shots", args.label);

type PageResult = {
  role: Role;
  path: string;
  status: number | null;
  finalUrl: string;
  title: string;
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: string[];
  mobileOverflow: boolean;
  clicked: string | null;
  screenshots: string[];
  failed: boolean;
  problem: string | null;
};

async function startServer(a: ShotsArgs): Promise<ChildProcess> {
  const child = spawn("npx", ["--no-install", "tsx", "e2e/server.ts", ...(a.data === "walked" ? ["--keep"] : [])], {
    cwd: APP_DIR,
    env: process.env,
    // Its own process group, so one signal stops vite and workerd too.
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let err = "";
  child.stderr?.on("data", (d) => (err += d));
  let exited: number | null = null;
  child.on("exit", (code) => (exited = code ?? 0));
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`The e2e server stopped (exit ${exited}).\n${err.split("\n").slice(-20).join("\n")}`);
    try {
      if ((await fetch(`${BASE_URL}/login`)).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stopServer(child);
  throw new Error("The e2e server did not start within 3 minutes.");
}

function stopServer(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

async function pageFor(browser: Browser, role: Role): Promise<{ page: Page; close: () => Promise<void> }> {
  if (role === "anon") {
    const context = await browser.newContext({ locale: "hu-HU", timezoneId: "Europe/Budapest" });
    return { page: await context.newPage(), close: () => context.close() };
  }
  const who = role === "admin" ? ADMIN.email : role === "organizer" ? ORGANIZER.email : PAIRS.p1[0];
  const { context, page } = await as(browser, who);
  return { page, close: () => context.close() };
}

async function look(page: Page, role: Role, path: string, click: string | null): Promise<PageResult> {
  const r: PageResult = {
    role,
    path,
    status: null,
    finalUrl: "",
    title: "",
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    mobileOverflow: false,
    clicked: null,
    screenshots: [],
    failed: false,
    problem: null,
  };
  const onPageError = (e: Error) => r.pageErrors.push(e.message.slice(0, 300));
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === "error") r.consoleErrors.push(m.text().slice(0, 300));
  };
  const onResponse = (res: { status(): number; url(): string }) => {
    if (res.status() >= 500) r.failedRequests.push(`${res.status()} ${res.url().replace(BASE_URL, "")}`);
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.on("response", onResponse);
  try {
    await page.setViewportSize(WIDTHS.desktop);
    const response = await page.goto(path, { waitUntil: "networkidle", timeout: 60_000 });
    r.status = response?.status() ?? null;
    r.finalUrl = page.url().replace(BASE_URL, "");
    r.title = await page.title();

    const shoot = async (size: Size, suffix: "" | "-after-click") => {
      await page.setViewportSize(WIDTHS[size]);
      // Let the layout settle after the resize.
      await page.waitForTimeout(300);
      const name = shotName(role, path, `${size}${suffix}` as Parameters<typeof shotName>[2]);
      await page.screenshot({ path: join(OUT, name), fullPage: true });
      r.screenshots.push(name);
    };
    await shoot("desktop", "");
    await shoot("mobile", "");
    r.mobileOverflow = await page.evaluate<boolean>("document.documentElement.scrollWidth > window.innerWidth + 1");

    if (click) {
      const target = page.getByRole("button", { name: click }).or(page.getByRole("link", { name: click })).first();
      if ((await target.count()) === 0) {
        r.problem = `Nothing to click: no button or link named "${click}".`;
      } else {
        await page.setViewportSize(WIDTHS.desktop);
        await target.click();
        await page.waitForLoadState("networkidle");
        r.clicked = click;
        await shoot("desktop", "-after-click");
        await shoot("mobile", "-after-click");
      }
    }
  } catch (e) {
    r.problem = `Could not open the page: ${(e as Error).message.split("\n")[0]}`;
  } finally {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    page.off("response", onResponse);
  }
  r.failed = r.problem !== null && r.status === null ? true : (r.status ?? 0) >= 500 || r.pageErrors.length > 0 || r.failedRequests.length > 0;
  return r;
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(args);
  const results: PageResult[] = [];
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch();
    // The helpers in support.ts open contexts without options; outside the
    // test runner nothing gives them the base URL and locale, so add them.
    const newContext = browser.newContext.bind(browser);
    browser.newContext = (options = {}) => newContext({ baseURL: BASE_URL, locale: "hu-HU", timezoneId: "Europe/Budapest", ...options });
    for (const role of args.roles) {
      const { page, close } = await pageFor(browser, role);
      for (const path of args.paths) results.push(await look(page, role, path, args.click));
      await close();
    }
  } finally {
    await browser?.close();
    stopServer(server);
  }
  const summary = { data: args.data, dir: OUT, results };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  for (const r of results) {
    const flags = [
      r.failed ? "FAILED" : "ok",
      `status ${r.status ?? "-"}`,
      r.finalUrl && r.finalUrl !== r.path ? `-> ${r.finalUrl}` : "",
      r.mobileOverflow ? "scrolls sideways at 390px" : "",
      r.pageErrors.length ? `${r.pageErrors.length} script error(s): ${r.pageErrors[0]}` : "",
      r.consoleErrors.length ? `${r.consoleErrors.length} console error(s): ${r.consoleErrors[0]}` : "",
      r.failedRequests.length ? `5xx: ${r.failedRequests.join(", ")}` : "",
      r.problem ?? "",
    ].filter(Boolean);
    console.log(`${r.role.padEnd(9)} ${r.path}  ${flags.join("  ")}`);
    console.log(`          repro: npm run e2e:shots -- --data ${args.data} --as ${r.role} ${r.path}`);
  }
  console.log(`Screenshots and summary.json: ${OUT}`);
  process.exitCode = results.some((r) => r.failed) ? 1 : 0;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
