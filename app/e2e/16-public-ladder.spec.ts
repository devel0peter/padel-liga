// The league page, the player's "Tabella" (#30): for logged-in players only
// since D134. A player sees every group of the published phase, each a card
// with its division and table; the group's matches open in a side panel
// (D136). Names only. Runs after the groups were published (06) and some
// matches were scheduled (15-matches): 6 pairs are 2 groups of 3, so the
// divisions are Bronz and Réz. The seed's round 1 is about two weeks out, so
// the page shows week 1 of a phase that has not started.
import { expect, test } from "@playwright/test";

import { GROUP_PAIRS, PAIRS, as, content, d1, visit } from "./support";

const anna = PAIRS.p1[0];

test("the landing page doesn't link the league page, and a visitor must log in (D134)", async ({ browser }) => {
  const page = await browser.newPage();
  await visit(page, "/");
  await expect(page.getByRole("region", { name: /Mintaváros: a liga állása/ })).toBeVisible();
  await expect(page.locator('a[href^="/league/"]')).toHaveCount(0);
  await page.goto("/league/minta");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fleague%2Fminta$/);
  await page.close();
});

test("a player opens the Tabella from the sidebar: the groups, their tables, and the matches in a side panel", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  await visit(page, "/home");
  await page.getByRole("link", { name: "Tabella", exact: true }).locator("visible=true").first().click();
  await expect(page).toHaveURL(/\/league\/minta$/);
  const main = content(page);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Tabella");

  // 2 groups, each naming its division; no Rookie group with 6 pairs.
  const first = main.getByRole("region", { name: "1. csoport" });
  await expect(first).toContainText("Bronz divízió");
  await expect(main.getByRole("region", { name: "2. csoport" })).toContainText("Réz divízió");
  // No group card is Rookie (the explainer tooltip names it, so look at the cards).
  await expect(main.getByRole("region", { name: /^\d+\. csoport$/ }).filter({ hasText: "Rookie divízió" })).toHaveCount(0);
  // Anna's group and pair are marked.
  await expect(first).toContainText("A ti csoportotok");
  await expect(first.getByRole("row").filter({ hasText: anna.name })).toContainText("(ti)");

  // Every pair of both groups, by name; the pair that joins later is not there.
  for (const player of GROUP_PAIRS.flat()) await expect(main).toContainText(player.name);
  await expect(main).not.toContainText(PAIRS.late[0].name);

  // A table with 3 rows per group, all at zero and no places before the first result.
  await expect(first.getByRole("row")).toHaveCount(4); // header + 3 pairs
  await expect(first).toContainText("Még nincs végleges eredmény: a sorrend a kiemelés.");
  // The groups sit in their division's band (D143).
  await expect(main.getByRole("region", { name: "Bronz divízió", exact: true }).getByRole("region", { name: "1. csoport" })).toHaveCount(1);

  // The matches sit beside the table on a wide card (D143): every week with one match in a group of 3.
  await expect(first.getByRole("button", { name: /^Mérkőzések/ })).toBeHidden();
  const panel = first.getByRole("group", { name: "1. csoport meccsei" });
  for (const week of ["1. hét", "2. hét", "3. hét"]) await expect(panel.getByRole("region", { name: week, exact: true })).toBeVisible();
  await expect(panel.getByRole("listitem")).toHaveCount(3);
  await expect(panel).toContainText("Pihen:");
  // 15-matches fixed a time for some matches: those show it, the open ones "Egyeztetés alatt".
  const count = (status: string) =>
    d1(
      `select count(*) as n from matches m join groups g on g.id = m.group_id join seasons s on s.id = g.season_id join leagues l on l.id = s.league_id
       where l.slug = 'minta' and g.phase = 1 and g.number = 1 and m.status = '${status}'`,
    )[0]!.n as number;
  await expect(panel.getByText("Egyeztetés alatt", { exact: true })).toHaveCount(count("open"));
  await expect(panel.locator("li", { hasText: /\d{2}:\d{2}/ })).toHaveCount(count("scheduled"));
  // Anna's own matches link to their page.
  await expect(panel.locator('a[href^="/matches/"]')).toHaveCount(2);
  await expect(main).toContainText("1. kör, indul");

  // The explainer: three points in a tooltip behind the "?" by the title (D138).
  const tip = main.getByRole("tooltip");
  await expect(tip).toBeHidden();
  await main.getByRole("button", { name: "Hogyan működik a létra?" }).click();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Egyetlen létra");
  await expect(tip).toContainText("A divíziók a létra harmadai");
  await expect(tip).toContainText("Egy fel, egy le");
  await expect(main.getByRole("heading", { level: 1, name: "Tabella", exact: true })).toBeVisible();

  // On a phone the card shows one of the two; "Mérkőzések" switches to the matches and back (D143).
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(first.getByRole("table")).toBeVisible();
  await expect(panel).toBeHidden();
  await first.getByRole("button", { name: "Mérkőzések (3)" }).click();
  await expect(panel).toBeVisible();
  await expect(first.getByRole("table")).toBeHidden();
  await first.getByRole("button", { name: "Tabella" }).click();
  await expect(first.getByRole("table")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });

  // Not for search engines or link previews.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(0);
  await context.close();
});

test("no email, phone number or Élő-pont anywhere on the page", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  await visit(page, "/league/minta");
  const html = await page.content();
  // The viewer's own address is in the app shell's account menu: not a player's on the page.
  for (const player of GROUP_PAIRS.flat().filter((p) => p.email !== anna.email)) expect(html).not.toContain(player.email);
  await expect(content(page)).not.toContainText("@");
  await expect(content(page)).not.toContainText(/\+36|\b06[ -]?\d{2}/);
  await expect(content(page)).not.toContainText("Élő-pont");
  await context.close();
});

test("the page fits a 390 px phone", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, "/league/minta");
  await expect(content(page).getByRole("region", { name: "1. csoport" })).toBeVisible();
  // A string, since the suite's tsconfig has no DOM types.
  const overflow = await page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});

test("an unknown league is a 404 for a player", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  const response = await page.goto("/league/nincs-ilyen");
  expect(response?.status()).toBe(404);
  await context.close();
});
