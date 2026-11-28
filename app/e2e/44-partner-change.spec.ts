// Walkthrough step 44 (#402, D178; #416, D180): a permanent partner change. A
// player of a pair in the running round names a new partner by name on
// Ligáim, the new partner accepts there, the Szervező approves it on Párok,
// and the leaving player is marked absent on the pair's remaining matches
// with the new partner named on the match page.
// The new partner and the leaving player each get one email (printed by the
// dev server, never sent). The Szervező undoes it on Párok, which takes the
// marks away again, so later specs see the walkthrough's state. Idegen Ilona
// (a player of the other league, no pair) joins Mintaváros for the spec and
// leaves it at the end.
import { expect, test } from "@playwright/test";

import { LEAGUE } from "../app/lib/seed";
import { ORGANIZER, OUTSIDER, as, content, d1, d1Delete, d1Insert, logOffset, visit, waitForEmails } from "./support";

// A pair of Mintaváros in a published group of the running round, both
// players' accounts kept, not withdrawn, with no change going on.
function runningPair() {
  const [p] = d1(`select p.id pair_id, g.id group_id, sp.deadline, ua.email starter, ua.name starter_name, ub.id leaving_id, ub.name leaving
      from group_pairs gp join groups g on g.id = gp.group_id join seasons s on s.id = g.season_id join leagues l on l.id = s.league_id
      join season_phases sp on sp.season_id = g.season_id and sp.number = g.phase
      join pairs p on p.id = gp.pair_id join users ua on ua.id = p.player_a join users ub on ub.id = p.player_b
      where l.slug = '${LEAGUE.slug}' and g.published_at is not null and sp.deadline > unixepoch() and gp.withdrawn_at is null
        and p.status = 'active' and ua.deleted_at is null and ub.deleted_at is null
        and not exists (select 1 from partner_changes c where c.pair_id = p.id and c.status in ('open', 'final'))
      order by g.number, gp.seed limit 1`);
  expect(p, "a pair in the running round").toBeTruthy();
  return p as { pair_id: number; group_id: number; deadline: number; starter: string; starter_name: string; leaving_id: string; leaving: string };
}

// A match of the pair still before its start (open, or scheduled later), no
// marks yet. Late in the suite most matches are played, so when there is
// none the spec brings its own: an open match against another pair of the
// group (deleted again at the end, so later specs see the walkthrough's state).
function openMatchOf(p: ReturnType<typeof runningPair>): { id: number; fixture: boolean } {
  const [m] = d1(`select m.id from matches m
      where m.group_id = ${p.group_id} and ${p.pair_id} in (m.pair_a, m.pair_b)
        and (m.status = 'open' or (m.status = 'scheduled' and m.scheduled_at > unixepoch())) and m.deadline > unixepoch()
        and not exists (select 1 from group_pairs gp where gp.group_id = m.group_id and gp.pair_id in (m.pair_a, m.pair_b) and gp.withdrawn_at is not null)
        and not exists (select 1 from match_absences x where x.match_id = m.id)
      order by m.id limit 1`) as { id: number }[];
  if (m) return { id: m.id, fixture: false };
  const [other] = d1(`select gp.pair_id, exists (select 1 from matches m where m.group_id = gp.group_id and m.pair_a = ${p.pair_id} and m.pair_b = gp.pair_id) as taken
      from group_pairs gp where gp.group_id = ${p.group_id} and gp.pair_id <> ${p.pair_id} and gp.withdrawn_at is null
      order by gp.seed limit 1`) as { pair_id: number; taken: number }[];
  expect(other, "another pair of the group").toBeTruthy();
  // The round has one match per two pairs, in one order: the fixture takes the other order.
  const [a, b] = other!.taken ? [other!.pair_id, p.pair_id] : [p.pair_id, other!.pair_id];
  d1Insert(`insert into matches (group_id, pair_a, pair_b, week, deadline) values (${p.group_id}, ${a}, ${b}, 3, ${p.deadline})`);
  const [made] = d1(`select id from matches where group_id = ${p.group_id} and pair_a = ${a} and pair_b = ${b}`) as { id: number }[];
  return { id: made!.id, fixture: true };
}

