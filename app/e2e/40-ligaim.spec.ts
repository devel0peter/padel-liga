// Walkthrough step 41 (#394, D174): Ligáim, the player's leagues. Anna (a
// pair in a published group of Mintaváros) opens it from the sidebar and the
// phone's bottom bar and sees her league's card with the Tabella's numbers;
// Ilona (Példaváros, no pair) sees "Nincs párod"; another league's address is
// 404; an account in no league gets the join card. Read-only: the one row
// taken away for the last case is put back. No email.
import { expect, test } from "@playwright/test";

import { OUTSIDER, PAIRS, as, content, d1, d1Delete, d1Insert, visit } from "./support";

const anna = PAIRS.p1[0];
const partner = PAIRS.p1[1];

test("41. Ligáim in the sidebar and on the phone bar; the card with the round, the partner, the place and the Tabella's numbers", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  await visit(page, "/home");
  await page.locator("[data-sidebar=sidebar]").getByRole("link", { name: "Ligáim", exact: true }).click();
  await expect(page).toHaveURL(/\/leagues$/);
  const main = content(page);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Ligáim");

  // One league: its card alone, no list around it.
  await expect(main.getByRole("list", { name: "Ligáim" })).toHaveCount(0);
  const card = main.getByRole("region", { name: "Padelpárbaj Mintaváros" });
  await expect(card.getByRole("heading", { name: "Padelpárbaj Mintaváros" })).toBeVisible();
  // Round 1 with its dates and deadline once it runs; before its first day, when it starts.
  await expect(card.getByRole("region", { name: "Kör", exact: true })).toContainText(/1\. kör: .+ – .+Határidő: .+ \d\d:\d\d|Az 1\. kör .+ indul\./);
  await expect(card.getByRole("region", { name: "Párod" })).toHaveText(`Párod${partner.name}`);
  await expect(card.getByRole("region", { name: "Helyetek" })).toContainText(/Az 1\. csoportban vagytok/);
  const summary = card.getByRole("region", { name: "A liga" });
  await expect(summary).toContainText(/Lejátszott meccsek: \d+ \/ \d+/);
  await expect(card.getByRole("region", { name: "A szezonod" })).toContainText("Élő-pontod");
  await expect(card.getByRole("link", { name: "Szabályzat" })).toHaveAttribute("href", "/rules");
  // No email address or phone number anywhere on the page.
  await expect(main).not.toContainText("@");
  await expect(main).not.toContainText(/\+36|\d{2} \d{3} \d{4}/);

  // The summary is the Tabella's: its groups and its pairs.
  const text = (await summary.textContent()) ?? "";
  const [, round, pairs, groups] = /(\d+)\. kör: (\d+) pár, (\d+) csoport/.exec(text)!;
  await card.getByRole("link", { name: "Tabella" }).click();
  await expect(page).toHaveURL(/\/league\/minta$/);
  const tables = content(page).getByRole("table", { name: /^\d+\. csoport tabellája$/ });
  await expect(tables).toHaveCount(Number(groups));
  let rows = 0;
  for (const table of await tables.all()) rows += (await table.getByRole("row").count()) - 1;
  expect(rows).toBe(Number(pairs));
  await expect(content(page)).toContainText(`${round}. kör`);

  // The phone's bottom bar: Kezdőlap, Tabella, Ligáim, Értesítések, Profil; no sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  const bar = page.getByRole("navigation", { name: "Fő menü" });
  // Értesítések carries the unread count when there is one.
  await expect(bar.getByRole("link")).toHaveText(["Kezdőlap", "Tabella", "Ligáim", /^Értesítések(\d+\+?)?$/, /Profil$/]);
  await bar.getByRole("link", { name: "Ligáim" }).click();
  await expect(page).toHaveURL(/\/leagues$/);
  await expect(bar.getByRole("link", { name: "Ligáim" })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth")).toBeLessThanOrEqual(0);

  // Her league's own address shows the same card; another league's is 404.
  await visit(page, "/leagues/minta");
  await expect(content(page).getByRole("region", { name: "Padelpárbaj Mintaváros" })).toBeVisible();
  const response = await page.goto("/leagues/pelda");
  expect(response?.status()).toBe(404);
  await context.close();
});

test("41. a player without a pair sees Nincs párod and the way to invite one", async ({ browser }) => {
  const { context, page } = await as(browser, OUTSIDER.email);
  await visit(page, "/leagues");
  const card = content(page).getByRole("region", { name: "Padelpárbaj Példaváros" });
  await expect(card.getByRole("region", { name: "Párod" })).toContainText("Nincs párod.");
  await expect(card.getByRole("link", { name: "Hívd meg a párodat" })).toHaveAttribute("href", "/profile#parod");
  await expect(content(page)).not.toContainText("@");
  await context.close();
});

test("41. a player in no league sees the join card", async ({ browser }) => {
  const [{ id }] = d1(`select id from users where email = '${OUTSIDER.email}'`) as { id: string }[];
  const kept = d1(`select league_id, source, joined_at from league_members where user_id = '${id}'`) as { league_id: number; source: string; joined_at: number }[];
  d1Delete(`delete from league_members where user_id = '${id}'`);
  try {
    const { context, page } = await as(browser, OUTSIDER.email);
    await visit(page, "/leagues");
    await expect(content(page).getByRole("heading", { name: "Melyik ligában játszol?" })).toBeVisible();
    await expect(content(page).getByRole("button", { name: "Csatlakozom" }).first()).toBeVisible();
    await context.close();
  } finally {
    for (const r of kept)
      d1Insert(`insert or ignore into league_members (league_id, user_id, source, joined_at) values (${r.league_id}, '${id}', '${r.source}', ${r.joined_at})`);
  }
});
