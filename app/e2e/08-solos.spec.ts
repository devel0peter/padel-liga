// Walkthrough step 13: the Szervező pairs the two waiting solos; their pair
// forms once both have registered.
import { expect, test } from "@playwright/test";

import { ADMIN, ORGANIZER, WAITING_SOLOS, as, content, logOffset, registerAll, visit, waitForEmails } from "./support";

test("13. the Szervező pairs the waiting solos on Párkeresők", async ({ browser }) => {
  const [boglarka, akos] = WAITING_SOLOS;
  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta/solos");
  await expect(content(page)).toContainText("2 egyedül jelentkező keres párt, 1 párt hoztál össze");
  await expect(content(page)).not.toContainText("@example.test");

  await page.getByRole("checkbox", { name: `${boglarka.name} kijelölése` }).check();
  await page.getByRole("checkbox", { name: `${akos.name} kijelölése` }).check();
  const offset = logOffset();
  await page.getByRole("button", { name: "Párba teszem (2/2)" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Párba teszem" }).click();
  await expect(content(page)).toContainText("0 egyedül jelentkező keres párt, 2 párt hoztál össze");
  await context.close();

  // Both get the introduction at once (#112), and the log counts it.
  const intros = await waitForEmails(offset, 2);
  expect(intros.map((m) => m.to).sort()).toEqual([akos.email, boglarka.email].sort());
  const admin = await as(browser, ADMIN.email);
  await visit(admin.page, "/admin/outbox");
  const row = admin.page.getByRole("row").filter({ hasText: "Párkeresők bemutatása" });
  await expect(row.getByRole("cell").nth(2)).toHaveText("2");
  await admin.context.close();

  // They were invited in step 3; once both register, the pair forms.
  await registerAll(browser, WAITING_SOLOS);
  const player = await as(browser, boglarka);
  await visit(player.page, "/pair");
  await expect(content(player.page)).toContainText(akos.name);
  await player.context.close();
});
