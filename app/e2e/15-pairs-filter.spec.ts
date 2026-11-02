// Párok: search and the entry filter, in the address, and "Levél nekik" to
// the broadcast page (#148). Runs after the walkthrough, on the state it left;
// nothing here changes it (no email is sent).
import { expect, test } from "@playwright/test";

import { ADMIN, ORGANIZER, PAIRS, WAITING_SOLOS, as, content, d1, visit } from "./support";

const PAGE = "/admin/leagues/minta/pairs";
// "Kovács Anna" -> "kovacs anna": the search ignores case and accents.
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

test("search and the Nincs a ligában filter, kept in the address", async ({ browser }) => {
  const [anna, partner] = PAIRS.p1;
  const akos = WAITING_SOLOS[1];
  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, PAGE);
  const bodyRows = page.locator("tbody tr");

  // Search: lowercase, without accents; a pair shows when either player matches.
  const search = page.getByRole("searchbox", { name: "Keresés" });
  await search.fill(fold(partner.name));
  await search.press("Enter");
  await expect(page).toHaveURL(/q=/);
  await expect(bodyRows.filter({ hasText: anna.name }).filter({ hasText: partner.name })).toHaveCount(1);

  // Nincs a ligában: players without a pair and pairs not entered; the count is the rows shown.
  await page.getByRole("link", { name: "Szűrők törlése" }).click();
  await expect(page).not.toHaveURL(/q=/);
  const option = page.getByRole("link", { name: /^Nincs a ligában \(\d+\)$/ });
  const count = Number(/\((\d+)\)/.exec((await option.textContent()) ?? "")![1]);
  await option.click();
  await expect(page).toHaveURL(/entry=not_in_league/);
  await expect(bodyRows).toHaveCount(count);
  await expect(bodyRows.filter({ hasText: akos.name })).toContainText("Nincs párja");
  await expect(bodyRows.filter({ hasText: anna.name })).toHaveCount(0);

  // A reload keeps the filter; "Szűrők törlése" shows every row again.
  await page.reload();
  await expect(page.getByRole("link", { name: /^Nincs a ligában/ })).toHaveAttribute("aria-current", "page");
  await expect(bodyRows).toHaveCount(count);
  await page.getByRole("link", { name: "Szűrők törlése" }).click();
  await expect(bodyRows.filter({ hasText: anna.name })).toHaveCount(1);

  // Never an email address or a phone number.
  await expect(content(page)).not.toContainText("@example.test");
  await expect(content(page)).not.toContainText("+36");
  // The broadcast page is the Admin's: the Szervező has no "Levél nekik".
  await visit(page, `${PAGE}?entry=no_pair`);
  await expect(page.getByRole("link", { name: "Levél nekik" })).toHaveCount(0);
  await context.close();
});

test("Levél nekik opens the broadcast page with the players shown; nothing is sent", async ({ browser }) => {
  const anna = PAIRS.p1[0];
  const akos = WAITING_SOLOS[1];
  const emailsBefore = d1("select count(*) as n from email_messages");
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, `${PAGE}?entry=not_in_league`);
  await page.getByRole("link", { name: "Levél nekik" }).click();
  await expect(page).toHaveURL(/\/admin\/broadcasts\/new\?pairs=minta&entry=not_in_league/);
  await expect(content(page)).toContainText("Párok, Padelpárbaj Mintaváros");
  await expect(content(page)).toContainText("Nincs a ligában");
  await page.getByText("Lista").click();
  await expect(content(page)).toContainText(akos.name);
  await expect(content(page)).not.toContainText(anna.name);
  await page.getByRole("link", { name: "Szűrők módosítása" }).click();
  await expect(page).toHaveURL(/\/admin\/leagues\/minta\/pairs\?entry=not_in_league/);
  expect(d1("select count(*) as n from email_messages")).toEqual(emailsBefore);
  await context.close();
});
