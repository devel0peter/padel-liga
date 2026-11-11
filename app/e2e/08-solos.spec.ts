// Walkthrough step 13: two more players without a partner register, switch
// on "Párt keresek", and the Szervező pairs them on Játékosok (#301; on
// Párkeresők until then). Only registered players are listed (#333).
import { expect, test } from "@playwright/test";

import { ORGANIZER, WAITING_SOLOS, as, content, playersTable, registerAll, seekPartner, visit } from "./support";

test("13. the Szervező pairs two players who look for a partner on Játékosok", async ({ browser }) => {
  const [boglarka, akos] = WAITING_SOLOS;
  await registerAll(browser, WAITING_SOLOS);
  await seekPartner(browser, boglarka);
  await seekPartner(browser, akos);

  const { context, page } = await as(browser, ORGANIZER.email);
  // The old address still works: Párkeresők opens Játékosok with "Párt keres".
  await visit(page, "/admin/leagues/minta/solos");
  await expect(page).toHaveURL(/\/admin\/leagues\/minta\/players\?filter=seeking$/);
  await expect(page.getByRole("link", { name: "Párt keres (2)" })).toHaveAttribute("aria-current", "page");
  await expect(content(page)).not.toContainText("@example.test");
  // The second league's player, who looks for a partner there, isn't listed here (#331).
  await expect(content(page)).not.toContainText("Idegen Ilona");

  await page.getByRole("checkbox", { name: `${boglarka.name} kijelölése` }).check();
  await page.getByRole("checkbox", { name: `${akos.name} kijelölése` }).check();
  await content(page).getByRole("button", { name: "Párba teszem (2/2)" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Párba teszem" }).click();
  await expect(page.getByRole("link", { name: "Párt keres (0)" })).toBeVisible();
  await expect(playersTable(page)).toHaveCount(0);
  await context.close();

  const player = await as(browser, boglarka);
  await visit(player.page, "/profile");
  await expect(content(player.page)).toContainText(akos.name);
  await player.context.close();
});
