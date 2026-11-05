// "Fiók törlése" on the player's own profile (#38, D111): the same deletion
// as the Admin's (#152). A test account without history deletes itself: the
// dialog says what happens, every device is logged out, it lands on the home
// page with a short line, and it can't get back in. A player whose pair
// plays in a published group is told why not; the Admin can't delete their
// own account here. No email goes out. Anonymizing needs a phase that has
// ended: unit tested (account-deletion.server.test.ts, profile.test.ts).
import { expect, test } from "@playwright/test";

import { ADMIN, PAIRS, as, content, d1, d1Insert, logIn, visit } from "./support";

const TEST = { id: "e2e-self-delete", name: "Teszt Kilépő", email: "kilepo@example.test" };

test("Fiók törlése: a player without history deletes their own account", async ({ browser }) => {
  d1Insert(
    `insert into users (id, email, name, level, phone, sex, consent_at) values ('${TEST.id}', '${TEST.email}', '${TEST.name}', 'kezdo', '+36305559876', 'female', unixepoch())`,
  );
  const emailsBefore = d1("select count(*) as n from email_messages where to_email <> '" + TEST.email + "'")[0].n;
  // Two devices, both logged in.
  const one = await browser.newContext();
  const page = await one.newPage();
  await logIn(page, TEST.email);
  const two = await browser.newContext();
  const other = await two.newPage();
  await logIn(other, TEST.email);

  await visit(page, "/profile");
  await content(page).getByRole("button", { name: "Fiók törlése" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Törlöd a fiókodat?");
  await expect(dialog).toContainText("Még nem szerepeltél a ligában, ezért minden adatod törlődik");
  await expect(dialog).toContainText("Minden eszközön kilépünk");
  await expect(dialog).toContainText("Nem vonható vissza.");
  await dialog.getByRole("button", { name: "Fiók törlése" }).click();

  await expect(page).toHaveURL(/\/\?accountDeleted=1$/);
  await expect(page.getByRole("status").filter({ hasText: "Töröltük a fiókodat" })).toBeVisible();
  // Logged out here and on the other device.
  await visit(page, "/profile");
  await expect(page).toHaveURL(/\/login\?/);
  await visit(other, "/profile");
  await expect(other).toHaveURL(/\/login\?/);

  expect(d1(`select count(*) as n from users where email = '${TEST.email}' or id = '${TEST.id}'`)[0].n).toBe(0);
  expect(d1(`select count(*) as n from email_messages where to_email <> '${TEST.email}'`)[0].n).toBe(emailsBefore);
  expect(d1(`select actor_id, target from audit_log where action = 'account.delete' and target = 'user:${TEST.id}'`)).toEqual([
    { actor_id: null, target: `user:${TEST.id}` },
  ]);
  await one.close();
  await two.close();
});

test("Fiók törlése: refused while the pair plays, and for the Admin", async ({ browser }) => {
  const anna = PAIRS.p1[0];
  // Anna's pair is in a published group of a phase that hasn't ended (step 11).
  const player = await as(browser, anna);
  await visit(player.page, "/profile");
  await content(player.page).getByRole("button", { name: "Fiók törlése" }).click();
  const dialog = player.page.getByRole("alertdialog");
  await expect(dialog).toContainText("Most nem törölheted: a párod kihirdetett csoportban játszik");
  await expect(dialog.getByRole("button", { name: "Fiók törlése" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Rendben" }).click();
  await player.context.close();

  const admin = await as(browser, ADMIN.email);
  await visit(admin.page, "/profile");
  await content(admin.page).getByRole("button", { name: "Fiók törlése" }).click();
  await expect(admin.page.getByRole("alertdialog")).toContainText("Adminként a saját fiókodat nem törölheted.");
  await admin.context.close();
});
