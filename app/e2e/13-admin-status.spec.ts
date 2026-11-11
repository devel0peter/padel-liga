// The admin tables show where each player stands at a glance: account,
// what's missing, pair and entry; the Admin also sees the last login. Runs
// after the walkthrough, on the state it left (nothing here changes it).
import { expect, test } from "@playwright/test";

import { ADMIN, ORGANIZER, PAIRS, SEEKERS, WAITING_SOLOS, as, content, playersTable, visit } from "./support";

const ENTERED = /Nevezés \(.+\): Nevezett/;

test("Felhasználók: status chips and, for the Admin, the last login", async ({ browser }) => {
  const [anna, partner] = PAIRS.p1;
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, `/admin/users?q=${encodeURIComponent(anna.name)}`);
  await expect(page.getByRole("columnheader", { name: "Utolsó belépés" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: anna.name });
  await expect(row).toContainText("Regisztrált");
  await expect(row).toContainText(`Pár: ${partner.name}`);
  await expect(row).toContainText(ENTERED);
  // The phone number, tap to call (D126).
  await expect(row.getByRole("link", { name: "+36 30 123 4567" }).first()).toHaveAttribute("href", "tel:+36301234567");
  // Logged in during the walkthrough: a date, not the dash.
  await expect(row.getByRole("cell").nth(6)).toHaveText(/^\d{4}\. \d{2}\. \d{2}\. \d{2}:\d{2}$/);

  // Sándor Ákos lost his pair in step 14 and has none since.
  const akos = WAITING_SOLOS[1];
  // Lowercase and without the accent: the search folds both (search.ts).
  await visit(page, `/admin/users?q=akos`);
  await expect(page.getByRole("row").filter({ hasText: akos.name })).toContainText("Nincs párja");
  await context.close();
});

test("Párok and Játékosok: entries, a seeker back after a dissolve, phones but no email addresses", async ({ browser }) => {
  const [boglarka, akos] = WAITING_SOLOS;
  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta/pairs");
  const p1 = page.getByRole("row").filter({ hasText: PAIRS.p1[0].name }).filter({ hasText: PAIRS.p1[1].name });
  await expect(p1).toContainText(ENTERED);
  // Both players' phones, tap to call (D126).
  await expect(p1.locator('a[href="tel:+36301234567"]')).toHaveCount(2);

  // The pair made on Játékosok in step 13 was dissolved in step 14: Ákos,
  // still looking, is back under "Párt keres"; Boglárka, now Török Hanna's
  // partner, isn't (#301).
  await visit(page, SEEKERS);
  const seekers = playersTable(page);
  await expect(seekers).toContainText(akos.name);
  await expect(seekers).not.toContainText(boglarka.name);
  await expect(seekers.getByRole("row").filter({ hasText: akos.name }).locator('a[href="tel:+36301234567"]')).toBeVisible();
  await expect(content(page)).not.toContainText("@example.test");
  await context.close();
});

test("Felhasználók: filter by pair, kept in the address, with search and clear", async ({ browser }) => {
  const anna = PAIRS.p1[0];
  const akos = WAITING_SOLOS[1];
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/admin/users");
  await expect(page.getByRole("row").filter({ hasText: anna.email })).toBeVisible();

  await page.getByRole("combobox", { name: "Pár és nevezés" }).click();
  await page.getByRole("option", { name: /^Nincs párja \(\d+\)$/ }).click();
  await expect(page).toHaveURL(/pair=none/);
  await expect(page.getByRole("row").filter({ hasText: akos.email })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: anna.email })).toHaveCount(0);
  await expect(page.getByText(/ fiók \(összesen \d+\)/)).toBeVisible();

  // Reloading keeps the filter; the search narrows it further.
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Pár és nevezés" })).toContainText("Nincs párja");
  await visit(page, `/admin/users?pair=none&q=${encodeURIComponent(anna.email)}`);
  await expect(page.getByText("Nincs ilyen fiók.")).toBeVisible();

  await page.getByRole("link", { name: "Szűrők törlése" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole("row").filter({ hasText: anna.email })).toBeVisible();
  await context.close();
});
