// The admin tables show where each player stands at a glance: account,
// what's missing, pair and entry; the Admin also sees the last login. Runs
// after the walkthrough, on the state it left (nothing here changes it).
import { expect, test } from "@playwright/test";

import { ADMIN, LONE, ORGANIZER, PAIRS, WAITING_SOLOS, as, content, visit } from "./support";

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
  // Logged in during the walkthrough: a date, not the dash.
  await expect(row.getByRole("cell").nth(5)).toHaveText(/^\d{4}\. \d{2}\. \d{2}\. \d{2}:\d{2}$/);

  // Sándor Ákos lost his pair in step 14 and has none since.
  const akos = WAITING_SOLOS[1];
  // Lowercase and without the accent: the search folds both (search.ts).
  await visit(page, `/admin/users?q=akos`);
  await expect(page.getByRole("row").filter({ hasText: akos.name })).toContainText("Nincs párja");
  await context.close();
});

test("Jelentkezők: whether each person registered, and their pair", async ({ browser }) => {
  const { torok } = LONE;
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, `/admin/signups?q=${encodeURIComponent(torok.name)}`);
  const row = page.getByRole("row").filter({ hasText: torok.name });
  // Török Hanna registered and is paired with Pál Boglárka (step 14); her
  // signup partner never registered.
  await expect(row).toContainText("Regisztrált");
  await expect(row).toContainText(`Pár: ${WAITING_SOLOS[0].name}`);
  await expect(row).toContainText("Nincs fiókja");
  await context.close();
});

test("Párok and Párkeresők: entries and pairs made elsewhere, no contact details", async ({ browser }) => {
  const [boglarka, akos] = WAITING_SOLOS;
  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta/pairs");
  await expect(page.getByRole("row").filter({ hasText: PAIRS.p1[0].name }).filter({ hasText: PAIRS.p1[1].name })).toContainText(ENTERED);

  // The solos paired in step 13 split in step 14: the page says so.
  await visit(page, "/admin/leagues/minta/solos");
  const pair = page.getByRole("row").filter({ hasText: boglarka.name });
  await expect(pair).toContainText(`Pár: ${LONE.torok.name}`);
  await expect(pair).toContainText("Nincs párja");
  await expect(pair).toContainText(akos.name);
  await expect(content(page)).not.toContainText("@example.test");
  await expect(content(page)).not.toContainText("+36");
  await context.close();
});

test("Jelentkezők: Hol tartanak, people per stage, and the stage filter", async ({ browser }) => {
  const anna = PAIRS.p1[0];
  const akos = WAITING_SOLOS[1];
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/admin/signups");
  const stages = page.getByRole("region", { name: "Hol tartanak" });
  await expect(stages.getByRole("link", { name: /^Nem kapott meghívót: \d+$/ })).toBeVisible();

  await stages.getByRole("link", { name: /^Regisztrált, nincs párja: [1-9]\d*$/ }).click();
  await expect(page).toHaveURL(/stage=no_pair/);
  // His own signup, and the solo it was paired with ("Párja: …").
  await expect(page.getByRole("row").filter({ hasText: akos.name }).first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: anna.name })).toHaveCount(0);
  // The mail goes to the people at the stage: not sent here, only the list.
  await page.getByRole("link", { name: "Levél nekik" }).click();
  await expect(page).toHaveURL(/\/admin\/broadcasts\/new\?stage=no_pair/);
  await expect(content(page)).toContainText("Regisztrált, nincs párja");
  await expect(content(page)).toContainText(akos.name);
  await expect(content(page)).not.toContainText(anna.name);
  await page.goBack();

  await stages.getByRole("link", { name: /^Nevezett: / }).click();
  await expect(page).toHaveURL(/stage=entered/);
  await expect(page.getByRole("row").filter({ hasText: anna.name }).first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: akos.name })).toHaveCount(0);
  await context.close();
});
