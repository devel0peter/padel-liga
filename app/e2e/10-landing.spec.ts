// The public landing page (#83): a league city's league is in the hero with
// the way to registration; other cities leave their contact details. The
// seed's season has registration open and round 1 about two weeks out.
import { expect, test } from "@playwright/test";

import { ADMIN, as, visit } from "./support";

test("the hero shows a league city's league and leads to registration", async ({ browser }) => {
  const page = await browser.newPage();
  await visit(page, "/");
  // No city to pick: the league card is right under the headline.
  const league = page.getByRole("region", { name: /Mintaváros: a liga állása/ });
  await expect(league).toContainText("Nyitva a nevezés");
  await expect(league).toContainText("Nevezés zárul");
  await expect(league).toContainText("23:59");
  // 06-groups published round 1's groups, so a pair entering now joins round 2
  // (the Szervező's approval does the same, joinsPhase).
  await expect(league).toContainText("Nevezz most, és a 2. körtől játszotok");
  // The chip says the same in short.
  await expect(page.getByRole("link", { name: /Mintaváros · nevezés nyitva/ })).toBeVisible();
  // The FAQ answer is only in the page while its item is open.
  await page.getByRole("button", { name: "Mikor csatlakozhatok?" }).click();
  await expect(page.getByText("Ahol már fut a liga, nevezhetsz rögtön")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/12 pár|elég pár/);

  await league.getByRole("link", { name: "Nevezek a 2. körre" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("heading", { name: "Regisztráció" })).toBeVisible();
  await page.close();
});

test("a league city typed in the other-city form leads to registration, not a signup", async ({ browser }) => {
  const page = await browser.newPage();
  await visit(page, "/");
  await page.locator("#cityOther").fill("mintavaros");
  await expect(page.getByRole("status")).toContainText("Mintaváros: itt már fut a liga");
  await expect(page.locator("#name1")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Regisztrálok és nevezek" })).toHaveAttribute("href", "/register");
  await page.close();
});

test("another city leaves contact details, and can offer to organize", async ({ browser }) => {
  const page = await browser.newPage();
  await visit(page, "/");
  // A listed city without a league (Győr in this database) fills the form in from its chip.
  await page.getByRole("link", { name: /^Győr · / }).click();
  await expect(page.locator("#cityOther")).toHaveValue("Győr");
  await page.getByRole("link", { name: "+ A te városod?" }).click();
  await expect(page.locator("#cityOther")).toHaveValue("");

  await page.locator("#cityOther").fill("Tesztfalva");
  await page.locator("#name1").fill("Landing Teszt");
  await page.locator("#email1").fill("landing.teszt@example.test");
  // No partner fields any more.
  await expect(page.locator("#name2")).toHaveCount(0);
  await page.locator("#level").click();
  await page.getByRole("option", { name: /^Haladó/ }).click();
  await page.locator("#organize").check();
  await page.locator("#consent").check();
  await page.getByRole("button", { name: "Szóljatok, ha indul" }).click();
  await expect(page.getByText(/Köszönjük! Felírtunk \(Tesztfalva\)/)).toBeVisible();
  await expect(page.getByText(/Köszönjük!/)).toContainText("szívesen szerveznél");

  const admin = await as(browser, ADMIN.email);
  await visit(admin.page, "/admin/signups");
  const row = admin.page.getByRole("row").filter({ hasText: "landing.teszt@example.test" });
  await expect(row).toContainText("Tesztfalva");
  await expect(row).toContainText("Szervezne ligát");
  await expect(row).not.toContainText("párt keres");
  await admin.context.close();
  await page.close();
});

test("Belépés is in the header of every public page; logged in it reads Saját oldalam", async ({ browser }) => {
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
    await expect(header.getByRole("link", { name: "Saját oldalam" })).toHaveAttribute("href", "/home");
    await expect(header.getByRole("link", { name: "Belépés" })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Kezdőlap" })).toHaveCount(0);
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

  // Logged in, the header button is longer ("Saját oldalam").
  const admin = await as(browser, ADMIN.email);
  await admin.page.setViewportSize({ width: 360, height: 740 });
  for (const path of ["/", "/rules", "/privacy"]) {
    await visit(admin.page, path);
    const wide = await admin.page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    expect(wide, `${path} is wider than the screen when logged in`).toBeLessThanOrEqual(0);
  }
  await admin.context.close();
});

// The poster (#120) no longer ties the start to a number of pairs.
test("the poster doesn't make the start depend on pairs", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/admin/poster");
  await expect(page.locator("article")).toContainText("Nevezz a pároddal, és már a következő körtől játszotok.");
  await expect(page.locator("article")).not.toContainText(/12 pár|összegyűlik/);
  await context.close();
});
