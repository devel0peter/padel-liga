// Walkthrough steps 7 to 9: pairs enter the season ("Nevezünk"), the
// Szervező decides on the entries page, the decisions go out at once (#112).
import { expect, test, type Page } from "@playwright/test";

import { ADMIN, GROUP_PAIRS, ORGANIZER, PAIRS, as, content, logOffset, seasonPath, visit, waitForEmails } from "./support";

const NOTE = "Jó játékot, találkozunk a pályán!";

test("7. every pair enters once, the partner sees it too", async ({ browser }) => {
  for (const [first] of GROUP_PAIRS) {
    const { context, page } = await as(browser, first);
    await visit(page, "/pair");
    await page.getByRole("button", { name: "Nevezünk" }).click();
    await expect(page.getByRole("status")).toContainText("Neveztetek. A szervező döntését a Párom oldalon látjátok.");
    await page.reload();
    await expect(content(page)).toContainText("Neveztetek. A szervező jóváhagyására vár.");
    await expect(page.getByRole("button", { name: "Nevezünk" })).toHaveCount(0);
    await context.close();
  }
  const partner = await as(browser, PAIRS.p1[1]);
  await visit(partner.page, "/pair");
  await expect(content(partner.page)).toContainText("Neveztetek. A szervező jóváhagyására vár.");
  await partner.context.close();
});

// #115: Anna's partner switches email off; the decision reaches them in the
// app only, and they switch it back on for the rest of the walkthrough.
const emailSwitch = (page: Page) => page.getByRole("switch", { name: "E-mail", exact: true });
// Flips the email switch and waits until the profile saved it.
async function flipEmail(page: Page) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.startsWith("/profile") && r.ok()),
    emailSwitch(page).click(),
  ]);
}

test("7b. a player switches email notifications off on the profile", async ({ browser }) => {
  const { context, page } = await as(browser, PAIRS.p1[1]);
  await visit(page, "/profile");
  const section = page.locator("#ertesitesek");
  // Both on by default.
  await expect(emailSwitch(page)).toBeChecked();
  await expect(page.getByRole("switch", { name: "Push értesítés" })).toBeChecked();
  await expect(section).toContainText("A belépési kódot és a jelentkezésed visszaigazolását mindig elküldjük.");
  await expect(section).toContainText("iPhone-on iOS 16.4 vagy újabb kell");
  await flipEmail(page);
  await expect(emailSwitch(page)).not.toBeChecked();
  await page.reload();
  await expect(emailSwitch(page)).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Push értesítés" })).toBeChecked();
  await context.close();
});

test("8. the Szervező approves, rejects and changes their mind", async ({ browser }) => {
  const { context, page } = await as(browser, ORGANIZER.email);
  const entries = `${await seasonPath(page)}/entries`;
  await expect(page.getByRole("link", { name: "6 függőben" })).toBeVisible();
  await visit(page, entries);
  await expect(page.getByRole("link", { name: "Függőben (6)" })).toHaveAttribute("aria-current", "page");

  const row = (name: string) => page.getByRole("row").filter({ hasText: name });
  const decide = async (name: string, button: "Jóváhagyás" | "Elutasítás", note?: string) => {
    await row(name).getByRole("button", { name: button }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Mindkét játékos most értesítést kap róla, e-mailben is, ha nem kapcsolta ki.");
    if (note) await dialog.getByLabel("Üzenet (nem kötelező)").fill(note);
    await dialog.getByRole("button", { name: button }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row(name)).toHaveCount(0);
  };

  const offset = logOffset();
  await decide(PAIRS.p1[0].name, "Jóváhagyás", NOTE);
  await decide(PAIRS.p2[0].name, "Elutasítás");
  await visit(page, `${entries}?status=rejected`);
  await decide(PAIRS.p2[0].name, "Jóváhagyás");
  await visit(page, entries);
  for (const [first] of GROUP_PAIRS.slice(2)) await decide(first.name, "Jóváhagyás");
  await expect(content(page)).toContainText("Nincs ilyen nevezés.");
  await expect(page.getByRole("link", { name: "Jóváhagyva (6)" })).toBeVisible();
  // Sent at once: two per decision, six approvals, one rejection, one flip,
  // except to Anna's partner, who switched email off (7b).
  const sent = await waitForEmails(offset, 13);
  expect(sent).toHaveLength(13);
  const toP1 = sent.filter((m) => PAIRS.p1.some((p) => p.email === m.to));
  expect(toP1.map((m) => m.to)).toEqual([PAIRS.p1[0].email]);
  for (const mail of toP1) expect(mail.text).toContain(NOTE);
  await context.close();

  for (const player of PAIRS.p1) {
    const p = await as(browser, player);
    await visit(p.page, "/pair");
    await expect(content(p.page)).toContainText("Jóváhagyva: az 1. körtől játszotok.");
    await expect(content(p.page)).toContainText(`A szervező üzenete: ${NOTE}`);
    // On Értesítések whatever the email switch says.
    await visit(p.page, "/notifications");
    await expect(content(p.page)).toContainText("Jóváhagyták a nevezéseteket");
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

test("9. Kimenő levelek logs the decisions as sent, nothing waiting", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/admin/outbox");
  const row = page.getByRole("row").filter({ hasText: "Döntés a nevezésről" });
  await expect(row.getByRole("cell")).toHaveText(["Döntés a nevezésről", "0", "13", "0", "–"]);
  await context.close();
});
