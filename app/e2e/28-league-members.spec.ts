// A league's players (D127, #331): the seed's second league, Példaváros, has
// one player, Idegen Ilona, who looks for a partner there. She is on no page
// or count of Mintaváros, and Mintaváros's players are on none of hers; she
// sees only her own league. Read-only; runs on the state the walkthrough left.
import { expect, test } from "@playwright/test";

import { ADMIN, ORGANIZER, OUTSIDER, PAIRS, as, content, visit } from "./support";

test("Mintaváros's Párok and Párkeresők hold only its own players", async ({ browser }) => {
  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta/pairs");
  await expect(content(page)).toContainText(PAIRS.p1[0].name);
  await expect(content(page)).not.toContainText(OUTSIDER.name);
  await visit(page, "/admin/leagues/minta/pairs?entry=no_pair");
  await expect(content(page)).not.toContainText(OUTSIDER.name);
  await visit(page, "/admin/leagues/minta/solos");
  await expect(content(page)).not.toContainText(OUTSIDER.name);
  await context.close();
});

test("Példaváros's Párok and Párkeresők hold only her", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, "/admin/leagues/pelda/pairs");
  const rows = page.getByRole("table", { name: "Párok listája" }).locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(OUTSIDER.name);
  await expect(content(page)).not.toContainText(PAIRS.p1[0].name);
  await visit(page, "/admin/leagues/pelda/solos");
  const registered = page.getByRole("region", { name: "Regisztráltak", exact: true });
  await expect(registered).toContainText(OUTSIDER.name);
  await expect(registered.getByRole("row").filter({ hasText: PAIRS.p1[0].name })).toHaveCount(0);
  await context.close();
});

test("she sees her own league only: no Mintaváros season, no league to choose", async ({ browser }) => {
  const { context, page } = await as(browser, OUTSIDER.email);
  await visit(page, "/home");
  await expect(content(page)).not.toContainText("Melyik ligában játszol?");
  await expect(content(page)).not.toContainText("Teszt szezon");
  await expect(content(page).getByText("Hívd meg a párodat")).toBeVisible();
  await visit(page, "/pair");
  await expect(content(page).getByRole("switch", { name: "Párt keresek" })).toBeChecked();
  await expect(content(page)).not.toContainText("Mintaváros");
  await context.close();
});
