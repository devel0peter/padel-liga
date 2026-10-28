// Walkthrough steps 10 to 12: the Szervező drafts the groups, moves a pair,
// publishes; the matches exist and the group emails go out at once (#112).
// Közzététel is the step that crashed on D1 while the unit tests passed (#98).
import { expect, test } from "@playwright/test";

import {
  ADMIN,
  GROUP_PAIRS,
  ORGANIZER,
  PAIRS,
  as,
  content,
  d1,
  logOffset,
  seasonPath,
  visit,
  waitForEmails,
} from "./support";

const group = (page: import("@playwright/test").Page, n: number) =>
  page.locator("[data-slot=card]", { has: page.getByText(`${n}. csoport`, { exact: true }) });

test("10. the draft splits six pairs 3 + 3 by Elo, and a move can be undone", async ({ browser }) => {
  const { context, page } = await as(browser, ORGANIZER.email);
  const groups = `${await seasonPath(page)}/groups`;
  await visit(page, groups);
  await expect(content(page)).toContainText("6 jóváhagyott pár van.");
  await page.getByRole("button", { name: "Csoportok javaslata" }).click();
  await expect(page.getByRole("status")).toContainText("Kész a javaslat.");

  await expect(group(page, 1)).toContainText("3 pár");
  await expect(group(page, 2)).toContainText("3 pár");
  // The strongest pair (Versenyző) is in group 1, every pair shows its Elo.
  await expect(group(page, 1)).toContainText(PAIRS.p1[0].name);
  await expect(content(page).getByText(/^Elo: /)).toHaveCount(6);

  // Áthelyezés: group 1 drops to 2 pairs, so nothing can be published.
  await page.getByRole("combobox", { name: new RegExp(`Áthelyezés: .*${PAIRS.p1[0].name}`) }).click();
  await page.getByRole("option", { name: "2. csoportba" }).click();
  await expect(group(page, 2)).toContainText(PAIRS.p1[0].name);
  await expect(group(page, 1).getByRole("alert")).toHaveText("2 pár: egy csoportban 3 vagy 4 pár lehet.");
  await expect(page.getByRole("button", { name: "Közzététel" })).toBeDisabled();

  // Újragenerálás throws the move away.
  await page.getByRole("button", { name: "Újragenerálás" }).click();
  await expect(group(page, 1)).toContainText(PAIRS.p1[0].name);
  await expect(group(page, 1)).toContainText("3 pár");
  await expect(page.getByRole("button", { name: "Közzététel" })).toBeEnabled();
  await context.close();
});

test("11. Közzététel locks the groups, creates the matches and emails every player at once", async ({ browser }) => {
  const { context, page } = await as(browser, ORGANIZER.email);
  const season = await seasonPath(page);
  await visit(page, `${season}/groups`);

  const offset = logOffset();
  await page.getByRole("button", { name: "Közzététel" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Közzéteszed a csoportokat?" })).toBeVisible();
  await expect(dialog).toContainText("mind a 12 játékos most értesítést kap");
  await dialog.getByRole("button", { name: "Közzététel" }).click();
  await expect(page.getByRole("status")).toContainText("Közzétetted a csoportokat.");

  await expect(content(page)).toContainText("A csoportok már nem módosíthatók.");
  await expect(page.getByRole("button", { name: "Újragenerálás" })).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await visit(page, "/admin/leagues/minta/seasons");
  await expect(page.getByRole("link", { name: "Közzétéve" })).toBeVisible();

  // A group of 3 plays 3 matches: 6 in all.
  expect(d1("select count(*) as n from matches")).toEqual([{ n: 6 }]);

  // An entry in a published group can't be rejected any more.
  await visit(page, `${season}/entries?status=approved`);
  const row = page.getByRole("row").filter({ hasText: PAIRS.p1[0].name });
  await row.getByRole("button", { name: "Elutasítás" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Elutasítás" }).click();
  await expect(page.getByRole("alert")).toHaveText("Ez a pár már a kiírt csoportjában játszik, ezért most nem utasíthatod el.");
  await expect(row).toBeVisible();

  // One email per player, sent at once (#112), with no one else's address.
  const players = GROUP_PAIRS.flat();
  const sent = await waitForEmails(offset, 12, (m) => m.subject.startsWith("Itt a csoportod"));
  expect(sent.map((m) => m.to).sort()).toEqual(players.map((p) => p.email).sort());
  for (const mail of sent) {
    for (const other of players) if (other.email !== mail.to) expect(mail.text).not.toContain(other.email);
  }
  await context.close();
});

test("12. Kimenő levelek logs the group emails as sent, nothing waiting", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/admin/outbox");
  const row = page.getByRole("row").filter({ hasText: "Kihirdetett csoportok" });
  await expect(row.getByRole("cell")).toHaveText(["Kihirdetett csoportok", "0", "12", "0", "–"]);
  await context.close();
});
