// The public league page (#30): a logged-out visitor sees every group of the
// published phase in division bands, with tables and this week's matches,
// names only. Runs after the groups were published (06) and some matches were
// scheduled (15-matches): 6 pairs are 2 groups
// of 3, so the bands are Bronz and Réz. The seed's round 1 is about two weeks
// out, so the page shows week 1 of a phase that has not started.
import { expect, test } from "@playwright/test";

import { GROUP_PAIRS, PAIRS, content, d1, visit } from "./support";

test("the landing page's league card leads to the league page", async ({ browser }) => {
  const page = await browser.newPage();
  await visit(page, "/");
  await page.getByRole("region", { name: /Mintaváros: a liga állása/ }).getByRole("link", { name: "Csoportok és tabella" }).click();
  await expect(page).toHaveURL(/\/league\/minta$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Padelpárbaj Mintaváros");
  await page.close();
});

test("a visitor sees the bands, group tables and every week's matches", async ({ browser }) => {
  const page = await browser.newPage();
  await visit(page, "/league/minta");
  const main = content(page);

  // 2 groups: Bronz 1, Réz 1, with a header (and the explainer link) on each band.
  await expect(main.getByRole("region", { name: "Bronz divízió" }).getByRole("region", { name: "1. csoport" })).toBeVisible();
  await expect(main.getByRole("region", { name: "Réz divízió" }).getByRole("region", { name: "2. csoport" })).toBeVisible();
  await expect(main.getByRole("region", { name: "Rookie divízió" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Hogyan működik?" })).toHaveCount(2);

  // Every pair of both groups, by name; the pair that joins later is not there.
  for (const player of GROUP_PAIRS.flat()) await expect(main).toContainText(player.name);
  await expect(main).not.toContainText(PAIRS.late[0].name);

  // A table with 3 rows per group, all at zero and no places before the first result;
  // the fixture list has every week with one match each in a group of 3 (D133).
  const first = main.getByRole("region", { name: "1. csoport" });
  await expect(first.getByRole("row")).toHaveCount(4); // header + 3 pairs
  await expect(first).toContainText("Még nincs végleges eredmény: a sorrend a kiemelés.");
  for (const week of ["1. hét", "2. hét", "3. hét"]) await expect(first.getByRole("region", { name: week, exact: true })).toBeVisible();
  await expect(first.getByRole("listitem")).toHaveCount(3);
  await expect(first).toContainText("Pihen:");
  // 15-matches fixed a time for some matches: those show it, the open ones "Egyeztetés alatt".
  const count = (status: string) =>
    d1(
      `select count(*) as n from matches m join groups g on g.id = m.group_id join seasons s on s.id = g.season_id join leagues l on l.id = s.league_id
       where l.slug = 'minta' and g.phase = 1 and m.status = '${status}'`,
    )[0]!.n as number;
  await expect(main.getByText("Egyeztetés alatt", { exact: true })).toHaveCount(count("open"));
  await expect(main.locator("li", { hasText: /\d{2}:\d{2}/ })).toHaveCount(count("scheduled"));
  await expect(main).toContainText("1. kör, indul");

  // The explainer: three points, reached from a division header.
  await main.getByRole("link", { name: "Hogyan működik?" }).first().click();
  await expect(page).toHaveURL(/#hogyan-mukodik$/);
  const explainer = main.getByRole("region", { name: "Hogyan működik?" });
  await expect(explainer.getByRole("listitem")).toHaveCount(3);
  await expect(explainer).toContainText("Egyetlen létra");
  await expect(explainer).toContainText("A divíziók a létra harmadai");
  await expect(explainer).toContainText("Egy fel, egy le");

  // Link preview like the other public pages.
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Padelpárbaj Mintaváros: csoportok és tabella/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /og\.png$/);
  await page.close();
});

test("no email or phone number anywhere on the page", async ({ browser }) => {
  const page = await browser.newPage();
  await visit(page, "/league/minta");
  const html = await page.content();
  for (const player of GROUP_PAIRS.flat()) expect(html).not.toContain(player.email);
  // Site footer has the contact address of the site itself; the page body has no address or number.
  await expect(content(page)).not.toContainText("@");
  await expect(content(page)).not.toContainText(/\+36|\b06[ -]?\d{2}/);
  await page.close();
});

test("the page fits a 390 px phone", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await visit(page, "/league/minta");
  await expect(content(page).getByRole("region", { name: "Bronz divízió" })).toBeVisible();
  // A string, since the suite's tsconfig has no DOM types.
  const overflow = await page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});

test("an unknown league is a 404", async ({ browser }) => {
  const page = await browser.newPage();
  const response = await page.goto("/league/nincs-ilyen");
  expect(response?.status()).toBe(404);
  await page.close();
});
