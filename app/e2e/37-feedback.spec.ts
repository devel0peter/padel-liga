// Feedback (spec 19, D94): a logged-in player sends a bug report from the
// sidebar and a visitor an idea from a public page's footer (#240, the suite
// has no Turnstile key, so the bot check passes); the visitors' hourly limit
// refuses the 31st message and keeps the text. Runs after the walkthrough;
// removes the rows it made.
import { expect, test, type Page } from "@playwright/test";

import { PAIRS, as, d1, d1Delete, d1Insert, visit } from "./support";

const BUG = "E2E: a Tabella nem tölt be";
const IDEA = "E2E: legyen sötét mód";

async function send(page: Page, kind: string, message: string) {
  await page.getByRole("radio", { name: kind, exact: true }).click();
  await page.getByLabel("Üzenet").fill(message);
  await page.getByRole("button", { name: "Küldés" }).click();
}

test.afterAll(() => {
  d1Delete(`delete from feedback where message like 'E2E:%'`);
});

test("a logged-in player sends a bug report from the sidebar", async ({ browser }) => {
  const player = PAIRS.p1[0];
  const { context, page } = await as(browser, player);
  await visit(page, "/notifications?from=e2e");
  await page.getByRole("link", { name: "Visszajelzés", exact: true }).click();
  await expect(page).toHaveURL(/\/feedback\?from=%2Fnotifications%3Ffrom%3De2e$/);
  await expect(page.getByRole("heading", { name: "Visszajelzés", level: 1 })).toBeVisible();
  // What goes along, listed above the button: the page (path only), the account.
  const main = page.getByRole("main");
  await expect(main).toContainText("Ezt küldjük el veled:");
  await expect(main).toContainText("/notifications");
  await expect(main).not.toContainText("from=e2e");
  await expect(main).toContainText(player.name);
  await expect(main).toContainText("hello@padelparbaj.hu");
  await send(page, "Hiba", BUG);
  await expect(page.getByRole("heading", { name: "Köszi, megkaptuk!" })).toBeVisible();
  expect(d1(`select kind, page, device, browser, user_id is not null as account from feedback where message = '${BUG}'`)).toEqual([
    { kind: "bug", page: "/notifications", device: "desktop", browser: "Chrome", account: 1 },
  ]);
  await page.getByRole("link", { name: "Vissza oda, ahonnan jöttél" }).click();
  await expect(page).toHaveURL(/\/notifications\?from=e2e$/);
  await context.close();
});

test("a visitor sends an idea from a public page's footer; the 31st in an hour is refused", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await visit(page, "/rules");
  await page.getByRole("contentinfo").getByRole("link", { name: "Visszajelzés" }).click();
  await expect(page).toHaveURL(/\/feedback\?from=%2Frules$/);
  await expect(page.getByRole("main")).not.toContainText("Fiók");
  await send(page, "Ötlet", IDEA);
  await expect(page.getByRole("heading", { name: "Köszi, megkaptuk!" })).toBeVisible();
  expect(d1(`select kind, page, user_id from feedback where message = '${IDEA}'`)).toEqual([{ kind: "idea", page: "/rules", user_id: null }]);
  await expect(page.getByRole("link", { name: "Vissza oda, ahonnan jöttél" })).toHaveAttribute("href", "/rules");

  // 29 more visitor messages this hour fill the limit of 30.
  const now = Math.floor(Date.now() / 1000);
  const values = Array.from({ length: 29 }, (_, i) => `('idea', 'E2E: kitöltés ${i}', '/', 'desktop', 'Chrome', 'dev', ${now - i})`).join(", ");
  d1Insert(`insert into feedback (kind, message, page, device, browser, app_version, created_at) values ${values}`);
  await visit(page, "/feedback?from=%2Frules");
  await send(page, "Egyéb", "E2E: harmincegyedik");
  await expect(page.getByRole("alert")).toContainText("Most túl sok üzenet jött");
  await expect(page.getByLabel("Üzenet")).toHaveValue("E2E: harmincegyedik");
  expect(d1(`select count(*) as n from feedback where message = 'E2E: harmincegyedik'`)).toEqual([{ n: 0 }]);
  await context.close();
});
