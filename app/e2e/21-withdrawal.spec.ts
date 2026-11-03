// A pair withdrawn mid-round (#34, D87) and what taken-out players see
// (#174): the Szervező takes a pair that plays in the running round out of
// the season on "Párok", with a reason. Its matches leave the group's table,
// the other pairs see it marked, and both players read on Párom that the
// organizer took them out and is the one to ask. No email goes out. Runs
// last: it changes a published group.
import { expect, test, type Page } from "@playwright/test";

import { GROUP_PAIRS, ORGANIZER, PAIRS, as, content, d1, visit, type Player } from "./support";

const REASON = "Sérülés, a kör végéig nem tudnak játszani.";
const row = (page: Page, a: Player, b: Player) =>
  page.getByRole("row").filter({ hasText: a.name }).filter({ hasText: b.name });

test("Kivétel a szezonból mid-round: a reason, the table without the pair, Párom says who to ask", async ({ browser }) => {
  const [x, y] = PAIRS.p5;
  // The other pairs of p5's group, from the suite's D1.
  const mates = d1(`select u.email from group_pairs gp join group_pairs mine on mine.group_id = gp.group_id
      join pairs p on p.id = mine.pair_id join users ux on ux.id = p.player_a
      join pairs o on o.id = gp.pair_id join users u on u.id = o.player_a
      where ux.email = '${x.email}' and gp.pair_id <> mine.pair_id`).map((r) => r.email as string);
  const others = GROUP_PAIRS.filter((p) => mates.includes(p[0].email));
  expect(others.length).toBeGreaterThan(0);
  const emailsBefore = d1("select count(*) as n from email_messages")[0]!.n;

  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, `/admin/leagues/minta/pairs?q=${encodeURIComponent(x.name)}`);
  const pair = row(page, x, y);
  await expect(pair).toContainText(/Nevezés \(.+\): Nevezett/);
  await pair.getByRole("button", { name: "Kivétel a szezonból" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Visszaléptetés kör közben: ${x.name} – ${y.name}`);
  await expect(dialog).toContainText("minden meccse kikerül a csoport tabellájából");
  await expect(dialog).toContainText("e-mailt nem");
  await expect(dialog.getByRole("button", { name: "Visszaléptetés" })).toBeDisabled();
  await dialog.getByLabel("Indok").fill(REASON);
  await dialog.getByRole("button", { name: "Visszaléptetés" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(pair).toContainText(/Nevezés \(.+\): Visszavonva/);
  // Free again: the pair buttons work, and it can be entered for the next round.
  await expect(pair.getByRole("button", { name: "Felbontás" })).toBeEnabled();
  await expect(pair.getByRole("button", { name: "Benevezés" })).toBeVisible();

  // #174: the filter option and the badge use the same word.
  await visit(page, "/admin/leagues/minta/pairs?entry=withdrawn");
  await expect(content(page).getByRole("link", { name: /^Visszavonva/ })).toBeVisible();
  await expect(row(page, x, y)).toContainText("Visszavonva");
  await context.close();

  // Both players: Párom names the organizer as the one to ask, no "Nevezünk".
  for (const player of [x, y]) {
    const p = await as(browser, player);
    await visit(p.page, "/pair");
    await expect(content(p.page)).toContainText("A szervező kivett titeket a szezonból.");
    await expect(content(p.page)).toContainText("szóljatok neki");
    await expect(content(p.page).getByRole("button", { name: "Nevezünk" })).toHaveCount(0);
    await visit(p.page, "/notifications");
    await expect(content(p.page)).toContainText("A szervező visszaléptetett titeket a körből");
    await expect(content(p.page)).toContainText(REASON);
    await p.context.close();
  }

  // A pair of the same group: the withdrawn pair struck through on Kezdőlap;
  // the notice without the reason.
  const mate = await as(browser, others[0]![0]);
  await visit(mate.page, "/home");
  const items = content(mate.page).getByRole("listitem").filter({ hasText: x.name });
  await expect(items.filter({ hasText: "(visszalépett)" })).toHaveCount(1);
  await expect(items.filter({ hasText: "visszalépett a körből: ez a meccs elmarad" })).toHaveCount(1);
  await visit(mate.page, "/notifications");
  await expect(content(mate.page)).toContainText("Visszalépett egy pár a csoportodból");
  await expect(content(mate.page)).not.toContainText(REASON);
  await mate.context.close();

  // The public table: the pair is named below its group, not in the table.
  const visitor = await browser.newPage();
  await visit(visitor, "/league/minta");
  await expect(content(visitor)).toContainText(`Visszalépett: ${x.name} – ${y.name}. A meccseik nem számítanak.`);
  await expect(content(visitor).getByRole("row").filter({ hasText: x.name })).toHaveCount(0);
  await expect(content(visitor)).not.toContainText(REASON);
  await visitor.close();

  expect(d1("select count(*) as n from email_messages")[0]!.n).toBe(emailsBefore);
});
