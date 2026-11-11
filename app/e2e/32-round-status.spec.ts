// Walkthrough step 38 (#350, D153): "A kör állása" on top of the Szervező's
// Meccsek. The totals add up to the list below, the withdrawn pair's matches
// (21-withdrawal) are counted apart, the counts and weeks open the list
// filtered, the burn-down draws its lines, and Áttekintés has the one-line
// summary linking to it. Players are refused. Read-only; no email.
import { expect, test, type Locator } from "@playwright/test";

import { ORGANIZER, PAIRS, as, content, d1, visit } from "./support";

const LIST = "/admin/leagues/minta/matches";

// The number in a count tile ("Lejátszva 4").
async function tileCount(tile: Locator): Promise<number> {
  return Number((await tile.innerText()).match(/(\d+)\s*$/)![1]);
}

test("38. A kör állása: totals, filtered links, burn-down and the Áttekintés line; players refused", async ({ browser }) => {
  // Matches of a pair withdrawn mid-round (D87): never in the totals.
  const voided = Number(
    d1(
      `select count(distinct m.id) as n from matches m join groups g on g.id = m.group_id
       join seasons s on s.id = g.season_id join leagues l on l.id = s.league_id
       join season_phases sp on sp.season_id = g.season_id and sp.number = g.phase
       join group_pairs gp on gp.group_id = m.group_id and gp.pair_id in (m.pair_a, m.pair_b)
       where l.slug = 'minta' and g.published_at is not null and sp.deadline >= strftime('%s', 'now')
       and gp.withdrawn_at is not null`,
    )[0]!.n,
  );

  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta");
  const running = content(page).getByRole("region", { name: "A futó kör" });
  await expect(running).toContainText(/Lejátszva \d+\/\d+ \(\d+(,\d)?%\) · (még \d+ nap|ma a határidő) · (Jó ütemben|Lemaradás|Még korai becsülni)/);
  await running.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`${LIST}#allapot$`));

  const main = content(page);
  const section = main.getByRole("region", { name: "A kör állása" });
  await expect(section).toBeVisible();
  const rows = main.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Napló és telefonszámok" }) });
  const total = await rows.count();
  expect(total).toBeGreaterThan(0);
  await expect(section).toContainText(`Az állapotok összege ${total} meccs`);
  await expect(section).toContainText(new RegExp(`Lejátszva \\d+/${total} `));
  await expect(section.getByText("Nem számít (visszalépés)").locator("..")).toContainText(String(voided));
  // One of the three verdicts.
  await expect(section).toContainText(/Még korai becsülni\.|Jó ütemben: |Lemaradás: /);

  // The status tiles add up to the list.
  const tiles = section.getByRole("link").filter({ hasText: /^(Egyeztetésre vár|Ajánlat|Megbeszélt|Lefixálva|Eredmény|Vitatott|Lejátszva)/ });
  await expect(tiles).toHaveCount(7);
  let sum = 0;
  for (const tile of await tiles.all()) sum += await tileCount(tile);
  expect(sum).toBe(total);

  // The burn-down: its lines in the legend and the weeks marked. The suite's
  // round 1 starts after today (results are recorded before it), so only the
  // ideal line has points yet; the actual lines fill from the first day.
  const chart = section.getByRole("img", { name: "A kör meccseinek alakulása naponta" });
  await expect(chart).toBeVisible();
  for (const label of ["Hátralévő meccsek", "Még nincs fix időpont", "Ideális"]) await expect(chart).toContainText(label);
  await expect(chart).toContainText("1. hét");

  // A status tile opens the list filtered to it.
  const pending = tiles.filter({ hasText: /^Egyeztetésre vár/ });
  const pendingCount = await tileCount(pending);
  await pending.click();
  await expect(page).toHaveURL(/\?status=to_schedule#meccsek$/);
  await expect(rows).toHaveCount(pendingCount);

  // A week opens the list filtered to that week (?week=, #350).
  await visit(page, LIST);
  const week1 = section.getByRole("row").filter({ has: page.getByRole("link", { name: "1. hét" }) });
  const week1Total = Number((await week1.getByRole("cell").nth(1).innerText()).split("/")[1]);
  await week1.getByRole("link", { name: "1. hét" }).click();
  await expect(page).toHaveURL(/\?week=1#meccsek$/);
  await expect(main.getByRole("combobox", { name: "Hét" })).toContainText("1. hét");
  await expect(rows).toHaveCount(week1Total);
  await main.getByRole("button", { name: "Szűrők törlése" }).click();
  await expect(rows).toHaveCount(total);
  await expect(main).not.toContainText("@example.test");
  await context.close();

  // A player: refused, as before.
  const player = await as(browser, PAIRS.p1[0]);
  expect((await player.page.goto(LIST))?.status()).toBe(403);
  expect((await player.page.goto("/admin/leagues/minta"))?.status()).toBe(403);
  await player.context.close();
});
