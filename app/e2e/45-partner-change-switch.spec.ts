// Walkthrough step 45 (#403, D179): a pair formed by a permanent partner
// change takes the old pair's spot at the round switch. With a change made
// final (a fixture row: the players' steps are spec 44), the Szervező's
// "Előzetes beosztás" on Csoportok shows the new pair, with its players, in
// the old pair's spot and marked "Partnercsere: <távozó> helyett <új
// partner>". The rule itself is unit tested in the rules engine
// (keepSpots). The fixture row is deleted again, so later specs (the round
// switch) see the walkthrough's state. Nothing is sent.
import { expect, test } from "@playwright/test";

import { LEAGUE } from "../app/lib/seed";
import { ORGANIZER, OUTSIDER, as, content, d1, d1Delete, d1Insert, seasonPath, visit } from "./support";

test("45. Előzetes beosztás: the new pair of a partner change in the old pair's spot, marked Partnercsere", async ({ browser }) => {
  // A pair of round 1 in a published group of Mintaváros, with its group.
  const [p] = d1(`select p.id pair_id, s.id season_id, l.id league_id, g.number grp, ua.id a_id, ua.name a_name, ub.id b_id, ub.name b_name
      from group_pairs gp join groups g on g.id = gp.group_id join seasons s on s.id = g.season_id join leagues l on l.id = s.league_id
      join pairs p on p.id = gp.pair_id join users ua on ua.id = p.player_a join users ub on ub.id = p.player_b
      where l.slug = '${LEAGUE.slug}' and g.phase = 1 and g.published_at is not null and gp.withdrawn_at is null and p.status = 'active'
        and not exists (select 1 from partner_changes c where c.pair_id = p.id and c.status in ('open', 'final'))
      order by g.number, gp.seed limit 1`) as {
    pair_id: number;
    season_id: number;
    league_id: number;
    grp: number;
    a_id: string;
    a_name: string;
    b_id: string;
    b_name: string;
  }[];
  expect(p, "a pair of round 1").toBeTruthy();
  const now = Math.floor(Date.now() / 1000);
  d1Insert(
    `insert into partner_changes (league_id, season_id, pair_id, started_by, leaving_id, partner_id, status, starts_phase, answered_at, created_at)
     values (${p!.league_id}, ${p!.season_id}, ${p!.pair_id}, '${p!.a_id}', '${p!.b_id}', '${OUTSIDER.id}', 'final', 2, ${now}, ${now})`,
  );
  try {
    const { context, page } = await as(browser, ORGANIZER.email);
    await visit(page, `${await seasonPath(page)}/groups`);
    const preview = content(page).getByRole("region", { name: "Előzetes beosztás: ha most érne véget a kör" });
    await expect(preview).toBeVisible();
    const text = `Partnercsere: ${p!.b_name} helyett ${OUTSIDER.name}`;
    await expect(preview.getByText(text)).toBeVisible();
    // The new pair's players, and where the old pair comes from.
    const row = preview.getByRole("listitem").filter({ hasText: text });
    await expect(row).toContainText(p!.a_name);
    await expect(row).toContainText(OUTSIDER.name);
    await expect(row).not.toContainText(p!.b_name + " –");
    await expect(row).toContainText(new RegExp(`${p!.grp}\\. csoport, \\d\\. hely`));
    await expect(content(page)).not.toContainText("@example.test");
    await context.close();
  } finally {
    d1Delete(`delete from partner_changes where pair_id = ${p!.pair_id} and partner_id = '${OUTSIDER.id}'`);
  }
});
