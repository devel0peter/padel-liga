// "Törlés" on Felhasználók (#152): the Admin deletes a test account without
// history, which goes completely; a player whose
// pair plays in a published group can't be deleted, and neither can the
// Admin's own account. No email goes out. Runs last: the earlier specs'
// counts stay as they were. Anonymizing an account with history needs a
// phase that has ended, which the walkthrough never reaches: unit tested
// (account-deletion.server.test.ts).
import { expect, test } from "@playwright/test";

import { ADMIN, PAIRS, as, content, d1, d1Insert, visit } from "./support";

const TEST = { id: "e2e-delete-me", name: "Teszt Törlendő", email: "torlendo@example.test" };

test("Törlés: an account without history is removed", async ({ browser }) => {
  d1Insert(
    `insert into users (id, email, name, level, phone, sex, consent_at) values ('${TEST.id}', '${TEST.email}', '${TEST.name}', 'kezdo', '+36305551234', 'male', unixepoch())`,
  );
  const emailsBefore = d1("select count(*) as n from email_messages")[0].n;

  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, `/admin/users?q=${encodeURIComponent(TEST.name)}`);
  const row = page.getByRole("row").filter({ hasText: TEST.name });
  await row.getByRole("button", { name: "Törlés" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(`Törlöd ${TEST.name} fiókját?`);
  await expect(dialog).toContainText("Nincs lejátszott múltja");
  await expect(dialog).toContainText("a leiratkozás vagy visszapattanás nyoma is");
  await expect(dialog).toContainText("Senki nem kap róla e-mailt.");
  await dialog.getByRole("button", { name: "Törlés" }).click();
  await expect(content(page).getByRole("status")).toHaveText("A fiók törölve.");
  await expect(page.getByRole("row").filter({ hasText: TEST.name })).toHaveCount(0);

  // Gone from the database (the interest list is gone too, #334).
  expect(d1(`select count(*) as n from users where email = '${TEST.email}'`)[0].n).toBe(0);
  expect(d1("select count(*) as n from email_messages")[0].n).toBe(emailsBefore);
  expect(d1("select actor_id, target from audit_log where action = 'account.delete'")).toEqual([
    { actor_id: ADMIN.id, target: `user:${TEST.id}` },
  ]);
  await context.close();
});

test("Törlés: refused while the pair plays, and for the Admin's own account", async ({ browser }) => {
  const anna = PAIRS.p1[0];
  const { context, page } = await as(browser, ADMIN.email);
  // Anna's pair is in a published group of a phase that hasn't ended (step 11).
  await visit(page, `/admin/users?q=${encodeURIComponent(anna.name)}`);
  await page.getByRole("row").filter({ hasText: anna.name }).getByRole("button", { name: "Törlés" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(`${anna.name} fiókja nem törölhető`);
  await expect(dialog).toContainText("Előbb a párt vissza kell léptetni.");
  await expect(dialog.getByRole("button", { name: "Törlés" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Rendben" }).click();

  await visit(page, `/admin/users?q=${encodeURIComponent(ADMIN.email)}`);
  await page.getByRole("row").filter({ hasText: ADMIN.email }).getByRole("button", { name: "Törlés" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("A saját fiókodat itt nem törölheted.");
  await context.close();
});
