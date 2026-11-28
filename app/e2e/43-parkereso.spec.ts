// Walkthrough step 42, Párkereső (#398, D177): three new Mintaváros players without a partner.
// Pál opens it from Kezdőlap and switches it on with "Bekapcsolom a
// párkeresést"; Panni sees him without contact data until she switches it on
// too, then both see each other's phone and email. Petra's switch is made
// "from before" (organizer-only): the others don't see her until she
// switches it on again. Panni accepts Pál's pair link: both see "Neked már
// van párod." and drop off Petra's list. A paired player, another league's
// player and a logged-out visitor can't see the list. No email.
import { expect, test, type Page } from "@playwright/test";

import { OUTSIDER, PAIRS, as, content, d1, d1Update, visit, type Player } from "./support";

const PAL: Player = { name: "Párkereső Pál", email: "parkereso.pal@example.test", level: "kozephalado" };
const PANNI: Player = { name: "Párkereső Panni", email: "parkereso.panni@example.test", level: "kezdo" };
const PETRA: Player = { name: "Párkereső Petra", email: "parkereso.petra@example.test", level: "halado" };

const finder = (page: Page) => content(page).getByRole("region", { name: "Párkereső" });
const seekers = (page: Page) => finder(page).getByRole("list", { name: "Párt keresnek" });
const row = (page: Page, who: Player) => seekers(page).getByRole("listitem").filter({ hasText: who.name });

test("Párkereső: seekers see each other with phone and email, a single without them, old switches stay hidden", async ({ browser }) => {
  const mailsBefore = d1("select count(*) as n from email_messages where kind <> 'login_code'");

  // Pál: Kezdőlap's "Párt keresek" box links to the league's Párkereső.
  const pal = await as(browser, PAL);
  await visit(pal.page, "/home");
  await content(pal.page).getByRole("link", { name: "Nézd meg a Párkeresőt" }).click();
  await expect(pal.page).toHaveURL(/\/leagues\/minta#parkereso$/);
  await expect(finder(pal.page)).toBeVisible();
  // His own pair link, the same as on Kezdőlap.
  await expect(finder(pal.page).getByRole("heading", { name: "Hívd meg a párodat" })).toBeVisible();
  await expect(finder(pal.page).getByLabel("A meghívó linked")).toHaveValue(/\/pair\/join\/[\w-]+$/);
  await finder(pal.page).getByRole("button", { name: "Bekapcsolom a párkeresést" }).click();
  await expect(finder(pal.page).getByRole("switch", { name: "Párt keresek" })).toBeChecked();
  await expect(finder(pal.page)).toContainText("Bekapcsolva: a szervező és a liga többi párkeresője látja");

  // Panni, switch off: Pál is listed, without phone or email.
  const panni = await as(browser, PANNI);
  await visit(panni.page, "/leagues/minta");
  await expect(row(panni.page, PAL)).toContainText("Középhaladó");
  await expect(row(panni.page, PAL)).toContainText("ma óta keres");
  await expect(finder(panni.page)).not.toContainText("@");
  await expect(finder(panni.page).locator('a[href^="tel:"], a[href^="sms:"], a[href^="mailto:"]')).toHaveCount(0);
  await expect(finder(panni.page)).toContainText("Az elérhetőségüket akkor látod, ha te is bekapcsolod a párkeresést");
  await finder(panni.page).getByRole("button", { name: "Bekapcsolom a párkeresést" }).click();
  await expect(finder(panni.page).getByRole("switch", { name: "Párt keresek" })).toBeChecked();
  // Now mutual: tap to call, SMS or write.
  await expect(row(panni.page, PAL).locator('a[href="tel:+36301234567"]')).toBeVisible();
  await expect(row(panni.page, PAL).locator('a[href="sms:+36301234567"]')).toBeVisible();
  await expect(row(panni.page, PAL).locator(`a[href="mailto:${PAL.email}"]`)).toBeVisible();
  await visit(pal.page, "/leagues/minta");
  await expect(row(pal.page, PANNI).locator(`a[href="mailto:${PANNI.email}"]`)).toBeVisible();
  // Nobody sees themselves.
  await expect(row(pal.page, PAL)).toHaveCount(0);

  // On a phone: no sideways scrolling.
  await panni.page.setViewportSize({ width: 390, height: 844 });
  await visit(panni.page, "/leagues/minta");
  await expect(row(panni.page, PAL)).toBeVisible();
  expect(await panni.page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth")).toBeLessThanOrEqual(0);
  await panni.page.setViewportSize({ width: 1280, height: 800 });

  // Petra switches it on in Profil, then her row is made one from before
  // (#398 requirement 8): not listed, so Pál doesn't see her.
  const petra = await as(browser, PETRA);
  await visit(petra.page, "/profile");
  await content(petra.page).getByRole("switch", { name: "Párt keresek" }).click();
  await expect(content(petra.page)).toContainText("Bekapcsolva:");
  d1Update(`update partner_searches set listed = 0 where user_id = (select id from users where email = '${PETRA.email}')`);
  await visit(pal.page, "/leagues/minta");
  await expect(row(pal.page, PANNI)).toBeVisible();
  await expect(row(pal.page, PETRA)).toHaveCount(0);
  // Profil tells her, and the button lists her.
  await visit(petra.page, "/profile");
  await expect(content(petra.page)).toContainText("Most csak a szervező látja, hogy párt keresel.");
  await content(petra.page).getByRole("button", { name: "Bekapcsolom a párkeresést" }).click();
  await expect(content(petra.page)).toContainText("Bekapcsolva:");
  await visit(pal.page, "/leagues/minta");
  await expect(row(pal.page, PETRA).locator(`a[href="mailto:${PETRA.email}"]`)).toBeVisible();

  // Panni accepts Pál's pair link: both have a pair, and Petra doesn't see them any more.
  const link = await finder(pal.page).getByLabel("A meghívó linked").inputValue();
  await visit(panni.page, new URL(link).pathname);
  await panni.page.getByRole("button", { name: "Elfogadom" }).click();
  await expect(panni.page).toHaveURL(/\/profile\?joined=1#parod$/);
  for (const page of [pal.page, panni.page]) {
    await visit(page, "/leagues/minta");
    // With a pair the card has no Párkereső (#423).
    await expect(finder(page)).toHaveCount(0);
    await expect(seekers(page)).toHaveCount(0);
  }
  await visit(petra.page, "/leagues/minta");
  await expect(finder(petra.page)).toBeVisible();
  await expect(finder(petra.page)).not.toContainText(PAL.name);
  await expect(finder(petra.page)).not.toContainText(PANNI.name);

  await Promise.all([pal.context.close(), panni.context.close(), petra.context.close()]);
  // The app sends nothing.
  expect(d1("select count(*) as n from email_messages where kind <> 'login_code'")).toEqual(mailsBefore);
});

test("Párkereső: a paired player, another league's player and a logged-out visitor can't see the list", async ({ browser }) => {
  const anna = await as(browser, PAIRS.p1[0]);
  await visit(anna.page, "/leagues/minta");
  await expect(finder(anna.page)).toHaveCount(0);
  await expect(seekers(anna.page)).toHaveCount(0);
  await anna.context.close();

  const other = await as(browser, OUTSIDER.email);
  const response = await other.page.goto("/leagues/minta");
  expect(response?.status()).toBe(404);
  await expect(other.page.getByText(PETRA.name)).toHaveCount(0);
  await other.context.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/leagues/minta");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(PETRA.name)).toHaveCount(0);
  await context.close();
});
