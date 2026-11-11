// The organizer extends the running round (#356, D151): on Szezonok, round 1
// (published in 06-groups, its deadline still ahead) gets a new deadline two
// Sundays later. The confirmation shows the old and new deadline and how much
// later rounds 2–4 start; confirming moves round 1's and its matches'
// deadline and rounds 2–4 in the suite's D1, writes one audit entry, and
// gives every player of the round a notice and an email. A player gets 403.
// Puts every date back at the end, so 99-round-switch sees the seeded
// calendar.
import { expect, test } from "@playwright/test";

import { ORGANIZER, PAIRS, as, content, d1, d1Delete, d1Update, seasonPath, visit } from "./support";

const WEEK = 7 * 86400;

test("Szezonok: round 1 two weeks longer, rounds 2–4 two weeks later; a player can't", async ({ browser }) => {
  const { context, page } = await as(browser, ORGANIZER.email);
  const season = await seasonPath(page);
  const id = Number(/\/seasons\/(\d+)$/.exec(season)![1]);
  const phases = () => d1(`select number, starts_at, deadline from season_phases where season_id = ${id} order by number`) as { number: number; starts_at: number; deadline: number }[];
  const roundOne = `select m.id from matches m join groups g on g.id = m.group_id where g.season_id = ${id} and g.phase = 1`;
  const before = phases();

  try {
    await visit(page, "/admin/leagues/minta/seasons");
    await page.getByRole("button", { name: "1. kör meghosszabbítása" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Meghosszabbítod az 1. kört?");
    await expect(dialog).toContainText("A 2–4. kör 1 héttel később kezdődik.");
    await test.info().attach("extend dialog", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

    // Two Sundays later: the lines follow the choice.
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: /\(\+2 hét\)$/ }).click();
    await expect(dialog).toContainText("A 2–4. kör 2 héttel később kezdődik.");
    await expect(dialog).toContainText("Az 1. kör határideje:");
    await dialog.getByRole("button", { name: "Meghosszabbítom" }).click();
    await expect(page.getByRole("status")).toContainText("Meghosszabbítottad a kört. Új határidő:");

    const after = phases();
    expect(after[0]).toEqual({ ...before[0], deadline: before[0]!.deadline + 2 * WEEK });
    for (const n of [1, 2, 3]) {
      expect(after[n]!.starts_at - before[n]!.starts_at).toBe(2 * WEEK);
      expect(after[n]!.deadline - before[n]!.deadline).toBe(2 * WEEK);
    }
    expect(d1(`select distinct deadline from matches where id in (${roundOne})`)).toEqual([{ deadline: after[0]!.deadline }]);
    expect(d1(`select count(*) as n from audit_log where action = 'phase.extend' and target = 'season:${id}'`)).toEqual([{ n: 1 }]);
    // Every player of the round: a notice, and an email from the queue.
    const players = `select p.player_a from group_pairs gp join groups g on g.id = gp.group_id join pairs p on p.id = gp.pair_id
      where g.season_id = ${id} and g.phase = 1 and gp.withdrawn_at is null union select p.player_b from group_pairs gp join groups g on g.id = gp.group_id
      join pairs p on p.id = gp.pair_id where g.season_id = ${id} and g.phase = 1 and gp.withdrawn_at is null`;
    const notified = d1(`select count(distinct user_id) as n from notifications where kind = 'round_extended'`)[0]!.n;
    expect(notified).toBeGreaterThan(0);
    expect(notified).toBe(d1(`select count(*) as n from users where deleted_at is null and id in (${players})`)[0]!.n);
    expect(d1(`select count(*) as n from email_messages where kind = 'round_extended'`)[0]!.n).toBeGreaterThan(0);
    const [notice] = d1(`select body from notifications where kind = 'round_extended' limit 1`);
    expect(notice!.body).toMatch(/^Meghosszabbítottuk az 1\. kört: új határidő .+, vasárnap 23:59\./);

    // Still running: it can be extended again.
    await expect(content(page).getByRole("button", { name: "1. kör meghosszabbítása" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await test.info().attach("Szezonok after, 390px", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.setViewportSize({ width: 1280, height: 800 });

    // A player can't.
    const player = await as(browser, PAIRS.p1[0]);
    const refused = await player.page.request.post("/admin/leagues/minta/seasons", {
      form: { intent: "extend", id: String(id), phase: "1", deadline: "2099-01-04" },
    });
    expect(refused.status()).toBe(403);
    expect(phases()).toEqual(after);
    await player.context.close();
  } finally {
    // The seeded calendar back for 99-round-switch.
    for (const p of before) d1Update(`update season_phases set starts_at = ${p.starts_at}, deadline = ${p.deadline} where season_id = ${id} and number = ${p.number}`);
    d1Update(`update matches set deadline = ${before[0]!.deadline} where id in (${roundOne})`);
    d1Delete(`delete from notifications where kind = 'round_extended'`);
    await context.close();
  }
});
