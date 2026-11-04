// Napló (#226): the Admin opens the audit log from the sidebar and sees the
// earlier specs' organizer changes (#225), newest first, in Hungarian;
// filters live in the address. A Szervező and a player get 403. Read-only:
// the page has no form that changes an entry.
import { expect, test } from "@playwright/test";

import { actionLabel } from "../app/lib/audit";
import { ADMIN, ORGANIZER, PAIRS, as, content, d1, visit } from "./support";

test("Napló: the Admin sees who changed what, newest first, and filters it", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/home");
  await page.locator("[data-sidebar=sidebar]").getByRole("link", { name: "Napló" }).click();
  await expect(page).toHaveURL(/\/admin\/log$/);
  await expect(page.getByRole("heading", { name: "Napló" })).toBeVisible();

  const main = content(page);
  const rows = main.locator("tbody tr");
  const [newest] = d1("select action from audit_log order by at desc, id desc limit 1");
  await expect(rows.first()).toContainText(actionLabel(String(newest!.action)));
  // The groups the organizer published in the walkthrough, by name.
  await expect(main).toContainText("Csoportok közzététele");
  await expect(main).toContainText(ORGANIZER.name);
  // No address anywhere on the page, and nothing to change an entry with.
  await expect(main).not.toContainText("@");
  await expect(main.locator("form[method=post], button[type=submit]")).toHaveCount(0);

  // Filter by action from the select: the address keeps it.
  await main.getByRole("combobox", { name: "Művelet" }).click();
  await page.getByRole("option", { name: "Csoportok közzététele" }).click();
  await expect(page).toHaveURL(/action=groups\.publish/);
  const published = Number(d1("select count(*) as n from audit_log where action = 'groups.publish'")[0]!.n);
  await expect(rows).toHaveCount(published);
  await page.reload();
  await expect(rows).toHaveCount(published);
  await expect(rows.first()).toContainText("Csoportok közzététele");

  // By actor and league, straight from a bookmarked address.
  await visit(page, `/admin/log?actor=${encodeURIComponent(ORGANIZER.id)}`);
  const byOrganizer = Number(d1(`select count(*) as n from audit_log where actor_id = '${ORGANIZER.id}'`)[0]!.n);
  await expect(rows).toHaveCount(Math.min(byOrganizer, 50));
  await visit(page, "/admin/log?action=groups.publish&from=2000-01-01&to=2000-01-02");
  await expect(main).toContainText("Nincs ilyen bejegyzés.");
  await context.close();
});

test("Napló: a Szervező and a player get 403", async ({ browser }) => {
  for (const who of [ORGANIZER.email, PAIRS.p1[0]]) {
    const { context, page } = await as(browser, who);
    expect((await page.goto("/admin/log"))?.status()).toBe(403);
    expect((await page.request.get("/admin/log.data")).status()).toBe(403);
    await expect(page.locator("[data-sidebar=sidebar]").getByRole("link", { name: "Napló" })).toHaveCount(0);
    await context.close();
  }
});
