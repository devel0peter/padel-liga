// Emlékeztetők (#155): the Szervező sees who each reminder would reach and a
// preview before switching them on; switching on sends nothing by itself,
// the next scheduled run does. Everyone the walkthrough made is newer than
// the waiting times, so two fixture accounts stand in for the stuck:
// Cili registered 3 days ago without a pair (C), and an account started
// 2 days ago without finishing the first-login page (B). Runs last.
import { expect, test } from "@playwright/test";

import { BASE_URL } from "./env";
import { ORGANIZER, as, content, d1, d1Insert, logOffset, visit, waitForEmails } from "./support";

const CILI = { name: "Emlék Cili", email: "emlek.cili@example.test" };
const UNFINISHED = "emlek.bela@example.test";

test("the Szervező previews the reminders, switches them on, and the scheduled run sends them once", async ({ browser }) => {
  d1Insert(
    `insert into users (id, email, name, level, phone, consent_at, created_at) values ` +
      `('emlek-cili', '${CILI.email}', '${CILI.name}', 'kezdo', '+36305551111', unixepoch() - 3 * 86400, unixepoch() - 3 * 86400), ` +
      `('emlek-bela', '${UNFINISHED}', '', null, null, null, unixepoch() - 2 * 86400)`,
  );

  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta");
  await page.locator("[data-sidebar=sidebar]").getByRole("link", { name: "Emlékeztetők" }).click();
  await expect(page).toHaveURL(/\/admin\/leagues\/minta\/reminders$/);

  // Off by default, with the backlog it would reach now.
  const toggle = content(page).getByRole("switch", { name: "Kikapcsolva" });
  await expect(toggle).not.toBeChecked();
  const table = page.getByRole("table", { name: "Emlékeztetők helyzetenként" });
  const row = (label: string) => table.getByRole("row").filter({ hasText: label });
  await expect(row("Félbehagyta a regisztrációt")).toContainText("1");
  await expect(row("Regisztrált, nincs párja")).toContainText("1");
  await expect(row("Van párja, nem nevezett").getByRole("cell").nth(1)).toHaveText("0");

  // A preview with Cili's own data, but no address, phone or pair link token.
  await expect(content(page)).toContainText("Küldd el a párlinkedet – Padelpárbaj");
  await expect(content(page)).toContainText(`Szia ${CILI.name}!`);
  await expect(content(page)).toContainText("/pair/join/…");
  await expect(content(page)).not.toContainText("@example.test");
  await expect(content(page)).not.toContainText("+36");

  // Switching on asks first and queues nothing by itself.
  await toggle.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("A következő óránkénti futás 2 embernek küld emlékeztetőt");
  await dialog.getByRole("button", { name: "Bekapcsolom" }).click();
  await expect(content(page).getByRole("switch", { name: "Bekapcsolva" })).toBeChecked();
  await visit(page, "/admin/leagues/minta/reminders");
  await expect(content(page).getByRole("switch", { name: "Bekapcsolva" })).toBeChecked();
  expect(d1("select count(*) as n from email_messages where kind = 'stuck_reminder'")).toEqual([{ n: 0 }]);

  // The scheduled run (the hourly cron) sends one to each.
  const offset = logOffset();
  expect((await fetch(`${BASE_URL}/cdn-cgi/local/scheduled`)).ok).toBe(true);
  const sent = await waitForEmails(offset, 2, (e) => e.to.startsWith("emlek."));
  expect(sent.map((e) => e.to).sort()).toEqual([UNFINISHED, CILI.email]);
  const cili = sent.find((e) => e.to === CILI.email)!;
  expect(cili.subject).toBe("Küldd el a párlinkedet – Padelpárbaj");
  expect(cili.text).toMatch(/\/pair\/join\/[A-Za-z0-9_-]{20,}/);

  // A second run sends nothing more; the page shows what went out.
  await fetch(`${BASE_URL}/cdn-cgi/local/scheduled`);
  // Let the run's background work finish before counting.
  await page.waitForTimeout(3000);
  expect(d1("select count(*) as n from email_messages where kind = 'stuck_reminder'")).toEqual([{ n: 2 }]);
  await visit(page, "/admin/leagues/minta/reminders");
  await expect(row("Regisztrált, nincs párja").getByRole("cell").nth(1)).toHaveText("0");
  await expect(row("Regisztrált, nincs párja").getByRole("cell").nth(2)).toHaveText("1");
  await context.close();
});
