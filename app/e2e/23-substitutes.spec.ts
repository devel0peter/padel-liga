// A substitute (#37, spec 4, D109): a player asks on the match page for a
// substitute for their partner, picked by name from the league's players
// (never the match's players or the group's other pairs, never an address);
// the Szervező is told and approves on "Helyettesek" with both Elo values
// side by side; the opponents then see the substitute on the match page.
// No email goes out. Runs after the withdrawal spec: it takes a match that
// is still open and counts.
import { expect, test } from "@playwright/test";

import { ORGANIZER, OUTSIDER, as, content, d1, visit } from "./support";

// D145: no substitutes in the first season. The feature is hidden
// (SUBSTITUTES_ENABLED in app/lib/substitutes.ts), so this flow is skipped,
// not deleted; switch it back on with the flag.
test.skip("Helyettes: a player asks, the Szervező approves, the opponents see who plays", async ({ browser }) => {
  // An open match of a published group, no pair withdrawn, with its players.
  const [m] = d1(`select m.id, m.group_id, ua.email asker, ub.name partner, uc.email opponent, uc.name opp_a, ud.name opp_b
      from matches m join pairs pa on pa.id = m.pair_a join pairs pb on pb.id = m.pair_b
      join users ua on ua.id = pa.player_a join users ub on ub.id = pa.player_b
      join users uc on uc.id = pb.player_a join users ud on ud.id = pb.player_b
      where m.status = 'open' and not exists (select 1 from group_pairs gp where gp.group_id = m.group_id
        and gp.pair_id in (m.pair_a, m.pair_b) and gp.withdrawn_at is not null)
      order by m.id limit 1`);
  expect(m, "an open match to ask a substitute for").toBeTruthy();
  const groupNames = d1(`select u.name from group_pairs gp join pairs p on p.id = gp.pair_id
      join users u on u.id in (p.player_a, p.player_b) where gp.group_id = ${m!.group_id} and gp.withdrawn_at is null`).map((r) => r.name as string);
  const emailsBefore = d1("select count(*) as n from email_messages")[0]!.n;

  // The player asks.
  const asker = await as(browser, m!.asker as string);
  await visit(asker.page, `/matches/${m!.id}`);
  const main = content(asker.page);
  // Folded until there is a request (D133).
  await main.getByText("Helyettes kell?").click();
  await main.getByRole("combobox", { name: "Ki nem tud játszani?" }).click();
  await asker.page.getByRole("option", { name: m!.partner as string }).click();
  await main.getByRole("combobox", { name: "Ki helyettesít?" }).click();
  const options = asker.page.getByRole("option");
  const names = await options.allTextContents();
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) {
    expect(groupNames, `${n} plays in the group`).not.toContain(n);
    expect(n).not.toContain("@");
  }
  // Only the league's players (D128): never the second league's player.
  expect(names).not.toContain(OUTSIDER.name);
  const substitute = names[0]!;
  await options.first().click();
  await main.getByRole("button", { name: "Helyettest kérek" }).click();
  await expect(main).toContainText("Elküldtük a kérést a szervezőnek.");
  await expect(main).toContainText(`${m!.partner} helyett ${substitute}: Jóváhagyásra vár`);
  await expect(main.getByRole("button", { name: "Visszavonom a kérést" })).toBeVisible();
  await asker.context.close();

  // The Szervező: told, then approves with both Elo values in view.
  const org = await as(browser, ORGANIZER.email);
  await visit(org.page, "/notifications");
  await expect(content(org.page)).toContainText("Helyettes kérés");
  await visit(org.page, "/admin/leagues/minta/substitutes");
  const list = content(org.page);
  await expect(list).toContainText("Jóváhagyásra vár (1)");
  const item = list.getByRole("listitem").filter({ hasText: substitute });
  await expect(item).toContainText("Hiányzó");
  await expect(item).toContainText(m!.partner as string);
  await expect(item.getByText(/^Elo /)).toHaveCount(2);
  await expect(list).not.toContainText("@");
  await item.getByRole("button", { name: "Jóváhagyom" }).click();
  await expect(list).toContainText("Jóváhagytad a helyettest.");
  await expect(list).toContainText("Jóváhagyásra vár (0)");
  await expect(list).toContainText("Jóváhagyva, még nem játszották (1)");
  await org.context.close();

  // An opponent sees who plays, and was told in the app.
  const opp = await as(browser, m!.opponent as string);
  await visit(opp.page, `/matches/${m!.id}`);
  await expect(content(opp.page)).toContainText(`${m!.partner} helyett ${substitute} játszik az ellenfeleiteknél.`);
  await visit(opp.page, "/notifications");
  await expect(content(opp.page)).toContainText("Helyettes az ellenfeleteknél");
  await opp.context.close();

  // The substitute gets nothing; no email went out.
  expect(
    d1(`select count(*) as n from notifications n join users u on u.id = n.user_id
      where u.name = '${substitute.replace(/'/g, "''")}' and n.kind like 'substitute%'`)[0]!.n,
  ).toBe(0);
  expect(d1("select count(*) as n from email_messages")[0]!.n).toBe(emailsBefore);
});

// While hidden (D145): no "Helyettes kell?" on an open match, no
// "Helyettesek" in the Szervező's sidebar.
test("Helyettes is hidden in the first season (D145)", async ({ browser }) => {
  const [m] = d1(`select m.id, ua.email asker from matches m join pairs pa on pa.id = m.pair_a join users ua on ua.id = pa.player_a
      where m.status = 'open' and not exists (select 1 from group_pairs gp where gp.group_id = m.group_id
        and gp.pair_id in (m.pair_a, m.pair_b) and gp.withdrawn_at is not null)
      order by m.id limit 1`);
  expect(m, "an open match").toBeTruthy();
  const player = await as(browser, m!.asker as string);
  await visit(player.page, `/matches/${m!.id}`);
  const main = content(player.page);
  await expect(main.getByRole("heading", { name: "Napló" })).toBeVisible();
  await expect(main.getByText("Helyettes kell?")).toHaveCount(0);
  await player.context.close();

  const org = await as(browser, ORGANIZER.email);
  await visit(org.page, "/admin/leagues/minta");
  const sidebar = org.page.locator("[data-sidebar=sidebar]");
  await expect(sidebar.getByRole("link", { name: "Viták" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Helyettesek" })).toHaveCount(0);
  await org.context.close();
});
