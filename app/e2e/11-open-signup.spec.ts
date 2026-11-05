// Walkthrough step 15: anyone can create an account (#113). An address with
// no invite and no signup logs in, finishes the first-login page and sees on
// Párom their own pair link, and that the organizer pairs those with nobody. Runs last: the new player has no pair,
// so the earlier steps' lists stay as they were.
import { expect, test } from "@playwright/test";

import { content, d1, d1Insert, emailsSince, logIn, logOffset, save, visit } from "./support";

const NEW_PLAYER = { name: "Új Játékos", email: "uj.jatekos@example.test" };

test("15. a new player without an invite or a signup registers", async ({ browser }) => {
  // Nobody invited or signed up this address.
  expect(d1(`select count(*) as n from account_invites where email = '${NEW_PLAYER.email}'`)).toEqual([{ n: 0 }]);
  expect(d1(`select count(*) as n from interest_signups where email1 = '${NEW_PLAYER.email}' or email2 = '${NEW_PLAYER.email}'`)).toEqual([{ n: 0 }]);

  const context = await browser.newContext();
  const page = await context.newPage();

  await logIn(page, NEW_PLAYER.email);
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole("heading", { name: "Üdv!" })).toBeVisible();
  // No signup: no partner named, nothing prefilled (#130).
  await expect(content(page)).not.toContainText("A párod:");
  await expect(content(page)).not.toContainText("A jelentkezésedből");
  await expect(page.getByLabel("Neved")).toHaveValue("");
  await page.getByLabel("Neved").fill(NEW_PLAYER.name);
  await expect(page.getByLabel("Szinted")).toContainText("Válassz…");
  await page.getByLabel("Szinted").click();
  await page.getByRole("option", { name: /^Középhaladó/ }).click();
  await page.getByLabel("Telefonszám").fill("+36 30 765 4321");
  await page.getByLabel(/hozzájárulok/).check();
  // Férfi or Nő is required (#133): without it the page stays.
  await page.getByRole("button", { name: "Kész" }).click();
  await expect(page.getByText("Válaszd ki: férfi vagy nő.")).toBeVisible();
  await page.getByLabel("Férfi", { exact: true }).click();
  await page.getByRole("button", { name: "Kész" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await save(context, NEW_PLAYER.email);

  // Straight after the first-login page: the own pair link (2026-10-31).
  await expect(content(page).getByText("Hívd meg a párodat")).toBeVisible();
  await visit(page, "/pair");
  await expect(content(page).getByText("Hívd meg a párodat")).toBeVisible();
  await expect(content(page)).toContainText("a szervező keres neked párt.");
  // The contact address once, and no "if it changes" line without a pair (#124).
  await expect(content(page).getByRole("link", { name: "hello@padelparbaj.hu" })).toHaveAttribute("href", "mailto:hello@padelparbaj.hu");
  await expect(content(page).getByText("hello@padelparbaj.hu")).toHaveCount(1);
  await expect(content(page)).not.toContainText("Ha változna");
  await context.close();
});

// #123: a new address that bounced before gets no code, yet the code step
// says the same as for any other address and names the other ways in: the
// contact address (and Google login, which the suite has not set up).
test("15. the code step names the contact address, also when no code goes out", async ({ page }) => {
  const bounced = "visszapattant@example.test";
  d1Insert(`insert into email_suppressions (email, reason) values ('${bounced}', 'bounced')`);
  const offset = logOffset();
  await visit(page, `/login?email=${encodeURIComponent(bounced)}`);
  await page.getByRole("button", { name: "Kódot kérek" }).click();
  await expect(page.getByRole("heading", { name: "Nézd meg a leveleidet" })).toBeVisible();
  await expect(content(page)).toContainText(`Küldtünk egy 6 jegyű kódot ide: ${bounced}.`);
  await expect(content(page)).toContainText(
    "Nem jött meg? Nézd meg a spam mappát is, adj meg másik címet, vagy írj nekünk: hello@padelparbaj.hu.",
  );
  await expect(content(page).getByRole("link", { name: "hello@padelparbaj.hu" })).toHaveAttribute("href", "mailto:hello@padelparbaj.hu");
  await expect(content(page).getByRole("link", { name: /Google/ })).toHaveCount(0);
  expect(emailsSince(offset).filter((e) => e.to === bounced)).toEqual([]);
});
