// Helpers for the end-to-end specs (#101): logging in with the code the dev
// server prints, reading the emails it prints, one saved session per account.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { ADMIN, LEAGUE, ORGANIZER, OUTSIDER, PAIR_PLAYERS, SOLO_PLAYERS } from "../app/lib/seed";
import { APP_DIR, AUTH_DIR, SERVER_LOG, wranglerLocal } from "./env";

export { ADMIN, ORGANIZER, OUTSIDER };

// The level names as the pages show them (LEVELS in app/lib/interest.ts, up
// to the dash).
const LEVEL_LABELS = { kezdo: "Kezdő", kozephalado: "Középhaladó", halado: "Haladó", versenyzo: "Versenyző" } as const;

export type Player = { name: string; email: string; level: keyof typeof LEVEL_LABELS };

const pair = (i: number): [Player, Player] => {
  const p = PAIR_PLAYERS[i];
  return [
    { ...p.a, level: p.level },
    { ...p.b, level: p.level },
  ];
};
const solo = (i: number): Player => ({ ...SOLO_PLAYERS[i].who, level: SOLO_PLAYERS[i].level });

// The seeded players the walkthrough uses, by role in the story.
export const PAIRS = {
  p1: pair(0),
  p2: pair(1),
  p3: pair(2),
  p4: pair(3),
  p5: pair(4),
  // Two players without a partner the Szervező pairs on Párkeresők (step 6).
  solo: [solo(0), solo(1)] as [Player, Player],
  // Kept out until the groups are published: it joins round 2.
  late: pair(5),
};
// Two more who look for a partner (step 13) and two players whose partner
// never registers (step 14, "Pár létrehozása").
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

export async function loginCode(email: string, offset: number): Promise<string> {
  const [mail] = await waitForEmails(offset, 1, (e) => e.to === email && /belépőkód/.test(e.subject));
  const code = /^(\d{3}) (\d{3})/.exec(mail.subject);
  if (!code) throw new Error(`No login code in "${mail.subject}"`);
  return code[1] + code[2];
}

// --- Logging in -----------------------------------------------------------------

// `league`: through that league's register button (D128, #331), so a new
// account joins it at login.
export async function logIn(page: Page, email: string, league?: string): Promise<void> {
  await visit(page, `/login?${league ? `league=${league}&` : ""}email=${encodeURIComponent(email)}`);
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
// login (and, for a new player, the first-login page). A seeded player logs
// in through Mintaváros's register button, so they are its player (D128).
// Close the context.
export async function as(browser: Browser, who: string | Player): Promise<{ context: BrowserContext; page: Page }> {
  const email = typeof who === "string" ? who : who.email;
  if (existsSync(authFile(email))) {
    const context = await browser.newContext({ storageState: authFile(email) });
    return { context, page: await context.newPage() };
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page, email, typeof who === "string" ? undefined : LEAGUE.slug);
  if (typeof who !== "string" && new URL(page.url()).pathname === "/welcome") await completeWelcome(page, who);
  await save(context, email);
  return { context, page };
}

export async function save(context: BrowserContext, email: string): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: authFile(email) });
}

// "Üdv!": name, level, phone number, Férfi or Nő, consent, Kész. Nothing is
// prefilled since the interest list went (#333).
export async function completeWelcome(page: Page, player: Player): Promise<void> {
  await expect(page.getByRole("heading", { name: "Üdv!" })).toBeVisible();
  await expect(page.getByLabel("Neved")).toHaveValue("");
  await page.getByLabel("Neved").fill(player.name);
  await page.getByLabel("Szinted").click();
  await page.getByRole("option", { name: new RegExp(`^${levelLabel(player)}`) }).click();
  // Never prefilled (#133): the player picks.
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await page.getByLabel("Nő", { exact: true }).click();
  await page.getByLabel("Telefonszám").fill("+36 30 123 4567");
  await page.getByLabel(/hozzájárulok/).check();
  await page.getByRole("button", { name: "Kész" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

// Two registered players of Mintaváros make their pair with the first one's
// pair link (2026-10-31): what a real pair does now that no pair forms from
// the interest list (#333).
export async function pairUp(browser: Browser, [a, b]: [Player, Player]): Promise<void> {
  const owner = await as(browser, a);
  await visit(owner.page, "/pair");
  const url = await content(owner.page).getByLabel("A meghívó linked").inputValue();
  await owner.context.close();
  const partner = await as(browser, b);
  await visit(partner.page, new URL(url).pathname);
  await partner.page.getByRole("button", { name: "Elfogadom" }).click();
  await expect(partner.page).toHaveURL(/\/pair\?joined=1$/);
  await partner.context.close();
}

// A registered player switches "Párt keresek" on, on Párom.
export async function seekPartner(browser: Browser, who: Player): Promise<void> {
  const { context, page } = await as(browser, who);
  await visit(page, "/pair");
  const toggle = content(page).getByRole("switch", { name: "Párt keresek" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(content(page)).toContainText("A szervező látja, hogy párt keresel");
  await context.close();
}

// The Szervező pairs two players who look for a partner on Párkeresők.
export async function pairSeekers(browser: Browser, [a, b]: [Player, Player]): Promise<void> {
  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta/solos");
  const registered = page.getByRole("region", { name: "Regisztráltak", exact: true });
  await registered.getByRole("checkbox", { name: `${a.name} kijelölése` }).check();
  await registered.getByRole("checkbox", { name: `${b.name} kijelölése` }).check();
  await registered.getByRole("button", { name: "Párba teszem (2/2)" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Párba teszem" }).click();
  await expect(registered).not.toContainText(a.name);
  await context.close();
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

// One fixture insert into the suite's local D1, for a row no page can make
// any more (an interest signup in a league city, #83).
export function d1Insert(sql: string): void {
  if (!/^\s*insert\b/i.test(sql)) throw new Error("d1Insert() only inserts.");
  execFileSync("npx", ["--no-install", ...wranglerLocal(["d1", "execute", "DB", "--command", sql])], {
    cwd: APP_DIR,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

// One fixture update in the suite's local D1, for a state no page can reach
// at the time of the run (a round that has started, #36). Put the row back
// in the same spec, so later specs see the walkthrough's state.
export function d1Update(sql: string): void {
  if (!/^\s*update\b/i.test(sql)) throw new Error("d1Update() only updates.");
  execFileSync("npx", ["--no-install", ...wranglerLocal(["d1", "execute", "DB", "--command", sql])], {
    cwd: APP_DIR,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

// One fixture delete in the suite's local D1: a spec that brought its own rows
// (a league of its own, #181) removes them again, so later specs see the
// walkthrough's state.
export function d1Delete(sql: string): void {
  if (!/^\s*delete\b/i.test(sql)) throw new Error("d1Delete() only deletes.");
  execFileSync("npx", ["--no-install", ...wranglerLocal(["d1", "execute", "DB", "--command", sql])], {
    cwd: APP_DIR,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

// The seeded season's id, from the Szezonok page's links.
export async function seasonPath(page: Page): Promise<string> {
  await page.goto("/admin/leagues/minta/seasons");
  const href = await page.getByRole("link", { name: /^(Csoportok|Közzétéve)$/ }).first().getAttribute("href");
  const m = /\/seasons\/(\d+)\//.exec(href ?? "");
  if (!m) throw new Error(`No season link: ${href}`);
  return `/admin/leagues/minta/seasons/${m[1]}`;
}
