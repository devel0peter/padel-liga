// Walkthrough step 44 (#402, D178): a permanent partner change. A player of a
// pair in the running round names a new partner by name on Ligáim, the new
// partner accepts there, and the leaving player is marked absent on the
// pair's remaining matches with the new partner named on the match page.
// The new partner and the leaving player each get one email (printed by the
// dev server, never sent). The Szervező undoes it on Párok, which takes the
// marks away again, so later specs see the walkthrough's state. Idegen Ilona
// (a player of the other league, no pair) joins Mintaváros for the spec and
// leaves it at the end.
import { expect, test } from "@playwright/test";

import { LEAGUE } from "../app/lib/seed";
import { ORGANIZER, OUTSIDER, as, content, d1, d1Delete, d1Insert, logOffset, visit, waitForEmails } from "./support";

// A pair of Mintaváros with an open match of the running round that counts
// and has no marks yet, and that match.
function runningPair() {
  const [m] = d1(`select m.id, p.id pair_id, ua.email starter, ua.name starter_name, ub.id leaving_id, ub.name leaving
      from matches m join groups g on g.id = m.group_id join seasons s on s.id = g.season_id join leagues l on l.id = s.league_id
      join pairs p on p.id = m.pair_a join users ua on ua.id = p.player_a join users ub on ub.id = p.player_b
      where l.slug = '${LEAGUE.slug}' and m.status = 'open' and m.deadline > unixepoch() and p.status = 'active'
        and not exists (select 1 from group_pairs gp where gp.group_id = m.group_id and gp.pair_id in (m.pair_a, m.pair_b) and gp.withdrawn_at is not null)
        and not exists (select 1 from match_absences x where x.match_id = m.id)
        and not exists (select 1 from partner_changes c where c.pair_id = p.id and c.status in ('open', 'final'))
      order by m.id limit 1`);
  expect(m, "an open match of a pair in the running round").toBeTruthy();
  return m as { id: number; pair_id: number; starter: string; starter_name: string; leaving_id: string; leaving: string };
}

test("44. Állandó partnercsere: asked on Ligáim, accepted, the new partner plays the rest of the round; the Szervező undoes it", async ({ browser }) => {
  const m = runningPair();
  const [{ id: leagueId }] = d1(`select id from leagues where slug = '${LEAGUE.slug}'`) as { id: number }[];
  d1Insert(`insert or ignore into league_members (league_id, user_id, source) values (${leagueId}, '${OUTSIDER.id}', 'chosen')`);
  try {
    const offset = logOffset();

    // The player picks the new partner by name on the league's card.
    const starter = await as(browser, m.starter);
    await visit(starter.page, `/leagues/${LEAGUE.slug}`);
    const section = content(starter.page).getByRole("region", { name: "Állandó partnercsere" });
    await expect(section).toContainText("új partnerrel folytathatod a helyeteken");
    await section.getByRole("combobox", { name: "Új partner" }).click();
    await starter.page.getByRole("option", { name: OUTSIDER.name }).click();
    await section.getByRole("button", { name: "Kérés küldése" }).click();
    await expect(section).toContainText("Elküldtük.");
    await expect(section).toContainText(`Elküldted ${OUTSIDER.name} részére.`);
    await expect(content(starter.page)).not.toContainText("@");

    // The new partner: one email, and the answer on Ligáim.
    const [asked] = await waitForEmails(offset, 1, (e) => e.to === OUTSIDER.email && /állandó partnernek hív/.test(e.subject));
    expect(asked!.text).toContain(`/leagues/${LEAGUE.slug}`);
    const partner = await as(browser, OUTSIDER.email);
    await visit(partner.page, `/leagues/${LEAGUE.slug}`);
    const theirs = content(partner.page).getByRole("region", { name: "Állandó partnercsere" });
    await expect(theirs).toContainText(`${m.starter_name} állandó partnernek hív ${m.leaving} helyett.`);
    await theirs.getByRole("button", { name: "Elfogadom" }).click();
    await expect(theirs).toContainText("Elfogadtad.");
    await expect(theirs).toContainText(`${m.starter_name} párja vagy`);

    // The leaving player: one email naming who replaces them.
    const [final] = await waitForEmails(offset, 1, (e) => /Új partner a helyeden/.test(e.subject));
    expect(final!.text).toContain(`helyetted ${OUTSIDER.name} játszik`);

    // The match page: the leaving player doesn't play, the new partner does.
    await visit(starter.page, `/matches/${m.id}`);
    await expect(content(starter.page)).toContainText(`${m.leaving} helyett ${OUTSIDER.name} játszik`);

    // The Szervező undoes it on Párok: the mark goes.
    const org = await as(browser, ORGANIZER.email);
    await visit(org.page, `/admin/leagues/${LEAGUE.slug}/pairs`);
    const changes = content(org.page).getByRole("region", { name: "Állandó partnercserék" });
    await expect(changes).toContainText(`${m.starter_name}: ${m.leaving} helyett ${OUTSIDER.name}`);
    await changes.getByRole("button", { name: "Visszavonás" }).click();
    await org.page.getByRole("alertdialog").getByRole("button", { name: "Visszavonás" }).click();
    await expect(changes.getByRole("button", { name: "Visszavonás" })).toHaveCount(0);
    expect(d1(`select count(*) n from match_absences where match_id = ${m.id}`)[0]!.n).toBe(0);
    await visit(starter.page, `/matches/${m.id}`);
    await expect(content(starter.page)).not.toContainText(`${m.leaving} helyett`);

    await Promise.all([starter.context.close(), partner.context.close(), org.context.close()]);
  } finally {
    d1Delete(`delete from league_members where league_id = ${leagueId} and user_id = '${OUTSIDER.id}' and source = 'chosen'`);
  }
});
