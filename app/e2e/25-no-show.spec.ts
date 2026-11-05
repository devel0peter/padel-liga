// A no-show (#33, spec 8, D108): two hours after an agreed slot (written
// straight into the suite's D1: a past slot can't be proposed) a player of
// one pair reports on the match page that the other didn't come; the
// Szervező is told, finds it on "Viták" and confirms it on the decision page:
// a 4-0 4-0 walkover for the reporting pair, a strike for the other pair's
// players, both pairs told. No email goes out. Takes an open match nobody
// asked a substitute for.
import { expect, test } from "@playwright/test";

import { ORGANIZER, as, content, d1, d1Insert, d1Update, visit } from "./support";

test("Nem jöttek el: a player reports after the slot, the Szervező confirms the walkover", async ({ browser }) => {
  const [m] = d1(`select m.id, m.pair_a, m.pair_b, m.revision, ua.id reporter_id, ua.email reporter, ub.name partner, uc.email opponent, uc.name opp_a, ud.name opp_b
      from matches m join pairs pa on pa.id = m.pair_a join pairs pb on pb.id = m.pair_b
      join users ua on ua.id = pa.player_a join users ub on ub.id = pa.player_b
      join users uc on uc.id = pb.player_a join users ud on ud.id = pb.player_b
      where m.status = 'open' and m.deadline > unixepoch()
        and not exists (select 1 from group_pairs gp where gp.group_id = m.group_id and gp.pair_id in (m.pair_a, m.pair_b) and gp.withdrawn_at is not null)
        and not exists (select 1 from match_substitutes s where s.match_id = m.id)
      order by m.id desc limit 1`);
  expect(m, "an open match to report a no-show on").toBeTruthy();
  const now = Math.floor(Date.now() / 1000);
  const slot = now - 2 * 3600;
  // Proposed and accepted three days ago, for two hours ago.
  d1Insert(`insert into match_events (match_id, pair_id, kind, slots, at) values (${m!.id}, ${m!.pair_a}, 'proposal', '[${slot},${slot + 86400},${slot + 2 * 86400}]', ${now - 3 * 86400})`);
  d1Insert(`insert into match_events (match_id, pair_id, kind, slot, at) values (${m!.id}, ${m!.pair_b}, 'accepted', ${slot}, ${now - 3 * 86400 + 60})`);
  d1Update(`update matches set status = 'scheduled', scheduled_at = ${slot}, revision = revision + 2 where id = ${m!.id}`);
  const emailsBefore = d1("select count(*) as n from email_messages where kind <> 'strike_warning'")[0]!.n;

  // The player reports it, after a confirmation.
  const reporter = await as(browser, m!.reporter as string);
  await visit(reporter.page, `/matches/${m!.id}`);
  const main = content(reporter.page);
  await expect(main.getByText("Nem jött el az ellenfél?")).toBeVisible();
  await main.getByRole("button", { name: "Nem jöttek el" }).click();
  await expect(reporter.page.getByRole("alertdialog")).toContainText("Biztosan nem jöttek el?");
  await reporter.page.getByRole("button", { name: "Jelzem" }).click();
  await expect(main).toContainText("Elküldtük a szervezőnek.");
  await expect(main).toContainText("Jeleztétek, hogy az ellenfeletek nem jött el");
  await expect(main.getByRole("button", { name: "Visszavonom a bejelentést" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Nem jöttek el" })).toHaveCount(0);
  await reporter.context.close();

  // The Szervező: told, finds it on Viták, confirms on the decision page.
  const org = await as(browser, ORGANIZER.email);
  await visit(org.page, "/notifications");
  await expect(content(org.page)).toContainText("Nem jöttek el");
  await visit(org.page, "/admin/leagues/minta/disputes");
  const list = content(org.page);
  await expect(list).toContainText("Nem jöttek el (1)");
  const item = list.getByRole("listitem").filter({ hasText: "nem jött el" });
  await expect(item).toContainText(`${m!.opp_a} – ${m!.opp_b} nem jött el`);
  await expect(list).not.toContainText("@");
  await item.getByRole("link", { name: "Döntök" }).click();
  await org.page.waitForURL(`**/matches/${m!.id}/decide`);
  const decide = content(org.page);
  await expect(decide).toContainText("Nem jöttek el: döntés");
  await decide.getByLabel("Indoklás (nem kötelező, mindkét pár látja)").fill("A klub is megerősítette.");
  await decide.getByRole("button", { name: "Jóváhagyom" }).click();
  await expect(decide).toContainText("Jóváhagytad");
  await expect(decide).not.toContainText("Nem jöttek el: döntés");
  await expect(decide).toContainText("Nem jöttek el: a szervező jóváhagyta a bejelentést. A klub is megerősítette.");
  await org.context.close();

  // The match is a 4-0 4-0 walkover; the other pair sees why and got a strike.
  expect(d1(`select status, outcome from matches where id = ${m!.id}`)[0]).toEqual({ status: "final", outcome: JSON.stringify({ kind: "walkover", winner: "a" }) });
  expect(d1(`select count(*) as n from strikes where match_id = ${m!.id} and source = 'no_show'`)[0]!.n).toBe(2);
  const opp = await as(browser, m!.opponent as string);
  await visit(opp.page, `/matches/${m!.id}`);
  await expect(content(opp.page)).toContainText("A szervező jóváhagyta, hogy nem jöttetek el");
  await expect(content(opp.page)).toContainText("A szervező indoklása: A klub is megerősítette.");
  await visit(opp.page, "/notifications");
  await expect(content(opp.page)).toContainText("A szervező szerint nem jöttetek el");
  await opp.context.close();

  // No email, unless a strike was a player's 2nd (its own warning, spec 13).
  expect(d1("select count(*) as n from email_messages where kind <> 'strike_warning'")[0]!.n).toBe(emailsBefore);
});
