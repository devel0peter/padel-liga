// The Admin's player profile (#301, D156) with the email log (#242, D157):
// opened by clicking a name on Játékosok, with the facts, the pair, the
// emails and the Napló entries about the player; the Admin fixes the name (audited) and sets it back. A Szervező sees the
// name without a link and gets 403 on the profile. Runs after the
// walkthrough; leaves the state as it found it (the name is restored).
import { expect, test } from "@playwright/test";

import { ADMIN, ORGANIZER, PAIRS, as, content, d1, playersTable, visit } from "./support";

const PLAYERS = "/admin/leagues/minta/players";

test("the Admin opens a player's profile from Játékosok and fixes the name", async ({ browser }) => {
  const [anna, partner] = PAIRS.p1;
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, `${PLAYERS}?q=${encodeURIComponent(anna.name)}`);
  // Her own row and her partner's "Pár" cell both link to her profile.
  await playersTable(page).getByRole("link", { name: anna.name, exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/users\/[^/?]+$/);
  await expect(page.getByRole("heading", { name: anna.name, level: 1 })).toBeVisible();
  const main = content(page);
  await expect(main).toContainText(anna.email);
  await expect(main.getByRole("region", { name: "Ligák" })).toContainText(partner.name);
  await expect(main.getByRole("region", { name: "Párok és nevezések" })).toContainText(partner.name);
  await expect(main.getByRole("link", { name: "Levél neki" })).toBeVisible();
  // Her email log (#242): the login codes she got, sent to the dev console;
  // no address in it.
  const mail = main.getByRole("region", { name: "Levelek" });
  await expect(mail.getByRole("row").filter({ hasText: "Belépőkód" }).first()).toContainText("Elküldve");
  await expect(mail).toContainText("Konzol (fejlesztés)");
  await expect(mail).not.toContainText("@");

  const fixed = `${anna.name} (javítva)`;
  for (const name of [fixed, anna.name]) {
    await main.getByRole("button", { name: "Adatok módosítása" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Név").fill(name);
    await dialog.getByRole("button", { name: "Mentés" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  }
  // Two entries in its Napló, naming the field and not the value.
  const log = main.getByRole("region", { name: "Napló" });
  await expect(log.getByText("Játékos adatainak módosítása")).toHaveCount(2);
  await expect(log).toContainText("Módosítva: név");
  await expect(log).not.toContainText("(javítva)");
  expect(d1(`select name from users where email = '${anna.email}'`)).toEqual([{ name: anna.name }]);
  await context.close();
});

test("a Szervező sees the names without a link, and gets 403 on a profile", async ({ browser }) => {
  const anna = PAIRS.p1[0];
  const [{ id }] = d1(`select id from users where email = '${anna.email}'`);
  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, `${PLAYERS}?q=${encodeURIComponent(anna.name)}`);
  await expect(playersTable(page)).toContainText(anna.name);
  await expect(playersTable(page).getByRole("link", { name: anna.name, exact: true })).toHaveCount(0);
  await expect(content(page)).not.toContainText("@example.test");
  await page.goto(`/admin/users/${String(id)}`);
  await expect(page.getByText("Ehhez nincs jogod")).toBeVisible();
  await context.close();
});
