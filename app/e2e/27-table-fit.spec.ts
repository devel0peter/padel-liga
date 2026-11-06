// No cut-off columns (#278) and no counts table on Párok (#298): the Párok list
// and the strikes table at 390px, and the Jelentkezők list at 1280px, each fit
// their box, so nothing hides behind a sideways scroll. Read-only; runs on the
// state the walkthrough left.
import { expect, test, type Locator } from "@playwright/test";

import { ADMIN, ORGANIZER, as, visit } from "./support";

// The Állapot words of a signup (STATUSES in app/lib/signups-admin.ts; e2e
// can't import it).
const STATUS_WORDS = ["Új", "Megkeresve", "Párosítva", "Visszalépett"];

// A table sits in a scrolling box (the table's parent); a cut-off column is
// a box whose content is wider than it.
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
  // The strikes table is there once a strike was given (spec 24).
  const strikes = page.getByRole("table", { name: "Fekete pontok" });
  if ((await strikes.count()) > 0) await expectFits(strikes, "Fekete pontok");
  await context.close();
});

test("Jelentkezők at 1280px: every column, Törlés included, is inside the box", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await page.setViewportSize({ width: 1280, height: 800 });
  await visit(page, "/admin/signups");
  const list = page.getByRole("table", { name: "Jelentkezők listája" });
  await expect(list.getByRole("button", { name: "Törlés" }).first()).toBeVisible();
  await expectFits(list, "Jelentkezők listája");
  const del = await list.getByRole("button", { name: "Törlés" }).first().boundingBox();
  expect(del!.x + del!.width).toBeLessThanOrEqual(1280);

  // Every status word fits its select (the seed only has "Új" and "Párosítva"):
  // the first select shows each word in turn, in the page only.
  const value = list.locator('[data-slot="select-value"]').first();
  for (const word of STATUS_WORDS) {
    await value.evaluate((el, w) => (el.textContent = w), word);
    const { scroll, client } = await value.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(scroll, `"${word}" is cut: ${scroll}px in ${client}px`).toBeLessThanOrEqual(client);
  }
  await context.close();
});
