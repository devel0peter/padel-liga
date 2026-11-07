// Walkthrough step 33 (#36): pair and player profiles, for logged-in members
// only (D112). Runs after 19-ladder-results: Anna's pair has a confirmed win
// (step 27, rated) and a "both lose" decision (step 28, not rated). In the
// walkthrough round 1 has not started yet, so a profile shows names and
// groups only (spec 17); for the results the test moves round 1's start into
// the past and puts it back. A visitor is sent to the login page from the
// league page's or a profile's address (D134); a member
// reaches the pair from the league page's table, then a player from the pair
// page; neither page shows an email or phone. Anna finds the links on Profil
// and Párom.
import { expect, test, type Browser, type Page } from "@playwright/test";

import { PAIRS, as, content, d1, d1Update, visit } from "./support";

const anna = PAIRS.p1[0];
const partner = PAIRS.p1[1];

// Round 1 of the seeded league's season(s).
const ROUND_1 = `season_id in (select s.id from seasons s join leagues l on l.id = s.league_id where l.slug = 'minta') and number = 1`;

// Anna's row in her group's table on the league page.
function annaRow(page: Page) {
  return content(page)
    .getByRole("region", { name: /^\d+\. csoport$/ })
    .filter({ hasText: anna.name })
    .locator("tbody tr")
    .filter({ hasText: anna.name });
}

// A logged-in member (Anna) on the league page, then her pair's profile.
async function openPairFromLeague(browser: Browser) {
  const { context, page } = await as(browser, anna);
  await visit(page, "/league/minta");
  await annaRow(page).getByRole("link").click();
  await expect(page).toHaveURL(/\/pairs\/\d+$/);
  return { context, page };
}

// The whole HTML: the text, the title and meta tags, and the loader data
// React Router writes into the page. The footer's contact address
// (@padelparbaj.hu) is the site's own, not a player's; the logged-in viewer's
// own address is in the app shell's account menu, so it is left out too.
async function noContactData(page: Page): Promise<void> {
  const html = (await page.content()).replace(/[\w.+-]+@padelparbaj\.hu/g, "").replaceAll(anna.email, "");
  expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+|\+36|example\.test/);
  expect(await content(page).innerText()).not.toContain("@");
}

test("33. a visitor must log in for a profile", async ({ browser }) => {
  const { context, page: member } = await openPairFromLeague(browser);
  const pairPath = new URL(member.url()).pathname;
  await context.close();

  const page = await browser.newPage();
  await page.goto(pairPath);
  await page.waitForURL(/\/login\?/);
  const at = new URL(page.url());
  expect(at.pathname + at.search).toBe(`/login?returnTo=${encodeURIComponent(pairPath)}`);
  await page.close();
});

test("33. before round 1 starts a profile shows names and groups only", async ({ browser }) => {
  const { context, page } = await openPairFromLeague(browser);
  const main = content(page);
  await expect(main.getByRole("heading", { level: 1 })).toContainText(anna.name);
  await expect(main.getByRole("heading", { level: 1 })).toContainText(partner.name);
  await expect(main.getByRole("region", { name: "Csoportok" })).toContainText(/1\. kör: \d+\. csoport \(\w+ divízió\)/);
  await expect(main.getByRole("region", { name: "Meccsek" })).toHaveCount(0);
  await expect(main).toContainText("Az eredmények a liga indulása után látszanak itt.");
  // The summary (D136) counts nothing yet and shows no rating.
  await expect(main.getByRole("definition")).toHaveText(["–", "–", "–", "–", "–", "–"]);
  await noContactData(page);

  await main.getByRole("heading", { level: 1 }).getByRole("link", { name: anna.name }).click();
  await expect(page).toHaveURL(/\/players\/[0-9a-f-]+$/);
  await expect(content(page).getByRole("heading", { level: 1 })).toHaveText(anna.name);
  await expect(content(page).getByTestId("player-elo")).toHaveCount(0);
  // Her pair, a link to its page (D136).
  await expect(content(page).getByRole("region", { name: "Párosa" }).getByRole("link", { name: /A pár oldala/ })).toContainText(partner.name);
  await noContactData(page);
  await context.close();
});

test("33. once round 1 has started: the results, the Élő-pont and its change", async ({ browser }) => {
  const original = d1(`select season_id, starts_at from season_phases where ${ROUND_1}`) as { season_id: number; starts_at: number }[];
  expect(original.length).toBeGreaterThan(0);
  d1Update(`update season_phases set starts_at = ${Math.floor(Date.now() / 1000) - 86_400} where ${ROUND_1}`);
  try {
    const { context, page } = await openPairFromLeague(browser);
    const main = content(page);
    await expect(main.getByRole("region", { name: "Csoportok" })).toContainText(/\d+\. hely/);
    const matches = main.getByRole("region", { name: "Meccsek" });
    await expect(matches).toContainText(/Győzelem · (4:1, 2:4, szuper tie-break 10:8|1:4, 4:2, szuper tie-break 8:10)/);
    await expect(matches).toContainText("Vereség · Mindkét pár vereséget kap (0:4, 0:4)");
    await expect(matches.getByRole("listitem")).toHaveCount(2);
    // The pair's summary (D136): Élő-pont, 1 season, 1 round, 2 matches, 1 win, 1 loss.
    await expect(main.getByRole("definition")).toHaveText([/^\d+$/, "1", "1", "2", "1", "1"]);
    await noContactData(page);

    await main.getByRole("heading", { level: 1 }).getByRole("link", { name: anna.name }).click();
    await expect(page).toHaveURL(/\/players\/[0-9a-f-]+$/);
    const player = content(page);
    await expect(player.getByTestId("player-elo")).toHaveText(/^\d+$/);
    await expect(player.getByRole("definition")).toHaveText([/^\d+$/, "1", "1", "2", "1", "1"]);
    // The win changed her rating; the "both lose" decision did not.
    const lines = player.getByRole("region", { name: "Meccsek" }).getByRole("listitem");
    await expect(lines).toHaveCount(2);
    await expect(lines.filter({ hasText: "Győzelem" }).getByTestId("elo-change")).toHaveText(/^Élő-pont: \+\d+ → \d+$/);
    await expect(lines.filter({ hasText: "Mindkét pár" }).getByTestId("elo-change")).toHaveCount(0);
    await noContactData(page);
    // Not for search engines, and no link preview (D112).
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(0);
    await context.close();
  } finally {
    for (const row of original) {
      d1Update(`update season_phases set starts_at = ${row.starts_at} where season_id = ${row.season_id} and number = 1`);
    }
  }
});

test("33. an unknown pair or player is a 404 for a member", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  for (const path of ["/pairs/999999", "/pairs/abc", "/players/nincs-ilyen"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Ez az oldal nem létezik.")).toBeVisible();
  }
  await context.close();
});

test("33. Anna finds her profile on Profil and the pair's on Párom", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  await visit(page, "/profile");
  // "Játékosprofil", the default tab (D136), links the page others see.
  await content(page).getByRole("link", { name: "profilodon" }).click();
  await expect(page).toHaveURL(/\/players\/[0-9a-f-]+$/);
  await expect(content(page).getByRole("heading", { level: 1 })).toHaveText(anna.name);
  await visit(page, "/pair");
  await content(page).getByRole("link", { name: "A párotok oldala" }).click();
  await expect(page).toHaveURL(/\/pairs\/\d+$/);
  await expect(content(page).getByRole("heading", { level: 1 })).toContainText(partner.name);
  await context.close();
});
