// Not a walkthrough step. A cold dev server (CI always, a fresh checkout often)
// transforms each route and optimises its dependencies on the first visit, and
// Vite reloads the page when it finds new ones; that took a minute on a CI
// runner and timed out the first real step. This spec pays that once, with a
// generous timeout: it logs the Admin in (the session is saved for the specs
// after it) and opens the pages the walkthrough uses.
import { expect, test } from "@playwright/test";

import { ADMIN, as, visit } from "./support";

test("warm up the dev server", async ({ browser }) => {
  test.setTimeout(300_000);
  // The public pages first: they load the UI's client dependencies before the login.
  const visitor = await browser.newContext();
  for (const path of ["/login", "/register", "/rules", "/privacy", "/feedback"]) await visit(await visitor.newPage(), path);
  await visitor.close();

  const { context, page } = await as(browser, ADMIN.email);
  for (const path of [
    "/home",
    "/notifications",
    "/admin",
    "/admin/cities",
    "/admin/clubs",
    "/admin/leagues",
    // Meccsek loads the chart library (Recharts, #350): found on a later
    // visit, Vite reloads the page mid-navigation.
    "/admin/leagues/minta/matches",
    "/admin/outbox",
    "/admin/users",
  ]) {
    await visit(page, path);
    await expect(page.locator("body")).toBeVisible();
  }
  await context.close();
});
