// Párok: search and the entry filter, in the address, and "Levél nekik" to
// the broadcast page (#148); Játékosok's "Levél nekik" for the players
// without a pair (#301). Runs after the walkthrough, on the state it left;
// nothing here changes it (no email is sent).
import { expect, test } from "@playwright/test";

import { ADMIN, ORGANIZER, PAIRS, WAITING_SOLOS, as, content, d1, visit } from "./support";

const PAGE = "/admin/leagues/minta/pairs";
// "Kovács Anna" -> "kovacs anna": the search ignores case and accents.
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

test("search and the Nincs a ligában filter, kept in the address", async ({ browser }) => {
  const [anna, partner] = PAIRS.p1;
  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, PAGE);
  const bodyRows = page.getByRole("table", { name: "Párok listája" }).locator("tbody tr");

  // Search: lowercase, without accents; a pair shows when either player matches.
  const search = page.getByRole("searchbox", { name: "Keresés" });
  await search.fill(fold(partner.name));
  await search.press("Enter");
  await expect(page).toHaveURL(/q=/);
  await expect(bodyRows.filter({ hasText: anna.name }).filter({ hasText: partner.name })).toHaveCount(1);

  // Nincs a ligában: the pairs not entered; the count is the rows shown.
  await page.getByRole("link", { name: "Szűrők törlése" }).click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(search).toHaveValue("");
  await expect(page.getByRole("link", { name: "Szűrők törlése" })).toHaveCount(0);
  const option = page.getByRole("link", { name: /^Nincs a ligában \(\d+\)$/ });
  const count = Number(/\((\d+)\)/.exec((await option.textContent()) ?? "")![1]);
  await option.click();
  await expect(page).toHaveURL(/entry=not_in_league/);
  await expect(bodyRows).toHaveCount(count);
  await expect(bodyRows.filter({ hasText: anna.name })).toHaveCount(0);

  // A reload keeps the filter; "Szűrők törlése" shows every row again.
  await page.reload();
  await expect(page.getByRole("link", { name: /^Nincs a ligában/ })).toHaveAttribute("aria-current", "page");
  await expect(bodyRows).toHaveCount(count);
  await page.getByRole("link", { name: "Szűrők törlése" }).click();
  await expect(bodyRows.filter({ hasText: anna.name })).toHaveCount(1);

  // Never an email address; phone numbers tap to call (D126).
  await expect(content(page)).not.toContainText("@example.test");
  await expect(bodyRows.filter({ hasText: anna.name }).locator('a[href="tel:+36301234567"]').first()).toBeVisible();
  // The broadcast page is the Admin's: the Szervező has no "Levél nekik".
  await visit(page, `${PAGE}?entry=entered`);
  await expect(page.getByRole("link", { name: "Levél nekik" })).toHaveCount(0);
  await context.close();
});

test("Levél nekik opens the broadcast page with the players shown; nothing is sent", async ({ browser }) => {
  const anna = PAIRS.p1[0];
  const akos = WAITING_SOLOS[1];
  const emailsBefore = d1("select count(*) as n from email_messages");
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, `${PAGE}?entry=entered`);
  await page.getByRole("link", { name: "Levél nekik" }).click();
  await expect(page).toHaveURL(/\/admin\/broadcasts\/new\?pairs=minta&entry=entered/);
  await expect(content(page)).toContainText("Párok, Padelpárbaj Mintaváros");
  await page.getByText("Lista", { exact: true }).click();
  await expect(content(page)).toContainText(anna.name);
  await expect(content(page)).not.toContainText(akos.name);
  await page.getByRole("link", { name: "Szűrők módosítása" }).click();
  await expect(page).toHaveURL(/\/admin\/leagues\/minta\/pairs\?entry=entered/);

  // The players without a pair: from Játékosok (#301).
  await visit(page, "/admin/leagues/minta/players?filter=no_pair");
  await page.getByRole("link", { name: "Levél nekik" }).click();
  await expect(page).toHaveURL(/\/admin\/broadcasts\/new\?players=minta&filter=no_pair/);
  await expect(content(page)).toContainText("Játékosok, Padelpárbaj Mintaváros");
  await expect(content(page)).toContainText("Nincs párja");
  await page.getByText("Lista", { exact: true }).click();
  await expect(content(page)).toContainText(akos.name);
  await expect(content(page)).not.toContainText(anna.name);
  expect(d1("select count(*) as n from email_messages")).toEqual(emailsBefore);
  await context.close();
});
