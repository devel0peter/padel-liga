// Walkthrough step 14: the Szervező creates, dissolves and changes pairs on
// "Párok", and can't touch a pair in a published group (after step 11).
import { expect, test, type Page } from "@playwright/test";

import { LONE, ORGANIZER, PAIRS, WAITING_SOLOS, as, content, d1, levelLabel, registerAll, visit, type Player } from "./support";

const who = (p: Player) => `${p.name} (${levelLabel(p)})`;
const row = (page: Page, a: Player, b: Player) =>
  page.getByRole("row").filter({ hasText: a.name }).filter({ hasText: b.name });

async function pick(page: Page, label: string, player: Player) {
  await page.getByRole("dialog").getByLabel(label).click();
  await page.getByRole("option", { name: who(player) }).click();
}

test("14. create, dissolve and change pairs; a published pair is locked", async ({ browser }) => {
  const { torok, lakatos } = LONE;
  const [boglarka, akos] = WAITING_SOLOS;
  // Two players whose signup partner never registers: no pair yet.
  await registerAll(browser, [torok, lakatos]);
  const emailsBefore = d1("select count(*) as n from email_messages");

  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta/pairs");
  await expect(content(page)).not.toContainText("@example.test");

  // Pár létrehozása.
  await page.getByRole("button", { name: "Pár létrehozása" }).click();
  await pick(page, "Első játékos", torok);
  await pick(page, "Második játékos", lakatos);
  await page.getByRole("dialog").getByRole("button", { name: "Létrehozás" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, torok, lakatos)).toContainText("kézzel");
  await expect(row(page, torok, lakatos)).toContainText("Aktív");

  // Felbontás: the solo pair from step 13.
  await row(page, boglarka, akos).getByRole("button", { name: "Felbontás" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Felbontás" }).click();
  await expect(row(page, boglarka, akos)).toContainText("Felbontva");

  // Partner cseréje: Török Hanna stays, Pál Boglárka is the new partner.
  await row(page, torok, lakatos).getByRole("button", { name: "Partner cseréje" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: who(torok) }).check();
  await pick(page, "Új partner", boglarka);
  await page.getByRole("dialog").getByRole("button", { name: "Csere" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, torok, lakatos)).toContainText("Felbontva");
  await expect(row(page, torok, boglarka)).toContainText("kézzel");
  await expect(row(page, torok, boglarka)).toContainText("Aktív");

  // A pair in a published group: both buttons off, with the reason.
  const locked = row(page, PAIRS.p1[0], PAIRS.p1[1]);
  await expect(locked.getByRole("button", { name: "Felbontás" })).toBeDisabled();
  await expect(locked.getByRole("button", { name: "Partner cseréje" })).toBeDisabled();
  await expect(locked).toContainText("Kör közben nem bontható fel");

  // #154: the organizer enters the new pair, takes it out and enters it again.
  // Round 1's groups are out (step 11): it plays from round 2.
  const fresh = row(page, torok, boglarka);
  const confirm = async (button: string, title: RegExp, action: string) => {
    await fresh.getByRole("button", { name: button }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(title);
    await expect(dialog).toContainText("e-mailt nem");
    await dialog.getByRole("button", { name: action, exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  await expect(fresh).toContainText("Nem nevezett");
  await confirm("Benevezés", new RegExp(`Benevezed: ${torok.name} – ${boglarka.name}\\?`), "Benevezés");
  await expect(fresh).toContainText(/Nevezés \(.+\): Nevezett/);
  await expect(fresh).toContainText("a 2. körtől");
  await confirm("Kivétel a szezonból", new RegExp(`Kiveszed a szezonból: ${torok.name} – ${boglarka.name}\\?`), "Kivétel");
  await expect(fresh).toContainText(/Nevezés \(.+\): Visszavonva/);
  await expect(fresh).toContainText("Aktív");
  await confirm("Benevezés", /Benevezed/, "Benevezés");
  await expect(fresh).toContainText(/Nevezés \(.+\): Nevezett/);

  // A pair that plays in the running round can't be taken out: the reason shows.
  await locked.getByRole("button", { name: "Kivétel a szezonból" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Kivétel", exact: true }).click();
  await expect(locked.getByRole("alert")).toContainText("a futó kör csoportjában játszik");
  await expect(locked).toContainText(/Nevezés \(.+\): Nevezett/);
  await expect(content(page)).not.toContainText("@example.test");
  await context.close();

  // No email for a pair change or an entry change; the players see it on Párom
  // and on Értesítések.
  expect(d1("select count(*) as n from email_messages")).toEqual(emailsBefore);
  const player = await as(browser, torok);
  await visit(player.page, "/pair");
  await expect(content(player.page)).toContainText(boglarka.name);
  await expect(content(player.page)).toContainText("Beneveztetek: a 2. körtől játszotok.");
  await visit(player.page, "/notifications");
  await expect(content(player.page)).toContainText("A szervező kivett titeket a szezonból");
  await expect(content(player.page)).toContainText("A szervező benevezett titeket");
  await player.context.close();
});
