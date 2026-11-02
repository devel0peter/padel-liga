// Walkthrough steps 1 and 2: the Admin logs in and checks the setup pages.
import { expect, test } from "@playwright/test";

import { ADMIN, as } from "./support";

test("1. the Admin lands on Kezdőlap with the season card and both sidebar sections", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Kezdőlap" })).toBeVisible();
  const card = page.locator("[data-slot=card]", { hasText: "Teszt szezon" });
  await expect(card).toContainText("Padelpárbaj Mintaváros");
  await expect(card).toContainText("Nevezés:");
  await expect(card).toContainText("Szezon vége:");
  await expect(card).toContainText("Nevezni párban lehet, és még nincs párod.");
  await expect(card.getByRole("link", { name: "Párom" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nevezünk" })).toHaveCount(0);

  const sidebar = page.locator("[data-sidebar=sidebar]");
  await expect(sidebar).toContainText("Platform");
  await expect(sidebar).toContainText("Admin");
  await expect(sidebar).toContainText("Padelpárbaj Mintaváros");
  for (const link of ["Áttekintés", "Szezonok", "Párkeresők", "Emlékeztetők", "Klubok"])
    await expect(sidebar.getByRole("link", { name: link })).toBeVisible();
  await context.close();
});

test("2. the setup pages show the seeded city, league, clubs and season", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);

  await page.goto("/admin/cities");
  // City names are editable fields here.
  await expect(page.locator("input[value='Mintaváros']")).toBeVisible();

  await page.goto("/admin/leagues");
  await expect(page.getByRole("main").first()).toContainText("Padelpárbaj Mintaváros");
  await expect(page.getByRole("main").first()).toContainText("Teszt Szervező");

  await page.goto("/admin/leagues/minta/clubs");
  for (const club of ["Minta Padel Aréna", "Teszt Sportcentrum", "Példa Padel Club"])
    await expect(page.getByRole("main").first()).toContainText(club);
  // Deactivate instead of delete (#19), then back on.
  await page.getByRole("button", { name: "Inaktiválás" }).first().click();
  await expect(page.getByRole("button", { name: "Aktiválás", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Aktiválás", exact: true }).click();
  await expect(page.getByRole("button", { name: "Aktiválás", exact: true })).toHaveCount(0);

  await page.goto("/admin/leagues/minta/seasons");
  await expect(page.getByRole("main").first()).toContainText("Teszt szezon");
  await expect(page.getByRole("link", { name: "0 nevezett" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Csoportok" })).toBeVisible();
  // A season can only start on a Monday.
  await page.getByLabel("Név").fill("Keddi szezon");
  await page.getByLabel("Nevezés kezdete").fill("2027-01-01");
  await page.getByLabel("Nevezés vége").fill("2027-01-10");
  await page.getByLabel("Első kör hétfője").fill("2027-01-12");
  await page.getByRole("button", { name: "Létrehozás" }).click();
  await expect(page.getByText("Az első kör csak hétfőn kezdődhet.")).toBeVisible();
  await context.close();

  // The privacy page needs no login.
  const anon = await browser.newPage();
  await anon.goto("/privacy");
  await expect(anon).toHaveURL(/\/privacy$/);
  await expect(anon.getByRole("heading", { level: 1 })).toBeVisible();
  await anon.close();
});
