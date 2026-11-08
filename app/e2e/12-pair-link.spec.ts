// Walkthrough step 16: a player without a pair sends their own pair link
// (2026-10-31). The partner opens it logged out, registers on /register,
// finishes the first-login page, comes back to the link and accepts: the
// pair is made, with no email. Runs after step 15, whose new player sends it.
import { expect, test } from "@playwright/test";

import { as, content, d1, logOffset, loginCode, visit } from "./support";

const OWNER = "uj.jatekos@example.test";
const PARTNER = { name: "Link Partner", email: "link.partner@example.test" };

test("16. a new player invites a partner with their pair link", async ({ browser }) => {
  const owner = await as(browser, OWNER);
  await visit(owner.page, "/home");
  await expect(content(owner.page).getByText("Hívd meg a párodat")).toBeVisible();
  const url = await content(owner.page).getByLabel("A meghívó linked").inputValue();
  expect(url).toMatch(/\/pair\/join\/[A-Za-z0-9_-]{24}$/);
  // The same link in Párod, and again on the next visit.
  await visit(owner.page, "/profile");
  await expect(content(owner.page).getByLabel("A meghívó linked")).toHaveValue(url);
  // The own link can't be accepted.
  await visit(owner.page, new URL(url).pathname);
  await expect(owner.page.getByRole("alert")).toContainText("Ez a saját linked.");
  const emailsBefore = d1("select count(*) as n from email_messages where kind != 'login_code'");

  // The partner, logged out: who invites, never their email.
  const context = await browser.newContext();
  const page = await context.newPage();
  await visit(page, new URL(url).pathname);
  await expect(page.getByRole("heading", { name: "Meghívás párnak" })).toBeVisible();
  await expect(page.getByText("Új Játékos meghívott, hogy legyél a párja.")).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(OWNER);
  await page.getByRole("link", { name: "Regisztrálok" }).click();

  // /register: the login flow with its own words.
  await expect(page).toHaveURL(/\/register\?returnTo=/);
  await expect(page.getByRole("heading", { name: "Regisztráció" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Belépés", exact: true }).last()).toHaveAttribute("href", /^\/login\?returnTo=/);
  await page.getByLabel("E-mail-cím").fill(PARTNER.email);
  const offset = logOffset();
  await page.getByRole("button", { name: "Kódot kérek" }).click();
  await page.getByLabel("Belépőkód").fill(await loginCode(PARTNER.email, offset));
  await page.getByRole("button", { name: "Tovább" }).click();

  // First-login page, then back to the link.
  await expect(page).toHaveURL(/\/welcome\?returnTo=/);
  await page.getByLabel("Neved").fill(PARTNER.name);
  await page.getByLabel("Szinted").click();
  await page.getByRole("option", { name: /^Középhaladó/ }).click();
  await page.getByLabel("Telefonszám").fill("+36 30 765 1111");
  await page.getByLabel("Nő", { exact: true }).click();
  await page.getByLabel(/hozzájárulok/).check();
  await page.getByRole("button", { name: "Kész" }).click();
  await expect(page).toHaveURL(/\/pair\/join\//);
  await page.getByRole("button", { name: "Elfogadom" }).click();

  await expect(page).toHaveURL(/\/profile\?joined=1#parod$/);
  await expect(page.getByRole("status")).toContainText("Mostantól párban vagytok.");
  await expect(content(page)).toContainText("Új Játékos");
  await expect(content(page)).not.toContainText("Hívd meg a párodat");
  await context.close();

  expect(d1(`select p.source, p.status from pairs p join users a on a.id = p.player_a join users b on b.id = p.player_b
    where a.email = '${OWNER}' and b.email = '${PARTNER.email}'`)).toEqual([{ source: "link", status: "active" }]);
  // No email for the link or the pair.
  expect(d1("select count(*) as n from email_messages where kind != 'login_code'")).toEqual(emailsBefore);

  // The owner sees the partner; the link box is gone, the link refuses.
  await visit(owner.page, "/profile");
  await expect(content(owner.page)).toContainText(PARTNER.name);
  await expect(content(owner.page)).not.toContainText("Hívd meg a párodat");
  await visit(owner.page, "/home");
  await expect(content(owner.page)).not.toContainText("Hívd meg a párodat");
  await owner.context.close();
});
