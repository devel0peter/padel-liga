// No cut-off columns (#278) and no counts table on Párok (#298): the Párok list
// and the strikes table at 390px each fit their box, so nothing hides behind a
// sideways scroll. Read-only; runs on the state the walkthrough left.
import { expect, test, type Locator } from "@playwright/test";

import { ORGANIZER, as, visit } from "./support";

async function overflow(table: Locator): Promise<{ content: number; box: number }> {
  return table.evaluate((t) => {
    const box = t.parentElement!;
    return { content: box.scrollWidth, box: box.clientWidth };
  });
}

async function expectFits(table: Locator, name: string) {
  const { content, box } = await overflow(table);
  expect(content, `${name}: content ${content}px in a ${box}px box`).toBeLessThanOrEqual(box);
}

test("Párok at 390px: the list and the strikes table fit, with no counts table", async ({ browser }) => {
  const { context, page } = await as(browser, ORGANIZER.email);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, "/admin/leagues/minta/pairs");
  // #298: the counts table is gone; the filter still shows its counts.
  await expect(page.getByRole("table", { name: "Párok és játékosok állapot szerint" })).toHaveCount(0);
  await expect(page.getByText("Összesen", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Nevezés szerint" })).toContainText(/Nevezett \(\d+\)/);

  const list = page.getByRole("table", { name: "Párok listája" });
  await expect(list.locator("tbody tr").first()).toBeVisible();
  await expectFits(list, "Párok listája");
  // An active pair's state and its buttons are on screen, not cut.
  const pairRow = list.locator("tbody tr").filter({ has: page.getByRole("button", { name: "Felbontás" }) }).first();
  await expect(pairRow.getByText("Aktív").first()).toBeVisible();
  const box = await pairRow.getByRole("button", { name: "Felbontás" }).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  // The strikes table: spec 24 leaves strikes on minta, so it must be there (a failure, not a skip).
  const strikes = page.getByRole("table", { name: "Fekete pontok" });
  await expect(strikes).toBeVisible();
  await expectFits(strikes, "Fekete pontok");
  await context.close();
});
