// Walkthrough steps 3 and 4: the registration invite goes out as soon as the
// Admin starts it (#112); "Kimenő levelek" is only the log.
import { expect, test } from "@playwright/test";

import { ADMIN, as, content, logOffset, visit, waitForEmails } from "./support";

test("3. the registration invite goes out at once", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/admin/signups");
  await expect(content(page)).toContainText("14 jelentkezés · 10 pár · 4 egyéni · 24 játékos");
  const button = page.getByRole("button", { name: "Regisztrációs meghívó (24 cím)" });

  const offset = logOffset();
  await button.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Küldöd a regisztrációs meghívót?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Küldés" }).click();
  await expect(dialog.getByRole("heading", { name: "Meghívók elindultak" })).toBeVisible();
  await expect(dialog).toContainText("24 levél most megy ki, a napi limit szerint; ami ma nem fér bele, holnap.");
  await dialog.getByRole("button", { name: "Rendben" }).click();

  // Everyone is invited once.
  await expect(page.getByRole("button", { name: /Regisztrációs meghívó/ })).toBeDisabled();
  const sent = await waitForEmails(offset, 24);
  expect(sent).toHaveLength(24);
  for (const mail of sent) expect(mail.text).toContain(`https://padelparbaj.hu/register?email=${encodeURIComponent(mail.to)}`);
  // The two solos without a partner get their own text (#96).
  const waiting = sent.find((m) => m.to === "pal.boglarka@example.test");
  expect(waiting?.text).toContain("Még keresünk neked párt, addig regisztrálj.");
  await context.close();
});

test("4. Kimenő levelek logs the invites as sent, with no address and nothing to press", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/admin/outbox");
  await expect(content(page)).toContainText("Minden levél magától megy ki");
  const row = page.getByRole("row").filter({ hasText: "Regisztrációs meghívó" });
  await expect(row.getByRole("cell")).toHaveText(["Regisztrációs meghívó", "0", "24", "0", "–"]);
  await expect(content(page)).not.toContainText("@example.test");
  await expect(page.getByRole("button", { name: /Küldés|Elvetés/ })).toHaveCount(0);
  await context.close();
});
