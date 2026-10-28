// The public landing page (#83): a league city shows where its league is and
// leads to registration; other cities keep the interest signup. The seed's
// season has registration open and round 1 about two weeks out.
import { expect, test } from "@playwright/test";

import { ADMIN, as, visit } from "./support";

test("a league city shows the league and leads to registration, not the interest form", async ({ browser }) => {
  const page = await browser.newPage();
  await visit(page, "/");
  // The suite's database lists Győr too, which has no league here.
  await page.locator("#city").click();
  await page.getByRole("option", { name: "Mintaváros" }).click();
  const league = page.getByRole("region", { name: /Mintaváros: a liga állása/ });
  await expect(league).toContainText("Nyitva a nevezés");
  await expect(league).toContainText("Nevezés zárul");
  await expect(league).toContainText("23:59");
  await expect(league).toContainText("Nevezz most, és az 1. körtől játszotok");
  // No interest form for this city, and no pair threshold anywhere.
  await expect(page.locator("#name1")).toHaveCount(0);
  // The FAQ answer is only in the page while its item is open.
  await page.getByRole("button", { name: "Mikor csatlakozhatok?" }).click();
  await expect(page.getByText("Ahol már fut a liga, nevezhetsz rögtön")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/12 pár|elég pár/);

  await page.getByRole("link", { name: "Tovább a nevezéshez" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.close();
});

test("Más város keeps the interest signup", async ({ browser }) => {
  const page = await browser.newPage();
  await visit(page, "/");
  await page.locator("#city").click();
  await page.getByRole("option", { name: "Más város" }).click();
  await expect(page.getByRole("region", { name: /a liga állása/ })).toHaveCount(0);
  await page.locator("#cityOther").fill("Tesztfalva");
  await page.locator("#name1").fill("Landing Teszt");
  await page.locator("#email1").fill("landing.teszt@example.test");
  await page.locator("#name2").fill("Landing Pár");
  await page.locator("#level").click();
  await page.getByRole("option", { name: /^Haladó/ }).click();
  await page.locator("#consent").check();
  await page.getByRole("button", { name: "Jelentkezem" }).last().click();
  await expect(page.getByText(/Köszönjük!/)).toBeVisible();
  await page.close();
});

test("Belépés is in the header of every public page; logged in it reads Kezdőlap", async ({ browser }) => {
  const anon = await browser.newPage();
  for (const path of ["/", "/rules", "/privacy"]) {
    await visit(anon, path);
    await expect(anon.getByRole("banner").getByRole("link", { name: "Belépés" })).toHaveAttribute("href", "/login");
  }
  await anon.close();

  const admin = await as(browser, ADMIN.email);
  for (const path of ["/", "/rules", "/privacy"]) {
    await visit(admin.page, path);
    const header = admin.page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Kezdőlap" })).toHaveAttribute("href", "/home");
    await expect(header.getByRole("link", { name: "Belépés" })).toHaveCount(0);
  }
  await admin.context.close();
});

test("the public pages do not scroll sideways at 360 px", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  for (const path of ["/", "/rules", "/privacy"]) {
    await visit(page, path);
    // A string, because the e2e project has no DOM types.
    const wide = await page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    expect(wide, `${path} is wider than the screen`).toBeLessThanOrEqual(0);
  }
  await context.close();
});