test("44. Állandó partnercsere: asked on Ligáim, accepted, the new partner plays the rest of the round; the Szervező undoes it", async ({ browser }) => {
  const m = runningPair();
  const match = openMatchOf(m);
  const [{ id: leagueId }] = d1(`select id from leagues where slug = '${LEAGUE.slug}'`) as { id: number }[];
  d1Insert(`insert or ignore into league_members (league_id, user_id, source) values (${leagueId}, '${OUTSIDER.id}', 'chosen')`);
  try {
    const offset = logOffset();

    // The player picks the new partner by name on the league's card.
    const starter = await as(browser, m.starter);
    await visit(starter.page, `/leagues/${LEAGUE.slug}`);
    const section = content(starter.page).getByRole("region", { name: "Állandó partnercsere" });
    await expect(section).toContainText("új partnerrel folytathatod a helyeteken");
    await section.getByText("Végleg új partnerrel játszanál?").click();
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

    // Waiting for the Szervező (#416): both see it, nothing is marked yet, the organizers are told.
    await expect(theirs).toContainText("Jóváhagyásra vár");
    await visit(starter.page, `/leagues/${LEAGUE.slug}`);
    await expect(content(starter.page).getByRole("region", { name: "Állandó partnercsere" })).toContainText("Jóváhagyásra vár");
    expect(d1(`select count(*) n from match_absences where match_id = ${match.id}`)[0]!.n).toBe(0);
    const [{ id: orgId }] = d1(`select id from users where email = '${ORGANIZER.email}'`) as { id: string }[];
    expect(d1(`select count(*) n from notifications where user_id = '${orgId}' and kind = 'partner_change_waiting'`)[0]!.n).toBeGreaterThan(0);

    // The Szervező approves it on Párok, seeing how often the two changed partner.
    const org = await as(browser, ORGANIZER.email);
    await visit(org.page, `/admin/leagues/${LEAGUE.slug}/pairs`);
    const changes = content(org.page).getByRole("region", { name: "Állandó partnercserék" });
    await expect(changes).toContainText(`${m.starter_name}: ${m.leaving} helyett ${OUTSIDER.name}`);
    await expect(changes).toContainText("Jóváhagyásra vár");
    await expect(changes).toContainText(`${OUTSIDER.name}: még nem cserélt partnert ebben a szezonban.`);
    await changes.getByRole("button", { name: "Jóváhagyom" }).click();
    await expect(changes.getByRole("button", { name: "Visszavonás" })).toBeVisible();

    // The leaving player: one email naming who replaces them.
    const [final] = await waitForEmails(offset, 1, (e) => /Új partner a helyeden/.test(e.subject));
    expect(final!.text).toContain(`helyetted ${OUTSIDER.name} játszik`);
    await visit(partner.page, `/leagues/${LEAGUE.slug}`);
    await expect(content(partner.page).getByRole("region", { name: "Állandó partnercsere" })).toContainText(`${m.starter_name} párja vagy`);

    // The match page: the leaving player doesn't play, the new partner does.
    await visit(starter.page, `/matches/${match.id}`);
    await expect(content(starter.page)).toContainText(`${m.leaving} helyett ${OUTSIDER.name} játszik`);

    // Párok counts the pair's match with an absent player this season.
    await visit(org.page, `/admin/leagues/${LEAGUE.slug}/pairs`);
    await expect(content(org.page)).toContainText(/Helyettessel: \d+ meccs ebben a szezonban/);

    // The Szervező undoes it on Párok: the mark goes.
    await changes.getByRole("button", { name: "Visszavonás" }).click();
    await org.page.getByRole("alertdialog").getByRole("button", { name: "Visszavonás" }).click();
    await expect(changes.getByRole("button", { name: "Visszavonás" })).toHaveCount(0);
    expect(d1(`select count(*) n from match_absences where match_id = ${match.id}`)[0]!.n).toBe(0);
    await visit(starter.page, `/matches/${match.id}`);
    await expect(content(starter.page)).not.toContainText(`${m.leaving} helyett`);

    await Promise.all([starter.context.close(), partner.context.close(), org.context.close()]);
  } finally {
    d1Delete(`delete from league_members where league_id = ${leagueId} and user_id = '${OUTSIDER.id}' and source = 'chosen'`);
    if (match.fixture) d1Delete(`delete from matches where id = ${match.id}`);
  }
});
