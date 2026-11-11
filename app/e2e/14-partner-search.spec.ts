// "Párt keresek" (D59): two new players without a signup switch it on, one on
// Párod and one on Kezdőlap; the Szervező finds both on Játékosok ("Párt
// keres", #301) and pairs them at once, with a message in the app and an
// email (#260). Dissolved on Párok, both are back under "Párt keres". Runs
// after the admin status spec, so its counts stay as they were.
import { expect, test, type Browser } from "@playwright/test";

import { ORGANIZER, SEEKERS, as, content, d1, logIn, playersTable, save, visit } from "./support";

const KATA = { name: "Kereső Kata", email: "kereso.kata@example.test" };
const KRISTOF = { name: "Kereső Kristóf", email: "kereso.kristof@example.test" };

// A new account: the first-login page by hand, then /home, where it joins
// the league on "Melyik ligában játszol?" (D128, #331).
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
  await content(page).getByRole("button", { name: "Csatlakozom" }).click();
  await expect(content(page)).not.toContainText("Melyik ligában játszol?");
  await save(context, who.email);
  return { context, page };
}

test("Párt keresek: switched on by the player, paired by the Szervező", async ({ browser }) => {
  const OTHER = "select count(*) as n from email_messages where kind not in ('login_code', 'pair_created')";
  const emailsBefore = d1(OTHER);
  const lastBefore = d1("select max(id) as id from email_messages")[0].id ?? 0;

  // Kata in Párod: off by default (#333), then on.
  const kata = await newPlayer(browser, KATA);
  await visit(kata.page, "/profile");
  const kataSwitch = content(kata.page).getByRole("switch", { name: "Párt keresek" });
  await expect(kataSwitch).not.toBeChecked();
  await kataSwitch.click();
  await expect(content(kata.page)).toContainText("A szervező látja, hogy párt keresel");
  await visit(kata.page, "/profile");
  await expect(content(kata.page).getByRole("switch", { name: "Párt keresek" })).toBeChecked();
  await kata.context.close();

  // Kristóf straight on Kezdőlap.
  const kristof = await newPlayer(browser, KRISTOF);
  await content(kristof.page).getByRole("switch", { name: "Párt keresek" }).click();
  await expect(content(kristof.page)).toContainText("A szervező látja, hogy párt keresel");
  await kristof.context.close();

  // The Szervező: both under "Párt keres" on Játékosok (#301), with their
  // phones to call (D126), no email address.
  const org = await as(browser, ORGANIZER.email);
  await visit(org.page, SEEKERS);
  const seekers = playersTable(org.page);
  await expect(seekers).toContainText(KATA.name);
  await expect(seekers).toContainText(KRISTOF.name);
  await expect(content(org.page)).not.toContainText("@example.test");
  await expect(seekers.getByRole("row").filter({ hasText: KATA.name }).locator('a[href="tel:+36305551234"]')).toBeVisible();
  await org.page.getByRole("checkbox", { name: `${KATA.name} kijelölése` }).check();
  await org.page.getByRole("checkbox", { name: `${KRISTOF.name} kijelölése` }).check();
  await content(org.page).getByRole("button", { name: "Párba teszem (2/2)" }).click();
  await expect(org.page.getByRole("alertdialog")).toContainText("e-mailben is szólunk nekik");
  await org.page.getByRole("alertdialog").getByRole("button", { name: "Párba teszem" }).click();
  await expect(org.page.getByRole("checkbox", { name: `${KATA.name} kijelölése` })).toHaveCount(0);
  await expect(content(org.page)).not.toContainText(KRISTOF.name);
  // On Párok, from "párkeresésből" (D113); dissolved there.
  await visit(org.page, "/admin/leagues/minta/pairs");
  const made = content(org.page).getByRole("row").filter({ hasText: KATA.name }).filter({ hasText: KRISTOF.name });
  await expect(made).toContainText("párkeresésből");
  await expect(made.locator('a[href="tel:+36305551234"]:visible')).toHaveCount(2);
  await expect(content(org.page)).not.toContainText("@example.test");
  await org.context.close();

  expect(
    d1(`select p.source, p.status from pairs p join users a on a.id = p.player_a join users b on b.id = p.player_b
      where a.email = '${KATA.email}' and b.email = '${KRISTOF.email}'`),
  ).toEqual([{ source: "search", status: "active" }]);
  // One email each (#260), nothing else; a message in the app, and Párod
  // shows the partner.
  const pairMails = d1(`select lower(to_email) as to_email from email_messages where kind = 'pair_created' and id > ${lastBefore}`);
  expect(pairMails.map((r) => r.to_email).sort()).toEqual([KATA.email, KRISTOF.email].map((e) => e.toLowerCase()).sort());
  expect(d1(OTHER)).toEqual(emailsBefore);
  const back = await as(browser, KATA.email);
  await visit(back.page, "/profile");
  await expect(content(back.page)).toContainText(KRISTOF.name);
  await expect(content(back.page).getByRole("switch", { name: "Párt keresek" })).toHaveCount(0);
  await visit(back.page, "/notifications");
  await expect(content(back.page)).toContainText("Párt találtunk neked");
  await back.context.close();

  // Dissolved on Párok: both are back under "Párt keres" (#297, #301).
  const again = await as(browser, ORGANIZER.email);
  await visit(again.page, "/admin/leagues/minta/pairs");
  const pairRow = content(again.page).getByRole("row").filter({ hasText: KATA.name }).filter({ hasText: KRISTOF.name });
  await expect(pairRow).toContainText("párkeresésből");
  await pairRow.getByRole("button", { name: "Felbontás" }).click();
  await again.page.getByRole("alertdialog").getByRole("button", { name: "Felbontás" }).click();
  await expect(pairRow).toContainText("Felbontva");
  await visit(again.page, SEEKERS);
  await expect(playersTable(again.page)).toContainText(KATA.name);
  await expect(playersTable(again.page)).toContainText(KRISTOF.name);
  await again.context.close();
});
