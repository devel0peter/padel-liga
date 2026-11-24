// The round switch on Csoportok (#12, #35, D107): once round 1's deadline has
// passed and its matches are settled, the organizer makes round 2's draft,
// sees where each pair comes from and who leaves, can't publish while a
// round-1 result is disputed, and then publishes round 2 (the matches and
// the new-round emails, on real D1). The suite can't wait three weeks, so
// the spec moves round 1's deadline into the past and settles its matches
// in the suite's D1 (d1Update). Then a round-2 result in sets to 6 (#396).
// Runs LAST and leaves round 2 published (one result recorded) and
// round 1 settled: a later spec must take a lower number.
import { expect, test } from "@playwright/test";

import { ORGANIZER, as, content, d1, d1Update, seasonPath, visit } from "./support";

const won = `'{"kind":"played","score":{"sets":[[4,1],[4,1]]}}'`;

test("round 2: draft, the dispute that blocks publishing, then Közzététel", async ({ browser }) => {
  const { context, page } = await as(browser, ORGANIZER.email);
  const season = await seasonPath(page);
  const id = Number(/\/seasons\/(\d+)$/.exec(season)![1]);
  const roundOne = `select m.id from matches m join groups g on g.id = m.group_id where g.season_id = ${id} and g.phase = 1`;

  // Round 1 is over: its deadline an hour ago, every match settled, one of
  // them disputed.
  d1Update(`update season_phases set deadline = ${Math.floor(Date.now() / 1000) - 3600} where season_id = ${id} and number = 1`);
  d1Update(`update matches set status = 'final', outcome = ${won} where status <> 'final' and id in (${roundOne})`);
  const disputed = d1(`${roundOne} and not exists (select 1 from group_pairs gp where gp.group_id = m.group_id
      and gp.pair_id in (m.pair_a, m.pair_b) and gp.withdrawn_at is not null) order by m.id limit 1`)[0]!.id as number;
  d1Update(`update matches set status = 'disputed', outcome = null where id = ${disputed}`);

  // Csoportok now shows round 2, with nothing drafted yet (the cron would
  // have made it on Monday morning).
  await visit(page, `${season}/groups`);
  await expect(page.getByRole("navigation", { name: "Körök" }).getByRole("link", { name: "2. kör" })).toHaveAttribute("aria-current", "page");
  await expect(content(page)).toContainText("Még nincs tervezet.");
  await page.getByRole("button", { name: "Tervezet készítése" }).click();
  await expect(page.getByRole("status")).toContainText("Újraszámoltuk a tervezetet");

  // Where each pair comes from; the pair withdrawn in round 1 (21-withdrawal)
  // leaves; the pair entered late (07-late-entry) is new.
  await expect(content(page).getByText(/\d\. csoport, \d\. hely/).first()).toBeVisible();
  await expect(content(page).getByText("Új pár")).toHaveCount(1);
  await expect(content(page)).toContainText("Kimaradnak");
  await expect(content(page)).toContainText("visszalépett a kör közben");

  // The disputed result blocks publishing and links to the match.
  const block = page.getByRole("alert").filter({ hasText: "Közzététel előtt döntsd el ezeket:" });
  await expect(block.getByRole("link")).toHaveAttribute("href", `/admin/leagues/minta/matches/${disputed}/decide`);
  await expect(page.getByRole("button", { name: "Közzététel" })).toBeDisabled();
  await test.info().attach("round 2 draft, disputed", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(content(page)).toContainText("Kimaradnak");
  await test.info().attach("round 2 draft, 390px", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.setViewportSize({ width: 1280, height: 800 });

  // Settled: rebuilt from the final tables, nothing blocks it.
  d1Update(`update matches set status = 'final', outcome = ${won} where id = ${disputed}`);
  await visit(page, `${season}/groups?phase=2`);
  await expect(block).toHaveCount(0);
  await page.getByRole("button", { name: "Tervezet újraszámolása" }).click();
  await expect(page.getByRole("status")).toContainText("Újraszámoltuk a tervezetet");
  const outdated = page.getByRole("alert").filter({ hasText: "Előbb számold újra a tervezetet." });
  await expect(outdated).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Közzététel" })).toBeEnabled();

  // A change the draft came from (here the new pair taken out of the
  // season) makes it outdated: no Közzététel until a rebuild (D107e). Put
  // back, the draft is current again.
  const late = d1(`select id from season_entries where season_id = ${id} and joins_phase = 2 and status = 'approved'`)[0]!.id as number;
  d1Update(`update season_entries set status = 'withdrawn' where id = ${late}`);
  await visit(page, `${season}/groups?phase=2`);
  await expect(outdated).toBeVisible();
  await expect(page.getByRole("button", { name: "Közzététel" })).toBeDisabled();
  d1Update(`update season_entries set status = 'approved' where id = ${late}`);
  await visit(page, `${season}/groups?phase=2`);
  await expect(outdated).toHaveCount(0);
  await page.getByRole("button", { name: "Közzététel" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Közzététel" }).click();
  await expect(page.getByRole("status")).toContainText("Közzétetted a csoportokat.");
  await expect(content(page)).toContainText("A csoportok már nem módosíthatók.");
  await expect(page.getByRole("button", { name: "Tervezet újraszámolása" })).toHaveCount(0);

  const roundTwo = d1(`select count(*) as n, count(distinct m.deadline) as d from matches m join groups g on g.id = m.group_id
      where g.season_id = ${id} and g.phase = 2 and g.published_at is not null`)[0]!;
  expect(Number(roundTwo.n)).toBeGreaterThan(0);
  expect(roundTwo.d).toBe(1);
  // Round 1 stays as it was, one link away.
  await page.getByRole("link", { name: "1. kör" }).click();
  await expect(content(page)).toContainText("az 1. kör csoportjai");
  await context.close();
});

// Round 2 plays sets to 6 (#396, D173): its result form says so, refuses a
// short-set score and takes 6:4 7:6. Round 1 (above) kept short sets.
test("round 2: sets to 6 on the result form", async ({ browser }) => {
  const [match] = d1(`select m.id, ua.email from matches m join groups g on g.id = m.group_id
      join pairs pa on pa.id = m.pair_a join users ua on ua.id = pa.player_a
      where g.phase = 2 and g.published_at is not null order by m.id limit 1`) as { id: number; email: string }[];
  const { context, page } = await as(browser, match!.email);
  await visit(page, `/matches/${match!.id}`);
  const form = content(page).locator("form").filter({ has: page.getByRole("button", { name: "Rögzítem az eredményt" }) });
  // Folded until a fixed time has started (D133); the venue is asked while the match has none (D146).
  const fill = async (sets: [string, string][]) => {
    const fold = content(page).getByText("Már lejátszottátok? Írjátok be az eredményt");
    if (!(await form.isVisible())) await fold.click();
    await expect(form).toContainText("egy szett 6 nyert játékig (7:5, vagy tie-break után 7:6)");
    const venue = form.getByRole("combobox", { name: "Hol játszottatok?" });
    if (await venue.isVisible()) {
      await venue.click();
      await page.getByRole("option", { name: "Minta Padel Aréna" }).click();
    }
    for (const [i, [us, them]] of sets.entries()) {
      await form.getByLabel(`${i + 1}. szett, Ti`).fill(us);
      await form.getByLabel(`${i + 1}. szett, Ők`).fill(them);
    }
    await page.getByRole("button", { name: "Rögzítem az eredményt" }).click();
  };
  await fill([
    ["4", "2"],
    ["4", "1"],
  ]);
  await expect(content(page).getByRole("alert")).toContainText("1. szett: 4:2 nem lehet. Lehet 6:0, 6:1, 6:2, 6:3, 6:4, 7:5 vagy (tie-break után) 7:6.");
  await fill([
    ["6", "4"],
    ["7", "6"],
  ]);
  await expect(content(page).getByRole("status").filter({ hasText: "Rögzítettük. A másik pár megerősíti." })).toBeVisible();
  await context.close();
});
