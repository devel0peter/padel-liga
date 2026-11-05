// Walkthrough step 32 (#36): public pair and player profiles. Runs after
// 19-ladder-results: Anna's pair has a confirmed win (step 27, rated) and a
// "both lose" decision (step 28, not rated). A visitor reaches the pair from
// the league page's table, then a player from the pair page; neither page
// shows an email or phone. Anna finds the links on Profil and Párom.
import { expect, test } from "@playwright/test";

import { PAIRS, as, content, visit } from "./support";

const anna = PAIRS.p1[0];
const partner = PAIRS.p1[1];

test("32. a visitor opens the pair from the league table, then the player", async ({ browser }) => {
  const page = await browser.newPage();
  await visit(page, "/league/minta");
  const group = content(page)
    .getByRole("region", { name: /^\d+\. csoport$/ })
    .filter({ hasText: anna.name });
  await group.locator("tbody tr").filter({ hasText: anna.name }).getByRole("link").click();
  await expect(page).toHaveURL(/\/pairs\/\d+$/);

  const main = content(page);
  await expect(main.getByRole("heading", { level: 1 })).toContainText(anna.name);
  await expect(main.getByRole("heading", { level: 1 })).toContainText(partner.name);
  const groups = main.getByRole("region", { name: "Csoportok" });
  await expect(groups).toContainText(/1\. kör: \d+\. csoport/);
  await expect(groups).toContainText(/\d+\. hely/);
  const matches = main.getByRole("region", { name: "Meccsek" });
  await expect(matches).toContainText(/Győzelem · (4:1, 2:4, szuper tie-break 10:8|1:4, 4:2, szuper tie-break 8:10)/);
  await expect(matches).toContainText("Vereség · Mindkét pár vereséget kap (0:4, 0:4)");
  await expect(matches.getByRole("listitem")).toHaveCount(2);
  for (const text of [await main.innerText(), await page.title()]) {
    expect(text).not.toMatch(/@|\+36|example\.test/);
  }

  await main.getByRole("heading", { level: 1 }).getByRole("link", { name: anna.name }).click();
  await expect(page).toHaveURL(/\/players\/[0-9a-f-]+$/);
  const player = content(page);
  await expect(player.getByRole("heading", { level: 1 })).toHaveText(anna.name);
  await expect(player.getByTestId("player-elo")).toHaveText(/^Értékszám: \d+$/);
  await expect(player.getByRole("region", { name: "Párja" })).toContainText(partner.name);
  // The win changed her rating; the "both lose" decision did not.
  const lines = player.getByRole("region", { name: "Meccsek" }).getByRole("listitem");
  await expect(lines).toHaveCount(2);
  await expect(lines.filter({ hasText: "Győzelem" }).getByTestId("elo-change")).toHaveText(/^Értékszám: \+\d+ → \d+$/);
  await expect(lines.filter({ hasText: "Mindkét pár" }).getByTestId("elo-change")).toHaveCount(0);
  expect(await player.innerText()).not.toMatch(/@|\+36|example\.test/);
  // A link preview like the league page's.
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", `${anna.name} – Padelpárbaj`);
  await page.close();
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
