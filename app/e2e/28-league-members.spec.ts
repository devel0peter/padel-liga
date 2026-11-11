// A league's players (D128, #331): the seed's second league, Példaváros, has
// one player, Idegen Ilona, who looks for a partner there. She is on no page
// or count of Mintaváros, and Mintaváros's players are on none of hers; she
// sees only her own league. Read-only; runs on the state the walkthrough left.
import { expect, test } from "@playwright/test";

import { ADMIN, ORGANIZER, OUTSIDER, PAIRS, as, content, visit } from "./support";

test("Mintaváros's Párok and Játékosok hold only its own players", async ({ browser }) => {
  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta/pairs");
  await expect(content(page)).toContainText(PAIRS.p1[0].name);
  await expect(content(page)).not.toContainText(OUTSIDER.name);
  // Párok's old "Nincs párja" is Játékosok's now (#301).
  await visit(page, "/admin/leagues/minta/pairs?entry=no_pair");
  await expect(page).toHaveURL(/\/admin\/leagues\/minta\/players\?filter=no_pair$/);
  await expect(content(page)).not.toContainText(OUTSIDER.name);
  await visit(page, "/admin/leagues/minta/players");
  await expect(content(page)).toContainText(PAIRS.p1[0].name);
  await expect(content(page)).not.toContainText(OUTSIDER.name);
  await context.close();
});

test("Példaváros's Párok and Játékosok hold only her", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  // No pair there yet: Párok has no rows (the players without a pair are on
  // Játékosok, #301).
  await visit(page, "/admin/leagues/pelda/pairs");
  await expect(page.getByRole("table", { name: "Párok listája" })).toHaveCount(0);
  await expect(content(page)).not.toContainText(PAIRS.p1[0].name);
  await visit(page, "/admin/leagues/pelda/players");
  const players = page.getByRole("table", { name: "Játékosok listája" });
  await expect(players.locator("tbody tr")).toHaveCount(1);
  await expect(players).toContainText(OUTSIDER.name);
  await expect(players).toContainText("Párt keres");
  await expect(players.getByRole("row").filter({ hasText: PAIRS.p1[0].name })).toHaveCount(0);
  await context.close();
});

test("she sees her own league only: no Mintaváros season, no league to choose", async ({ browser }) => {
  const { context, page } = await as(browser, OUTSIDER.email);
  await visit(page, "/home");
  await expect(content(page)).not.toContainText("Melyik ligában játszol?");
  await expect(content(page)).not.toContainText("Teszt szezon");
  await expect(content(page).getByText("Hívd meg a párodat")).toBeVisible();
  await visit(page, "/profile");
  await expect(content(page).getByRole("switch", { name: "Párt keresek" })).toBeChecked();
  await expect(content(page)).not.toContainText("Mintaváros");
  await context.close();
});
