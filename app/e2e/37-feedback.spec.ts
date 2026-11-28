// Feedback (spec 19, D94): a logged-in player sends a bug report from the
// sidebar and a visitor an idea from a public page's footer (#240, the suite
// has no Turnstile key, so the bot check passes); the visitors' hourly limit
// refuses the 31st message and keeps the text. The Admin lists, filters,
// opens, marks done and reopens on Visszajelzések; a Szervező and a player
// are refused (#241). Runs after the walkthrough; leaves its bug report, idea
// and rating for e2e:shots (--data walked) and removes the filler rows.
import { expect, test, type Locator, type Page } from "@playwright/test";

import { ORGANIZER, ADMIN, PAIRS, as, content, d1, d1Delete, d1Insert, visit } from "./support";

const BUG = "E2E: a Tabella nem tölt be";
const IDEA = "E2E: legyen sötét mód";
const RATING = "E2E: jó kis liga";
const RATING_FROM_PROFILE = "E2E: több labda kéne";
const LIST = "/admin/feedback";

async function send(page: Page | Locator, kind: string, message: string) {
  await page.getByRole("radio", { name: kind, exact: true }).click();
  await page.getByLabel("Üzenet").fill(message);
  await page.getByRole("button", { name: "Küldés" }).click();
}

test("a logged-in player sends a bug report from the sidebar", async ({ browser }) => {
  const { context, page } = await as(browser, PAIRS.p1[0]);
  await visit(page, "/notifications?from=e2e");
  // A dialog over the page (#444): the address doesn't change.
  await page.locator("[data-sidebar=sidebar]").getByRole("button", { name: "Hiba vagy ötlet", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Hiba vagy ötlet" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/notifications\?from=e2e$/);
  // Two choices and one box (#446); what goes along is stored, not listed.
  await expect(dialog).not.toContainText("Ezt küldjük el veled");
  await expect(dialog).toContainText("hello@padelparbaj.hu");
  await send(dialog, "Valami nem működik", BUG);
  await expect(page.getByRole("dialog", { name: "Köszi, megkaptuk!" })).toBeVisible();
  expect(d1(`select kind, page, device, browser, user_id is not null as account from feedback where message = '${BUG}'`)).toEqual([
    { kind: "bug", page: "/notifications", device: "desktop", browser: "Chrome", account: 1 },
  ]);
  await page.getByRole("button", { name: "Bezárom" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/notifications\?from=e2e$/);
  await context.close();
});

test("a visitor sends an idea from a public page's footer; the 31st in an hour is refused", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await visit(page, "/rules");
  await page.getByRole("contentinfo").getByRole("button", { name: "Hiba vagy ötlet" }).click();
  const dialog = page.getByRole("dialog", { name: "Hiba vagy ötlet" });
  await send(dialog, "Ötletem van", IDEA);
  await expect(page.getByRole("dialog", { name: "Köszi, megkaptuk!" })).toBeVisible();
  expect(d1(`select kind, page, user_id from feedback where message = '${IDEA}'`)).toEqual([{ kind: "idea", page: "/rules", user_id: null }]);
  await expect(page).toHaveURL(/\/rules$/);

  // 29 more visitor messages this hour fill the limit of 30.
  const now = Math.floor(Date.now() / 1000);
  const values = Array.from({ length: 29 }, (_, i) => `('idea', 'E2E: kitöltés ${i}', '/', 'desktop', 'Chrome', 'dev', ${now - i})`).join(", ");
  d1Insert(`insert into feedback (kind, message, page, device, browser, app_version, created_at) values ${values}`);
  await visit(page, "/feedback?from=%2Frules");
  await send(page, "Ötletem van", "E2E: harmincegyedik");
  await expect(page.getByRole("alert")).toContainText("Most túl sok üzenet jött");
  await expect(page.getByLabel("Üzenet")).toHaveValue("E2E: harmincegyedik");
  expect(d1(`select count(*) as n from feedback where message = 'E2E: harmincegyedik'`)).toEqual([{ n: 0 }]);
  d1Delete(`delete from feedback where message like 'E2E: kitöltés%'`);
  await context.close();
});

test("the Admin lists, filters, opens, marks done and reopens; a Szervező and a player are refused", async ({ browser }) => {
  const now = Math.floor(Date.now() / 1000);
  d1Insert(`insert into feedback (kind, message, rating, page, device, browser, app_version, created_at) values ('rating', '${RATING}', 4, '/home', 'mobile', 'Safari', 'dev', ${now})`);
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/home");
  // The sidebar's item (the Admin's Kezdőlap lists the pages too).
  await page.getByRole("link", { name: "Visszajelzések" }).first().click();
  await expect(page).toHaveURL(new RegExp(`${LIST}$`));
  const main = content(page);
  const list = main.getByRole("list", { name: "Visszajelzések listája" });
  await expect(list).toContainText(BUG);
  await expect(list).toContainText(PAIRS.p1[0].name);
  await expect(list).toContainText("Vendég");

  // The type filter narrows the list; its count is the rows shown.
  await main.getByRole("navigation", { name: "Típus" }).getByRole("link", { name: /^Hiba/ }).click();
  await expect(page).toHaveURL(new RegExp(`${LIST}\\?type=bug$`));
  await expect(list).toContainText(BUG);
  await expect(list).not.toContainText(IDEA);
  const bugs = Number(d1(`select count(*) as n from feedback where kind = 'bug'`)[0]!.n);
  await expect(main.getByRole("navigation", { name: "Típus" }).getByRole("link", { name: /^Hiba/ })).toHaveText(`Hiba${bugs}`);
  await expect(list.getByRole("listitem")).toHaveCount(bugs);

  // Open it, mark it done, find it under Kész, reopen it.
  await list.getByRole("link", { name: BUG }).click();
  await expect(page.getByRole("heading", { name: /^Hiba #\d+$/, level: 1 })).toBeVisible();
  await expect(main).toContainText(BUG);
  await expect(main).toContainText("/notifications");
  await expect(main).toContainText(PAIRS.p1[0].name);
  await expect(main).not.toContainText("@example.test");
  await main.getByRole("button", { name: "Kész" }).click();
  await expect(main.getByRole("button", { name: "Újranyitom" })).toBeVisible();
  expect(d1(`select done_at is not null as done from feedback where message = '${BUG}'`)).toEqual([{ done: 1 }]);
  await visit(page, `${LIST}?state=done`);
  await expect(list).toContainText(BUG);
  await list.getByRole("link", { name: BUG }).click();
  await main.getByRole("button", { name: "Újranyitom" }).click();
  await expect(main.getByRole("button", { name: "Kész" })).toBeVisible();
  await expect(main).toContainText("Újranyitva");
  expect(d1(`select done_at, reopened_by is not null as reopened from feedback where message = '${BUG}'`)).toEqual([{ done_at: null, reopened: 1 }]);

  // A rating shows its stars and its comment.
  await visit(page, `${LIST}?type=rating`);
  await list.getByRole("link", { name: new RegExp(RATING) }).click();
  await expect(main.getByRole("img", { name: "4 csillag az 5-ből" })).toBeVisible();
  await expect(main).toContainText(RATING);
  await expect(main).toContainText("Vendég");
  await context.close();

  // A Szervező: no menu item, and the page refuses; a player likewise.
  for (const who of [ORGANIZER.email, PAIRS.p1[0]]) {
    const other = await as(browser, who);
    await visit(other.page, "/home");
    await expect(other.page.getByRole("link", { name: "Visszajelzések" })).toHaveCount(0);
    expect((await other.page.goto(LIST))?.status()).toBe(403);
    await expect(other.page.getByText("Ehhez nincs jogod")).toBeVisible();
    await other.context.close();
  }
});

test("a player rates the app with tennis balls from Profil (#446)", async ({ browser }) => {
  const player = PAIRS.p2[0];
  const { context, page } = await as(browser, player);
  await visit(page, "/profile");
  await content(page).getByRole("button", { name: "Értékeld a Padelpárbajt" }).click();
  const dialog = page.getByRole("dialog", { name: "Hogy tetszik a Padelpárbaj?" });
  await expect(dialog.getByRole("button", { name: "Küldés" })).toBeDisabled();
  await dialog.getByRole("radio", { name: /^4 labda/ }).click();
  await expect(dialog).toContainText("Tetszik");
  await dialog.getByLabel("Mit javítanál?").fill(RATING_FROM_PROFILE);
  await dialog.getByRole("button", { name: "Küldés" }).click();
  await expect(page.getByRole("dialog", { name: "Köszi, megkaptuk!" })).toBeVisible();
  expect(d1(`select kind, rating, page from feedback where message = '${RATING_FROM_PROFILE}'`)).toEqual([{ kind: "rating", rating: 4, page: "/profile" }]);
  d1Delete(`delete from feedback where message = '${RATING_FROM_PROFILE}'`);
  await context.close();
});
