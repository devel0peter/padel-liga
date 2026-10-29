// Helpers for the end-to-end specs (#101): logging in with the code the dev
// server prints, reading the emails it prints, one saved session per account.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { ADMIN, ORGANIZER, PAIR_SIGNUPS, SOLO_SIGNUPS } from "../app/lib/seed";
import { APP_DIR, AUTH_DIR, SERVER_LOG, wranglerLocal } from "./env";

export { ADMIN, ORGANIZER };

// The level names as the pages show them (LEVELS in app/lib/interest.ts, up
// to the dash).
const LEVEL_LABELS = { kezdo: "Kezdő", kozephalado: "Középhaladó", halado: "Haladó", versenyzo: "Versenyző" } as const;

export type Player = { name: string; email: string; level: keyof typeof LEVEL_LABELS };

const pair = (i: number): [Player, Player] => {
  const p = PAIR_SIGNUPS[i];
  return [
    { ...p.a, level: p.level },
    { ...p.b, level: p.level },
  ];
};
const solo = (i: number): Player => ({ ...SOLO_SIGNUPS[i].who, level: SOLO_SIGNUPS[i].level });

// The seeded players the walkthrough uses, by role in the story.
export const PAIRS = {
  p1: pair(0),
  p2: pair(1),
  p3: pair(2),
  p4: pair(3),
  p5: pair(4),
  // Two solos a Szervező paired in the seed.
  solo: [solo(0), solo(1)] as [Player, Player],
  // Kept out until the groups are published: it joins round 2.
  late: pair(5),
};
// The waiting solos (step 13) and two players whose partner never registers
// (step 14, "Pár létrehozása").
export const WAITING_SOLOS: [Player, Player] = [solo(2), solo(3)];
export const LONE = { torok: pair(6)[0], lakatos: pair(8)[0] };

// The six pairs that are approved before the draft: 3 + 3 pairs.
export const GROUP_PAIRS = [PAIRS.p1, PAIRS.p2, PAIRS.p3, PAIRS.p4, PAIRS.p5, PAIRS.solo];

export const levelLabel = (p: Player) => LEVEL_LABELS[p.level];

// Opens a page and waits until it is interactive: dialogs, selects and
// fetcher buttons do nothing before React hydrates, and the dev server loads
// the page's modules one by one.
export async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "networkidle" });
}

// The page's own content (AppPage), without the sidebar.
export const content = (page: Page) => page.getByRole("main").first();

// --- The dev server's log -----------------------------------------------------

export function logOffset(): number {
  return existsSync(SERVER_LOG) ? statSync(SERVER_LOG).size : 0;
}

export function logSince(offset: number): string {
  return readFileSync(SERVER_LOG).subarray(offset).toString("utf8");
}

export type Email = { to: string; subject: string; text: string };

// send.server.ts prints `[email] to=<address> subject=<subject>`, then the
// text, for every email when neither the relay nor Resend is set.
export function emailsSince(offset: number): Email[] {
  const blocks = logSince(offset).split(/^(?=\[email\] to=)/m);
  return blocks.flatMap((b) => {
    const m = /^\[email\] to=(\S+) subject=(.*)\n([\s\S]*)$/.exec(b);
    return m ? [{ to: m[1], subject: m[2], text: m[3] }] : [];
  });
}

// Waits until `count` emails matching `filter` were printed since `offset`.
export async function waitForEmails(offset: number, count: number, filter: (e: Email) => boolean = () => true): Promise<Email[]> {
  await expect.poll(() => emailsSince(offset).filter(filter).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(count);
  // The last email's text may still be on its way: wait until the log stops growing.
  let size = -1;
  await expect.poll(() => size === (size = logOffset()), { intervals: [250] }).toBe(true);
  return emailsSince(offset).filter(filter);
}

async function loginCode(email: string, offset: number): Promise<string> {
  const [mail] = await waitForEmails(offset, 1, (e) => e.to === email && /belépőkód/.test(e.subject));
  const code = /^(\d{3}) (\d{3})/.exec(mail.subject);
  if (!code) throw new Error(`No login code in "${mail.subject}"`);
  return code[1] + code[2];
}

// --- Logging in -----------------------------------------------------------------

export async function logIn(page: Page, email: string): Promise<void> {
  await visit(page, `/login?email=${encodeURIComponent(email)}`);
  await expect(page.getByLabel("E-mail-cím")).toHaveValue(email);
  const offset = logOffset();
  await page.getByRole("button", { name: "Kódot kérek" }).click();
  await expect(page.getByRole("heading", { name: "Nézd meg a leveleidet" })).toBeVisible();
  await page.getByLabel("Belépőkód").fill(await loginCode(email, offset));
  await page.getByRole("button", { name: "Belépek" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const authFile = (email: string) => join(AUTH_DIR, `${email}.json`);

// A page logged in as `email`: the saved session if there is one, else a
// login (and, for a new player, the first-login page). Close the context.
export async function as(browser: Browser, who: string | Player): Promise<{ context: BrowserContext; page: Page }> {
  const email = typeof who === "string" ? who : who.email;
  if (existsSync(authFile(email))) {
    const context = await browser.newContext({ storageState: authFile(email) });
    return { context, page: await context.newPage() };
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page, email);
  if (typeof who !== "string" && new URL(page.url()).pathname === "/welcome") await completeWelcome(page, who);
  await save(context, email);
  return { context, page };
}

export async function save(context: BrowserContext, email: string): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: authFile(email) });
}

// "Üdv!": the name and the level from the signup (already set, #130), a phone
// number, consent, Kész.
export async function completeWelcome(page: Page, player: Player): Promise<void> {
  await expect(page.getByRole("heading", { name: "Üdv!" })).toBeVisible();
  await expect(page.getByText("A jelentkezésedből már megvan a neved és a szinted")).toBeVisible();
  await expect(page.getByLabel("Neved")).toHaveValue(player.name);
  await expect(page.getByLabel("Szinted")).toContainText(levelLabel(player));
  await page.getByLabel("Telefonszám").fill("+36 30 123 4567");
  await page.getByLabel(/hozzájárulok/).check();
  await page.getByRole("button", { name: "Kész" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

// Registers players (login, first-login page) a few at a time.
export async function registerAll(browser: Browser, players: Player[]): Promise<void> {
  const queue = [...players];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const { context } = await as(browser, p);
      await context.close();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

// --- The suite's D1 -------------------------------------------------------------

// One read-only query against the suite's local D1 (never the developer's).
// It starts a second local runtime on the dev server's state dir: fine for a
// read, and the only way to see rows no page shows (matches).
export function d1(select: string): Record<string, unknown>[] {
  if (!/^\s*select\b/i.test(select)) throw new Error("d1() only reads.");
  const out = execFileSync("npx", ["--no-install", ...wranglerLocal(["d1", "execute", "DB", "--json", "--command", select])], {
    cwd: APP_DIR,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "ignore"],
  }).toString();
  return (JSON.parse(out) as { results: Record<string, unknown>[] }[])[0].results;
}

// The seeded season's id, from the Szezonok page's links.
export async function seasonPath(page: Page): Promise<string> {
  await page.goto("/admin/leagues/minta/seasons");
  const href = await page.getByRole("link", { name: /^(Csoportok|Közzétéve)$/ }).first().getAttribute("href");
  const m = /\/seasons\/(\d+)\//.exec(href ?? "");
  if (!m) throw new Error(`No season link: ${href}`);
  return `/admin/leagues/minta/seasons/${m[1]}`;
}
