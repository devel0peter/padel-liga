// Walkthrough steps 5 and 6: players register from the invite link, and a
// pair forms from the signup once both partners have.
import { expect, test } from "@playwright/test";

import { GROUP_PAIRS, PAIRS, as, completeWelcome, content, levelLabel, logIn, registerAll, save, visit } from "./support";

const [anna, bence] = PAIRS.p1;

test("5. the first partner registers and waits for the other", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page, anna.email);
  await expect(page).toHaveURL(/\/welcome/);
  // The signup's partner, by name only (#96).
  await expect(page.getByRole("status")).toContainText(`A párod: ${bence.name}.`);
  await expect(page.getByLabel("Szinted")).toContainText(levelLabel(anna));

  // Without the consent the form stays, with an error.
  await page.getByLabel("Neved").fill(anna.name);
  await page.getByRole("button", { name: "Kész" }).click();
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.locator("#consent-error")).not.toBeEmpty();

  await completeWelcome(page, anna);
  await save(context, anna.email);
  await visit(page, "/pair");
  await expect(content(page)).toContainText(`A párod, ${bence.name}, még nem regisztrált.`);
  await expect(content(page)).not.toContainText(bence.email);
  await context.close();
});

test("6. the pair forms when the second partner registers", async ({ browser }) => {
  const second = await as(browser, bence);
  await visit(second.page, "/pair");
  await expect(content(second.page)).toContainText("A párod");
  await expect(content(second.page)).toContainText(anna.name);
  const entry = second.page.locator("[data-slot=card]", { hasText: "Nevezés" });
  await expect(entry).toContainText("Teszt szezon");
  await expect(entry.getByRole("button", { name: "Nevezünk" })).toBeVisible();
  await second.context.close();

  const first = await as(browser, anna);
  await visit(first.page, "/pair");
  await expect(content(first.page)).toContainText(bence.name);
  await expect(content(first.page)).not.toContainText("még nem regisztrált");
  await first.context.close();
});

test("6. the other pairs register, the Szervező's solo pair too", async ({ browser }) => {
  await registerAll(
    browser,
    GROUP_PAIRS.slice(1).flatMap((p) => p),
  );
  const [dora, miklos] = PAIRS.solo;
  const { context, page } = await as(browser, dora);
  await visit(page, "/pair");
  await expect(content(page)).toContainText(miklos.name);
  await expect(page.getByRole("button", { name: "Nevezünk" })).toBeVisible();
  await context.close();
});
