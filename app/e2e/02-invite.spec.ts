// Walkthrough steps 3 and 4: the registration invite waits on "Kimenő
// levelek" until the Admin sends it.
import { expect, test } from "@playwright/test";

import { ADMIN, as, content, emailsSince, logOffset, visit, waitForEmails } from "./support";

test("3. the registration invite is queued, not sent", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/admin/signups");
  await expect(content(page)).toContainText("14 jelentkezés · 10 pár · 4 egyéni · 24 játékos");
  const button = page.getByRole("button", { name: "Regisztrációs meghívó (24 cím)" });

  const offset = logOffset();
  await button.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Küldöd a regisztrációs meghívót?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Küldés" }).click();
  await expect(dialog.getByRole("heading", { name: "Meghívók sorban" })).toBeVisible();
  await expect(dialog).toContainText("24 levél vár a Kimenő levelek között");
  await dialog.getByRole("button", { name: "Rendben" }).click();

  // Everyone is invited once; nothing went out.
  await expect(page.getByRole("button", { name: /Regisztrációs meghívó/ })).toBeDisabled();
  expect(emailsSince(offset)).toEqual([]);
  await context.close();
});

test("4. the Admin sends the held invites from Kimenő levelek", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/admin/outbox");
  const card = page.locator("[data-slot=card]", { hasText: "Regisztrációs meghívó" });
  await expect(card).toContainText("24 levél");
  // The preview hides every address, the login link's ?email= too.
  await expect(card).not.toContainText("@example.test");

  const offset = logOffset();
  await card.getByRole("button", { name: "Küldés" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Elküldöd?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Küldés" }).click();
  await expect(page.getByRole("status")).toContainText("24 levél a sorban, most 24 ment ki.");
  await expect(content(page)).toContainText("Nincs visszatartott levél.");

  const sent = await waitForEmails(offset, 24);
  expect(sent).toHaveLength(24);
  for (const mail of sent) expect(mail.text).toContain(`https://padelparbaj.hu/login?email=${encodeURIComponent(mail.to)}`);
  // The two solos without a partner get their own text (#96).
  const waiting = sent.find((m) => m.to === "pal.boglarka@example.test");
  expect(waiting?.text).toContain("Még keresünk neked párt, addig regisztrálj.");
  await context.close();
});
