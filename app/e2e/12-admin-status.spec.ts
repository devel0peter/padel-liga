// The admin tables show where each player stands at a glance: account,
// what's missing, pair and entry; the Admin also sees the last login. Runs
// after the walkthrough, on the state it left (nothing here changes it).
import { expect, test } from "@playwright/test";

import { ADMIN, LONE, ORGANIZER, PAIRS, WAITING_SOLOS, as, content, visit } from "./support";

const ENTERED = /Nevezés \(.+\): Jóváhagyva/;

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

  // The player from step 15 has no pair yet.
  // (Searched without the "Ú": SQLite LIKE ignores case for ASCII only.)
  await visit(page, `/admin/users?q=${encodeURIComponent("Játékos")}`);
  await expect(page.getByRole("row").filter({ hasText: "Új Játékos" })).toContainText("Nincs párja");
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
