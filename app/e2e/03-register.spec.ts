// Walkthrough steps 5 and 6: a player registers through the league's
// register button on the landing page and is the league's player at once
// (D128, #331); the partner accepts the pair link; the other pairs do the
// same, and the Szervező pairs two who look for a partner. Nothing comes from
// the interest list (#333).
import { expect, test } from "@playwright/test";

import { GROUP_PAIRS, PAIRS, as, content, d1, levelLabel, logOffset, loginCode, pairSeekers, pairUp, registerAll, save, seekPartner, visit } from "./support";

const [anna, bence] = PAIRS.p1;

test("5. a player registers through the league's register button", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await visit(page, "/");
  // The league card's button carries the league (D128).
  const league = page.getByRole("region", { name: /Mintaváros: a liga állása/ });
  await league.getByRole("link", { name: /^Nevezek/ }).click();
  await expect(page).toHaveURL(/\/register\?league=minta$/);
  await page.getByLabel("E-mail-cím").fill(anna.email);
  const offset = logOffset();
  await page.getByRole("button", { name: "Kódot kérek" }).click();
  await page.getByLabel("Belépőkód").fill(await loginCode(anna.email, offset));
  await page.getByRole("button", { name: "Tovább" }).click();
  await expect(page).toHaveURL(/\/welcome/);
  // She belongs to the league from the login on, before the first-login page
  // is done (so the "finish your registration" reminder knows it).
  expect(d1(`select l.slug, m.source from league_members m join leagues l on l.id = m.league_id join users u on u.id = m.user_id
    where u.email = '${anna.email}'`)).toEqual([{ slug: "minta", source: "register" }]);

  // Nothing prefilled (#333). Without the consent the form stays, with an error.
  await expect(page.getByLabel("Neved")).toHaveValue("");
  await page.getByLabel("Neved").fill(anna.name);
  await page.getByLabel("Szinted").click();
  await page.getByRole("option", { name: new RegExp(`^${levelLabel(anna)}`) }).click();
  await page.getByLabel("Telefonszám").fill("+36 30 123 4567");
  await page.getByLabel("Nő", { exact: true }).click();
  await page.getByRole("button", { name: "Kész" }).click();
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.locator("#consent-error")).not.toBeEmpty();

  await page.getByLabel(/hozzájárulok/).check();
  await page.getByRole("button", { name: "Kész" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await save(context, anna.email);
  // Kezdőlap: her league's season and her own pair link; no league to choose.
  await expect(content(page)).not.toContainText("Melyik ligában játszol?");
  await expect(content(page).getByText("Hívd meg a párodat")).toBeVisible();
  await expect(content(page)).toContainText("Teszt szezon");
  await visit(page, "/pair");
  await expect(content(page).getByLabel("A meghívó linked")).toBeVisible();
  await context.close();
});

test("6. the partner accepts the pair link, and the pair is there", async ({ browser }) => {
  await pairUp(browser, [anna, bence]);
  const second = await as(browser, bence);
  await visit(second.page, "/pair");
  await expect(content(second.page)).toContainText("A párod");
  await expect(content(second.page)).toContainText(anna.name);
  // The partner's address and phone, to reach each other (D121).
  const contact = second.page.getByRole("list", { name: "A párod elérhetősége" });
  await expect(contact.getByRole("link", { name: anna.email })).toHaveAttribute("href", `mailto:${anna.email}`);
  await expect(contact.getByRole("link", { name: "+36 30 123 4567" })).toHaveAttribute("href", "tel:+36301234567");
  const entry = second.page.locator("[data-slot=card]", { hasText: "Nevezés" });
  await expect(entry).toContainText("Teszt szezon");
  await expect(entry.getByRole("button", { name: "Nevezünk" })).toBeVisible();
  await second.context.close();

  const first = await as(browser, anna);
  await visit(first.page, "/pair");
  await expect(content(first.page)).toContainText(bence.name);
  await first.context.close();
});

test("6. the other pairs register and pair up; the Szervező pairs two who look for a partner", async ({ browser }) => {
  await registerAll(
    browser,
    GROUP_PAIRS.slice(1).flatMap((p) => p),
  );
  for (const p of GROUP_PAIRS.slice(1, -1)) await pairUp(browser, p);
  const [dora, miklos] = PAIRS.solo;
  await seekPartner(browser, dora);
  await seekPartner(browser, miklos);
  await pairSeekers(browser, PAIRS.solo);
  const { context, page } = await as(browser, dora);
  await visit(page, "/pair");
  await expect(content(page)).toContainText(miklos.name);
  await expect(page.getByRole("button", { name: "Nevezünk" })).toBeVisible();
  await context.close();
});
