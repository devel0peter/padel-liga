// "Párt keresek" (D59): two new players without a signup switch it on, one on
// Párom and one on Kezdőlap; the Szervező finds both on Párkeresők and pairs
// them at once, with a message in the app and an email (#260). The pair shows
// in Összehozott párok until it is dissolved on Párok (#297). Runs after the
// admin status spec, so its counts stay as they were.
import { expect, test, type Browser, type Page } from "@playwright/test";

import { ORGANIZER, as, content, d1, logIn, save, visit } from "./support";

const KATA = { name: "Kereső Kata", email: "kereso.kata@example.test" };
const KRISTOF = { name: "Kereső Kristóf", email: "kereso.kristof@example.test" };

// Párkeresők' header: "… N párt hoztál össze".
async function madeCount(page: Page): Promise<number> {
  const text = (await content(page).textContent()) ?? "";
  return Number(/(\d+) párt hoztál össze/.exec(text)![1]);
}

const madeRow = (page: Page) =>
  page
    .getByRole("region", { name: "Összehozott párok" })
    .getByRole("row")
    .filter({ hasText: KATA.name })
    .filter({ hasText: KRISTOF.name });

// A new account: the first-login page by hand, then /home, where it joins
// the league on "Melyik ligában játszol?" (D127, #331).
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

  // Kata on Párom: off by default (#333), then on.
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

  // The Szervező: both under Regisztráltak, with their phones to call (D126), no email address.
  const org = await as(browser, ORGANIZER.email);
  await visit(org.page, "/admin/leagues/minta/solos");
  const registered = org.page.getByRole("region", { name: "Regisztráltak", exact: true });
  await expect(registered).toContainText(KATA.name);
  await expect(registered).toContainText(KRISTOF.name);
  await expect(content(org.page)).not.toContainText("@example.test");
  await expect(registered.getByRole("row").filter({ hasText: KATA.name }).locator('a[href="tel:+36305551234"]')).toBeVisible();
  const made = await madeCount(org.page);
  await registered.getByRole("checkbox", { name: `${KATA.name} kijelölése` }).check();
  await registered.getByRole("checkbox", { name: `${KRISTOF.name} kijelölése` }).check();
  await registered.getByRole("button", { name: "Párba teszem (2/2)" }).click();
  await expect(org.page.getByRole("alertdialog")).toContainText("e-mailben is szólunk nekik");
  await org.page.getByRole("alertdialog").getByRole("button", { name: "Párba teszem" }).click();
  await expect(registered).not.toContainText(KATA.name);
  await expect(registered).not.toContainText(KRISTOF.name);
  // Listed in Összehozott párok and counted (#297); dissolved on Párok, not here.
  await expect(madeRow(org.page)).toHaveCount(1);
  await expect(content(org.page)).toContainText(`${made + 1} párt hoztál össze`);
  await expect(madeRow(org.page).getByRole("button", { name: "Szétválasztom" })).toHaveCount(0);
  await expect(content(org.page)).not.toContainText("@example.test");
  await expect(madeRow(org.page).locator('a[href="tel:+36305551234"]:visible')).toHaveCount(2);
  await madeRow(org.page).getByRole("link", { name: "A Párok oldalon bonthatod fel" }).click();
  await expect(org.page).toHaveURL(/\/admin\/leagues\/minta\/pairs$/);
  await org.context.close();

  expect(
    d1(`select p.source, p.status from pairs p join users a on a.id = p.player_a join users b on b.id = p.player_b
      where a.email = '${KATA.email}' and b.email = '${KRISTOF.email}'`),
  ).toEqual([{ source: "search", status: "active" }]);
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

  // Dissolved on Párok: gone from Összehozott párok, the count back down,
  // and both are back under Regisztráltak (#297).
  const again = await as(browser, ORGANIZER.email);
  await visit(again.page, "/admin/leagues/minta/pairs");
  const pairRow = content(again.page).getByRole("row").filter({ hasText: KATA.name }).filter({ hasText: KRISTOF.name });
  await expect(pairRow).toContainText("Párkeresők");
  await pairRow.getByRole("button", { name: "Felbontás" }).click();
  await again.page.getByRole("alertdialog").getByRole("button", { name: "Felbontás" }).click();
  await expect(pairRow).toContainText("Felbontva");
  await visit(again.page, "/admin/leagues/minta/solos");
  await expect(content(again.page)).toContainText(`${made} párt hoztál össze`);
  await expect(madeRow(again.page)).toHaveCount(0);
  await expect(again.page.getByRole("region", { name: "Regisztráltak", exact: true })).toContainText(KATA.name);
  await again.context.close();
});
