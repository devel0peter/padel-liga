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
  // Both came in through Mintaváros's register button (D128): its players.
  d1Insert(
    `insert into league_members (league_id, user_id, source) select id, 'emlek-cili', 'register' from leagues where slug = 'minta' ` +
      `union all select id, 'emlek-bela', 'register' from leagues where slug = 'minta'`,
  );

  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta");
  await page.locator("[data-sidebar=sidebar]").getByRole("link", { name: "Beállítások", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/leagues\/minta\/settings/);
  await content(page).getByRole("link", { name: "Emlékeztetők" }).click();
  await expect(page).toHaveURL(/\/admin\/leagues\/minta\/settings\?tab=reminders/);

  // Off by default, with the backlog it would reach now.
  await expect(content(page)).toContainText("Kikapcsolva");
  await expect(content(page)).toContainText("Félbehagyta a regisztrációt");
  await expect(content(page)).toContainText("Regisztrált, nincs párja");
  await expect(content(page)).not.toContainText("@example.test");
  await expect(content(page)).not.toContainText("+36");

  // Switching on queues nothing by itself.
  await content(page).getByRole("button", { name: "Bekapcsolom" }).click();
  await expect(content(page)).toContainText("Bekapcsolva");
  await visit(page, "/admin/leagues/minta/reminders");
  await expect(page).toHaveURL(/\/admin\/leagues\/minta\/settings\?tab=reminders/);
  await expect(content(page)).toContainText("Bekapcsolva");
  expect(d1("select count(*) as n from email_messages where kind = 'stuck_reminder'")).toEqual([{ n: 0 }]);

  // The scheduled run (the cron) sends one to each.
  const offset = logOffset();
  expect((await fetch(`${BASE_URL}/cdn-cgi/local/scheduled`)).ok).toBe(true);
  const sent = await waitForEmails(offset, 2, (e) => e.to.startsWith("emlek."));
  expect(sent.map((e) => e.to).sort()).toEqual([UNFINISHED, CILI.email]);
  const cili = sent.find((e) => e.to === CILI.email)!;
  expect(cili.subject).toBe("Hívd meg a párodat – Padelpárbaj");
  expect(cili.text).toMatch(/\/pair\/join\/[A-Za-z0-9_-]{20,}/);

  // A second run sends nothing more.
  await fetch(`${BASE_URL}/cdn-cgi/local/scheduled`);
  await page.waitForTimeout(3000);
  expect(d1("select count(*) as n from email_messages where kind = 'stuck_reminder'")).toEqual([{ n: 2 }]);
  await context.close();
});
