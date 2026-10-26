// Walkthrough step 13: the Szervező pairs the two waiting solos; their pair
// forms once both have registered.
import { expect, test } from "@playwright/test";

import { ADMIN, ORGANIZER, WAITING_SOLOS, as, content, registerAll, visit } from "./support";

test("13. the Szervező pairs the waiting solos on Párkeresők", async ({ browser }) => {
  const [boglarka, akos] = WAITING_SOLOS;
  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta/solos");
  await expect(content(page)).toContainText("2 egyedül jelentkező keres párt, 1 párt hoztál össze");
  await expect(content(page)).not.toContainText("@example.test");

  await page.getByRole("checkbox", { name: `${boglarka.name} kijelölése` }).check();
  await page.getByRole("checkbox", { name: `${akos.name} kijelölése` }).check();
  await page.getByRole("button", { name: "Párba teszem (2/2)" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Párba teszem" }).click();
  await expect(content(page)).toContainText("0 egyedül jelentkező keres párt, 2 párt hoztál össze");
  await context.close();

  const admin = await as(browser, ADMIN.email);
  await visit(admin.page, "/admin/outbox");
  await expect(admin.page.locator("[data-slot=card]", { hasText: "Párkeresők bemutatása" })).toContainText("2 levél");
  await admin.context.close();

  // They were invited in step 3; once both register, the pair forms.
  await registerAll(browser, WAITING_SOLOS);
  const player = await as(browser, boglarka);
  await visit(player.page, "/pair");
  await expect(content(player.page)).toContainText(akos.name);
  await player.context.close();
});
