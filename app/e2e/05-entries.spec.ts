// Walkthrough steps 7 to 9: pairs enter the season ("Nevezünk") and the entry
// counts at once, no organizer approval (#153); both players get the notice
// and the email at once (#112); the Szervező sees the entered pairs.
import { expect, test, type Page } from "@playwright/test";

import { ADMIN, GROUP_PAIRS, ORGANIZER, PAIRS, as, content, logOffset, seasonPath, visit, waitForEmails } from "./support";

// #115: Anna's partner switches email off; the entry notice reaches them in
// the app only, and they switch it back on for the rest of the walkthrough.
const emailSwitch = (page: Page) => page.getByRole("switch", { name: "E-mail", exact: true });
// Flips the email switch and waits until the profile saved it.
async function flipEmail(page: Page) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.startsWith("/profile") && r.ok()),
    emailSwitch(page).click(),
  ]);
}

test("7a. a player switches email notifications off on the profile", async ({ browser }) => {
  const { context, page } = await as(browser, PAIRS.p1[1]);
  await visit(page, "/profile");
  const section = page.locator("#ertesitesek");
  // Both on by default.
  await expect(emailSwitch(page)).toBeChecked();
  await expect(page.getByRole("switch", { name: "Push értesítés" })).toBeChecked();
  await expect(section).toContainText("A belépési kódot mindig elküldjük.");
  await expect(section).toContainText("iPhone-on iOS 16.4 vagy újabb kell");
  await flipEmail(page);
  await expect(emailSwitch(page)).not.toBeChecked();
  await page.reload();
  await expect(emailSwitch(page)).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Push értesítés" })).toBeChecked();
  await context.close();
});

test("7. every pair enters once and is in at once; the partner sees it too", async ({ browser }) => {
  const offset = logOffset();
  for (const [first] of GROUP_PAIRS) {
    const { context, page } = await as(browser, first);
    await visit(page, "/pair");
    await page.getByRole("button", { name: "Nevezünk" }).click();
    await expect(page.getByRole("status")).toContainText("Beneveztetek: az 1. körtől játszotok (kezdés:");
    await page.reload();
    await expect(content(page)).toContainText("Beneveztetek: az 1. körtől játszotok.");
    await expect(content(page)).not.toContainText("jóváhagy");
    await expect(page.getByRole("button", { name: "Nevezünk" })).toHaveCount(0);
    await context.close();
  }
  // Sent at once: two per pair, except to Anna's partner, who switched email off (7a).
  const sent = await waitForEmails(offset, 11);
  expect(sent).toHaveLength(11);
  expect(sent.map((m) => m.to)).not.toContain(PAIRS.p1[1].email);
  for (const mail of sent) {
    expect(mail.subject).toBe("Beneveztetek – Padelpárbaj");
    expect(mail.text).not.toMatch(/jóváhagy/i);
  }

  for (const player of PAIRS.p1) {
    const p = await as(browser, player);
    await visit(p.page, "/pair");
    await expect(content(p.page)).toContainText("Beneveztetek: az 1. körtől játszotok.");
    // On Értesítések whatever the email switch says.
    await visit(p.page, "/notifications");
    await expect(content(p.page)).toContainText("Beneveztetek");
    await p.context.close();
  }

  const partner = await as(browser, PAIRS.p1[1]);
  await visit(partner.page, "/profile");
  await flipEmail(partner.page);
  await expect(emailSwitch(partner.page)).toBeChecked();
  await partner.page.reload();
  await expect(emailSwitch(partner.page)).toBeChecked();
  await partner.context.close();
});

test("8. the Szervező sees the entered pairs, with nothing to approve", async ({ browser }) => {
  const { context, page } = await as(browser, ORGANIZER.email);
  const entries = `${await seasonPath(page)}/entries`;
  await expect(page.getByRole("link", { name: "6 nevezett" })).toBeVisible();
  await visit(page, entries);
  await expect(content(page)).toContainText("6 nevezett pár");
  for (const [first] of GROUP_PAIRS) await expect(page.getByRole("row").filter({ hasText: first.name })).toContainText("az 1. körtől");
  await expect(page.getByRole("button", { name: /Jóváhagyás|Elutasítás/ })).toHaveCount(0);
  await expect(content(page)).not.toContainText(/függőben|jóváhagy/i);
  await context.close();
});

test("9. Kimenő levelek logs the entry emails as sent, nothing waiting", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/admin/outbox");
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Nevezés", exact: true }) });
  await expect(row.getByRole("cell")).toHaveText(["Nevezés", "0", "11", "0", "–"]);
  await context.close();
});
