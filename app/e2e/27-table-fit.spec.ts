// No cut-off columns (#278): the Párok list at 390px and the Jelentkezők list
// at 1280px each fit their box, so nothing hides behind a sideways scroll.
// Read-only; runs on the state the walkthrough left.
import { expect, test, type Page } from "@playwright/test";

import { ADMIN, ORGANIZER, as, content, visit } from "./support";

// The tables of the page whose box scrolls sideways (a cut-off column).
async function scrollingBoxes(page: Page): Promise<number> {
  return content(page)
    .locator('[data-slot="table-container"]')
    .evaluateAll((boxes) => boxes.filter((b) => b.scrollWidth > b.clientWidth + 1).length);
}

test("Párok at 390px: every row's columns and buttons are inside the screen", async ({ browser }) => {
  const { context, page } = await as(browser, ORGANIZER.email);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, "/admin/leagues/minta/pairs");
  const table = page.getByRole("table", { name: "Párok listája" });
  await expect(table.locator("tbody tr").first()).toBeVisible();
  expect(await scrollingBoxes(page)).toBe(0);
  // The first pair's state and its buttons are on screen, not cut.
  const pairRow = table.locator("tbody tr").filter({ has: page.getByRole("button", { name: "Felbontás" }) }).first();
  await expect(pairRow.getByText("Aktív").first()).toBeVisible();
  const box = await pairRow.getByRole("button", { name: "Felbontás" }).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await context.close();
});

test("Jelentkezők at 1280px: every column, Törlés included, is inside the box", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await page.setViewportSize({ width: 1280, height: 800 });
  await visit(page, "/admin/signups");
  await expect(page.getByRole("button", { name: "Törlés" }).first()).toBeVisible();
  expect(await scrollingBoxes(page)).toBe(0);
  const box = await page.getByRole("button", { name: "Törlés" }).first().boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
  await context.close();
});
