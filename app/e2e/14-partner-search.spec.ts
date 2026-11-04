// "Párt keresek" (D59): two new players without a signup switch it on, one on
// Párom and one on Kezdőlap; the Szervező finds both on Párkeresők and pairs
// them at once, with a message in the app and no email. Runs after the
// admin status spec, so its counts stay as they were.
import { expect, test, type Browser } from "@playwright/test";

import { ORGANIZER, as, content, d1, logIn, save, visit } from "./support";

const KATA = { name: "Kereső Kata", email: "kereso.kata@example.test" };
const KRISTOF = { name: "Kereső Kristóf", email: "kereso.kristof@example.test" };

// A new account with no signup: the first-login page by hand, then /home.
async function newPlayer(browser: Browser, who: { name: string; email: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page, who.email);
  await expect(page).toHaveURL(/\/welcome/);
  await page.getByLabel("Neved").fill(who.name);
  await page.getByLabel("Szinted").click();
  await page.getByRole("option", { name: /^Középhaladó/ }).click();
  await page.getByLabel("Telefonszám").fill("+36 30 555 1234");
  await page.getByLabel("Nő", { exact: true }).click();
  await page.getByLabel(/hozzájárulok/).check();
  await page.getByRole("button", { name: "Kész" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await save(context, who.email);
  return { context, page };
}

test("Párt keresek: switched on by the player, paired by the Szervező", async ({ browser }) => {
  const OTHER = "select count(*) as n from email_messages where kind not in ('login_code', 'pair_created')";
  const emailsBefore = d1(OTHER);
  const lastBefore = d1("select max(id) as id from email_messages")[0].id ?? 0;

  // Kata on Párom: off by default (no solo signup), then on.
  const kata = await newPlayer(browser, KATA);
  await visit(kata.page, "/pair");
  const kataSwitch = content(kata.page).getByRole("switch", { name: "Párt keresek" });
  await expect(kataSwitch).not.toBeChecked();
  await kataSwitch.click();
  await expect(content(kata.page)).toContainText("A szervező látja, hogy párt keresel");
  await visit(kata.page, "/pair");
  await expect(content(kata.page).getByRole("switch", { name: "Párt keresek" })).toBeChecked();
  await kata.context.close();

  // Kristóf straight on Kezdőlap.
  const kristof = await newPlayer(browser, KRISTOF);
  await content(kristof.page).getByRole("switch", { name: "Párt keresek" }).click();
  await expect(content(kristof.page)).toContainText("A szervező látja, hogy párt keresel");
  await kristof.context.close();

  // The Szervező: both under Regisztráltak, no contact details.
  const org = await as(browser, ORGANIZER.email);
  await visit(org.page, "/admin/leagues/minta/solos");
  const registered = org.page.getByRole("region", { name: "Regisztráltak", exact: true });
  await expect(registered).toContainText(KATA.name);
  await expect(registered).toContainText(KRISTOF.name);
  await expect(content(org.page)).not.toContainText("@example.test");
  await expect(content(org.page)).not.toContainText("+36");
  await registered.getByRole("checkbox", { name: `${KATA.name} kijelölése` }).check();
  await registered.getByRole("checkbox", { name: `${KRISTOF.name} kijelölése` }).check();
  await registered.getByRole("button", { name: "Párba teszem (2/2)" }).click();
  await expect(org.page.getByRole("alertdialog")).toContainText("e-mailben is szólunk nekik");
  await org.page.getByRole("alertdialog").getByRole("button", { name: "Párba teszem" }).click();
  await expect(registered).not.toContainText(KATA.name);
  await expect(registered).not.toContainText(KRISTOF.name);
  await org.context.close();

  expect(
    d1(`select p.source, p.status from pairs p join users a on a.id = p.player_a join users b on b.id = p.player_b
      where a.email = '${KATA.email}' and b.email = '${KRISTOF.email}'`),
  ).toEqual([{ source: "manual", status: "active" }]);
  // One email each (#260), nothing else; a message in the app, and Párom
  // shows the partner.
  const pairMails = d1(`select lower(to_email) as to_email from email_messages where kind = 'pair_created' and id > ${lastBefore}`);
  expect(pairMails.map((r) => r.to_email).sort()).toEqual([KATA.email, KRISTOF.email].map((e) => e.toLowerCase()).sort());
  expect(d1(OTHER)).toEqual(emailsBefore);
  const back = await as(browser, KATA.email);
  await visit(back.page, "/pair");
  await expect(content(back.page)).toContainText(KRISTOF.name);
  await expect(content(back.page).getByRole("switch", { name: "Párt keresek" })).toHaveCount(0);
  await visit(back.page, "/notifications");
  await expect(content(back.page)).toContainText("Párt találtunk neked");
  await back.context.close();
});
