// Walkthrough step 33a (D137): the Ranglista, players and pairs by Élő-pont,
// for logged-in players only. Runs after 19-profiles. In the walkthrough round
// 1 has not started, so the page shows no rating; for the lists the test moves
// round 1's start into the past and puts it back, like 19-profiles.
import { expect, test } from "@playwright/test";

import { GROUP_PAIRS, PAIRS, as, content, d1, d1Update, visit } from "./support";

const anna = PAIRS.p1[0];
const ROUND_1 = `season_id in (select s.id from seasons s join leagues l on l.id = s.league_id where l.slug = 'minta') and number = 1`;

test("33a. a visitor must log in for the Ranglista", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/league/minta/rankings");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fleague%2Fminta%2Frankings$/);
  await page.close();
});

test("33a. before round 1 starts the Ranglista shows no rating", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  await visit(page, "/home");
  await page.getByRole("navigation").getByRole("link", { name: "Ranglista" }).first().click();
  await expect(page).toHaveURL(/\/league\/minta\/rankings$/);
  await expect(content(page)).toContainText("Az Élő-pontok a liga indulása után látszanak itt.");
  await expect(content(page).getByRole("table")).toHaveCount(0);
  await context.close();
});

test("33a. once round 1 has started: every placed player and pair by Élő-pont, Anna marked", async ({ browser }) => {
  const original = d1(`select season_id, starts_at from season_phases where ${ROUND_1}`) as { season_id: number; starts_at: number }[];
  d1Update(`update season_phases set starts_at = ${Math.floor(Date.now() / 1000) - 86_400} where ${ROUND_1}`);
  try {
    const { context, page } = await as(browser, anna);
    // From the Tabella's header, as on a phone.
    await visit(page, "/league/minta");
    await content(page).getByRole("link", { name: "Ranglista" }).click();
    await expect(page).toHaveURL(/\/league\/minta\/rankings$/);
    const main = content(page);

    const players = main.getByRole("table", { name: "Játékosok Élő-pont szerint" });
    await expect(players.locator("tbody tr")).toHaveCount(GROUP_PAIRS.flat().length);
    await expect(players.locator("tbody tr").filter({ hasText: anna.name })).toContainText("(te)");
    // Highest first.
    const elos = (await players.locator("tbody tr td:nth-child(3)").allTextContents()).map(Number);
    expect(elos).toEqual([...elos].sort((x, y) => y - x));
    await expect(players.getByRole("link", { name: anna.name })).toHaveAttribute("href", /^\/players\//);

    await main.getByRole("tab", { name: "Párok" }).click();
    await expect(page).toHaveURL(/\?view=pairs$/);
    const pairs = main.getByRole("table", { name: "Párok Élő-pont szerint" });
    await expect(pairs.locator("tbody tr")).toHaveCount(GROUP_PAIRS.length);
    await expect(pairs.locator("tbody tr").filter({ hasText: anna.name })).toContainText("(ti)");

    // Names and ratings only.
    await expect(main).not.toContainText("@");
    await expect(main).not.toContainText(/\+36/);
    await context.close();
  } finally {
    for (const row of original) d1Update(`update season_phases set starts_at = ${row.starts_at} where season_id = ${row.season_id} and number = 1`);
  }
});
