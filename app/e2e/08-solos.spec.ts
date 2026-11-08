// Walkthrough step 13: two more players without a partner register, switch
// on "Párt keresek", and the Szervező pairs them on Párkeresők. No solo
// signups any more (#333): only registered players are listed.
import { expect, test } from "@playwright/test";

import { ORGANIZER, WAITING_SOLOS, as, content, registerAll, seekPartner, visit } from "./support";

test("13. the Szervező pairs two players who look for a partner on Párkeresők", async ({ browser }) => {
  const [boglarka, akos] = WAITING_SOLOS;
  await registerAll(browser, WAITING_SOLOS);
  await seekPartner(browser, boglarka);
  await seekPartner(browser, akos);

  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta/solos");
  await expect(content(page)).toContainText("2 regisztrált játékos keres párt, 1 párt hoztál össze");
  await expect(content(page)).not.toContainText("Még nem regisztráltak");
  await expect(content(page)).not.toContainText("@example.test");
  // The second league's player, who looks for a partner there, isn't listed here (#331).
  await expect(content(page)).not.toContainText("Idegen Ilona");

  const registered = page.getByRole("region", { name: "Regisztráltak", exact: true });
  await registered.getByRole("checkbox", { name: `${boglarka.name} kijelölése` }).check();
  await registered.getByRole("checkbox", { name: `${akos.name} kijelölése` }).check();
  await registered.getByRole("button", { name: "Párba teszem (2/2)" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Párba teszem" }).click();
  await expect(content(page)).toContainText("0 regisztrált játékos keres párt, 2 párt hoztál össze");
  await context.close();

  const player = await as(browser, boglarka);
  await visit(player.page, "/profile");
  await expect(content(player.page)).toContainText(akos.name);
  await player.context.close();
});
