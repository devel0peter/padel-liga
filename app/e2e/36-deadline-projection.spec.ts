// Walkthrough step 39 (#362, #363; D162, D163): "Ha most lenne a határidő"
// on the Szervező's Meccsek and "Előzetes beosztás" on Csoportok. The totals
// add up to the list, a count opens the list filtered to those matches, each
// projected match has its line, and Csoportok shows the next round's groups
// read only. Players are refused. Nothing is stored or sent.
import { expect, test, type Locator } from "@playwright/test";

import { ORGANIZER, PAIRS, as, content, d1, seasonPath, visit } from "./support";

const LIST = "/admin/leagues/minta/matches";

async function tileCount(tile: Locator): Promise<number> {
  return Number((await tile.innerText()).match(/(\d+)\s*$/)![1]);
}

test("39. the deadline projection on Meccsek and the next round's preview on Csoportok; players refused", async ({ browser }) => {
  const rowsBefore = d1("select (select count(*) from match_decisions) + (select count(*) from strikes) + (select count(*) from audit_log) as n")[0]!.n;
  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, LIST);
  const main = content(page);
  const section = main.getByRole("region", { name: "Ha most lenne a határidő" });
  await expect(section).toBeVisible();
  await expect(section).toContainText(/ha a határidő \(.+ \d\d:\d\d\) most lenne\./);
  await expect(section).toContainText("A határidő után is felülbírálhatsz bármelyik döntést.");
  await expect(section.getByRole("heading", { name: "2. fekete pont (figyelmeztető e-mail)" })).toBeVisible();
  await expect(section.getByRole("heading", { name: "Kiesnének a körváltáskor (3. fekete pont)" })).toBeVisible();

  // The five tiles add up to the list below.
  const rows = main.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Napló és telefonszámok" }) });
  const total = await rows.count();
  expect(total).toBeGreaterThan(0);
  const tiles = section.getByRole("link");
  await expect(tiles).toHaveCount(5);
  let sum = 0;
  for (const tile of await tiles.all()) sum += await tileCount(tile);
  expect(sum).toBe(total);

  // A tile opens the list filtered to it; each of those matches says what the deadline would do.
  const both = tiles.filter({ hasText: /^Mindkét pár veszít/ });
  const bothCount = await tileCount(both);
  await both.click();
  await expect(page).toHaveURL(/\?deadline=both_lose#meccsek$/);
  await expect(main.getByRole("combobox", { name: "Ha most lenne a határidő" })).toContainText("mindkét pár veszít");
  await expect(rows).toHaveCount(bothCount);
  for (const row of await rows.all()) await expect(row).toContainText("Ha most lenne a határidő: Mindkét pár vereséget kap (0:4, 0:4)");
  await main.getByRole("button", { name: "Szűrők törlése" }).click();
  await expect(rows).toHaveCount(total);
  await expect(main).not.toContainText("@example.test");

  // Csoportok: round 1 is running, so the next round's preview is below its groups.
  await visit(page, `${await seasonPath(page)}/groups`);
  const preview = content(page).getByRole("region", { name: "Előzetes beosztás: ha most érne véget a kör" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("A 2. kör csoportjai, ha az 1. kör most érne véget");
  await expect(preview).toContainText(/\d+ meccs még nem dőlt el|Minden meccs eldőlt\./);
  await expect(preview.getByText(/^\d\. csoport$/).first()).toBeVisible();
  await expect(preview.getByText(/\d\. csoport, \d\. hely/).first()).toBeVisible();
  // Read only: no moves, no publish.
  await expect(preview.getByRole("combobox")).toHaveCount(0);
  await expect(preview.getByRole("button")).toHaveCount(0);
  await expect(content(page)).not.toContainText("@example.test");
  await context.close();

  // Opening the pages stored nothing.
  expect(d1("select (select count(*) from match_decisions) + (select count(*) from strikes) + (select count(*) from audit_log) as n")[0]!.n).toBe(rowsBefore);

  const player = await as(browser, PAIRS.p1[0]);
  expect((await player.page.goto(LIST))?.status()).toBe(403);
  expect((await player.page.goto(`${LIST}?deadline=walkover`))?.status()).toBe(403);
  await player.context.close();
});
