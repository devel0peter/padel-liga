// Walkthrough step 33a (D137): the Ranglista, players and pairs by Élő-pont,
// for logged-in players only. Runs after 19-profiles. In the walkthrough round
// 1 has not started, so the page shows no rating; for the lists the test moves
// round 1's start into the past and puts it back, like 19-profiles.
import { expect, test } from "@playwright/test";

import { GROUP_PAIRS, PAIRS, as, content, d1, d1Update, teamLabel, visit } from "./support";

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
  await page.getByRole("link", { name: "Ranglista", exact: true }).locator("visible=true").first().click();
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
    // From the sidebar (the Tabella has no button to it, D143).
    await visit(page, "/home");
    await page.getByRole("link", { name: "Ranglista", exact: true }).locator("visible=true").first().click();
    await expect(page).toHaveURL(/\/league\/minta\/rankings$/);
    const main = content(page);

    const players = main.getByRole("table", { name: "Játékosok Élő-pont szerint" });
    await expect(players.locator("tbody tr")).toHaveCount(GROUP_PAIRS.flat().length);
    await expect(players.locator("tbody tr").filter({ hasText: anna.name })).toContainText("(te)");
    // Highest first. Columns: #, Játékos, Pár, Divízió, Élő-pont, Meccs (#422); her own with its last change.
    const elos = (await players.locator("tbody tr td:nth-child(5)").allTextContents()).map((t) => Number(t.replace(/[+−]\d+$/, "")));
    expect(elos).toEqual([...elos].sort((x, y) => y - x));
    await expect(players.getByRole("link", { name: anna.name })).toHaveAttribute("href", /^\/players\//);

    await expect(players.locator("tbody tr").filter({ hasText: anna.name })).toContainText(teamLabel(anna, PAIRS.p1[1]));
    await main.getByRole("link", { name: "Párok", exact: true }).click();
    await expect(page).toHaveURL(/\?view=pairs$/);
    const pairs = main.getByRole("table", { name: "Párok Élő-pont szerint" });
    await expect(pairs.locator("tbody tr")).toHaveCount(GROUP_PAIRS.length);
    // A pair by its team label (#419), "Kovács / Nagy".
    await expect(pairs.locator("tbody tr").filter({ hasText: teamLabel(anna, PAIRS.p1[1]) })).toContainText("(ti)");

    // Names and ratings only.
    await expect(main).not.toContainText("@");
    await expect(main).not.toContainText(/\+36/);
    await context.close();
  } finally {
    for (const row of original) d1Update(`update season_phases set starts_at = ${row.starts_at} where season_id = ${row.season_id} and number = 1`);
  }
});
