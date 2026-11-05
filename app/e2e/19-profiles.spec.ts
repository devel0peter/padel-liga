// Walkthrough step 32 (#36): public pair and player profiles. Runs after
// 19-ladder-results: Anna's pair has a confirmed win (step 27, rated) and a
// "both lose" decision (step 28, not rated). In the walkthrough round 1 has
// not started yet, so a profile shows names and groups only (spec 17); for
// the results the test moves round 1's start into the past and puts it back.
// A visitor reaches the pair from the league page's table, then a player
// from the pair page; neither page shows an email or phone. Anna finds the
// links on Profil and Párom.
import { expect, test, type Page } from "@playwright/test";

import { PAIRS, as, content, d1, d1Update, visit } from "./support";

const anna = PAIRS.p1[0];
const partner = PAIRS.p1[1];

// Round 1 of the seeded league's season(s).
const ROUND_1 = `season_id in (select s.id from seasons s join leagues l on l.id = s.league_id where l.slug = 'minta') and number = 1`;

async function openPairFromLeague(page: Page): Promise<void> {
  await visit(page, "/league/minta");
  const group = content(page)
    .getByRole("region", { name: /^\d+\. csoport$/ })
    .filter({ hasText: anna.name });
  await group.locator("tbody tr").filter({ hasText: anna.name }).getByRole("link").click();
  await expect(page).toHaveURL(/\/pairs\/\d+$/);
}

async function noContactData(page: Page): Promise<void> {
  for (const text of [await content(page).innerText(), await page.title()]) {
    expect(text).not.toMatch(/@|\+36|example\.test/);
  }
}

test("32. before round 1 starts a profile shows names and groups only", async ({ browser }) => {
  const page = await browser.newPage();
  await openPairFromLeague(page);
  const main = content(page);
  await expect(main.getByRole("heading", { level: 1 })).toContainText(anna.name);
  await expect(main.getByRole("heading", { level: 1 })).toContainText(partner.name);
  await expect(main.getByRole("region", { name: "Csoportok" })).toContainText(/1\. kör: \d+\. csoport \(\w+ divízió\)/);
  await expect(main.getByRole("region", { name: "Meccsek" })).toHaveCount(0);
  await expect(main).toContainText("Az eredmények a liga indulása után látszanak itt.");
  await noContactData(page);

  await main.getByRole("heading", { level: 1 }).getByRole("link", { name: anna.name }).click();
  await expect(page).toHaveURL(/\/players\/[0-9a-f-]+$/);
  await expect(content(page).getByRole("heading", { level: 1 })).toHaveText(anna.name);
  await expect(content(page).getByTestId("player-elo")).toHaveCount(0);
  await expect(content(page).getByRole("region", { name: "Párja" })).toContainText(partner.name);
  await noContactData(page);
  await page.close();
});

test("32. once round 1 has started: the results, the értékszám and its change", async ({ browser }) => {
  const original = d1(`select season_id, starts_at from season_phases where ${ROUND_1}`) as { season_id: number; starts_at: number }[];
  expect(original.length).toBeGreaterThan(0);
  d1Update(`update season_phases set starts_at = ${Math.floor(Date.now() / 1000) - 86_400} where ${ROUND_1}`);
  try {
    const page = await browser.newPage();
    await openPairFromLeague(page);
    const main = content(page);
    await expect(main.getByRole("region", { name: "Csoportok" })).toContainText(/\d+\. hely/);
    const matches = main.getByRole("region", { name: "Meccsek" });
    await expect(matches).toContainText(/Győzelem · (4:1, 2:4, szuper tie-break 10:8|1:4, 4:2, szuper tie-break 8:10)/);
    await expect(matches).toContainText("Vereség · Mindkét pár vereséget kap (0:4, 0:4)");
    await expect(matches.getByRole("listitem")).toHaveCount(2);
    await noContactData(page);

    await main.getByRole("heading", { level: 1 }).getByRole("link", { name: anna.name }).click();
    await expect(page).toHaveURL(/\/players\/[0-9a-f-]+$/);
    const player = content(page);
    await expect(player.getByTestId("player-elo")).toHaveText(/^Értékszám: \d+$/);
    // The win changed her rating; the "both lose" decision did not.
    const lines = player.getByRole("region", { name: "Meccsek" }).getByRole("listitem");
    await expect(lines).toHaveCount(2);
    await expect(lines.filter({ hasText: "Győzelem" }).getByTestId("elo-change")).toHaveText(/^Értékszám: \+\d+ → \d+$/);
    await expect(lines.filter({ hasText: "Mindkét pár" }).getByTestId("elo-change")).toHaveCount(0);
    await noContactData(page);
    // A link preview like the league page's.
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", `${anna.name} – Padelpárbaj`);
    await page.close();
  } finally {
    for (const row of original) {
      d1Update(`update season_phases set starts_at = ${row.starts_at} where season_id = ${row.season_id} and number = 1`);
    }
  }
});

test("32. an unknown pair or player is a 404", async ({ browser }) => {
  const page = await browser.newPage();
  for (const path of ["/pairs/999999", "/pairs/abc", "/players/nincs-ilyen"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Ez az oldal nem létezik.")).toBeVisible();
  }
  await page.close();
});

test("32. Anna finds her public profile on Profil and the pair's on Párom", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  await visit(page, "/profile");
  await content(page).getByRole("link", { name: "Nyilvános profilod" }).click();
  await expect(page).toHaveURL(/\/players\/[0-9a-f-]+$/);
  await expect(content(page).getByRole("heading", { level: 1 })).toHaveText(anna.name);
  await visit(page, "/pair");
  await content(page).getByRole("link", { name: "A párotok nyilvános oldala" }).click();
  await expect(page).toHaveURL(/\/pairs\/\d+$/);
  await expect(content(page).getByRole("heading", { level: 1 })).toContainText(partner.name);
  await context.close();
});
