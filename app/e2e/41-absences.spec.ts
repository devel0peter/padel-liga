// A temporary substitute (#400, spec 4, D175): a player marks their partner
// on the match page as not playing (no name, no approval), the other three
// see it and are told, the mark is taken back; after the match the
// recording player ticks the partner on the result form, the opponent sees
// it next to the result, confirms, and the absent player's Elo doesn't
// change. No "Helyettesek" for the Szervező any more. No email goes out for
// the marks. Takes an open match that counts, with no marks yet.
import { expect, test, type Page } from "@playwright/test";

import { ORGANIZER, as, content, d1, visit } from "./support";

function openMatch() {
  const [m] = d1(`select m.id, ua.id a_id, ua.email asker, ub.id b_id, ub.name partner, uc.email opponent
      from matches m join pairs pa on pa.id = m.pair_a join pairs pb on pb.id = m.pair_b
      join users ua on ua.id = pa.player_a join users ub on ub.id = pa.player_b join users uc on uc.id = pb.player_a
      where m.status = 'open' and m.deadline > unixepoch()
        and not exists (select 1 from group_pairs gp where gp.group_id = m.group_id and gp.pair_id in (m.pair_a, m.pair_b) and gp.withdrawn_at is not null)
        and not exists (select 1 from match_absences x where x.match_id = m.id)
      order by m.id limit 1`);
  expect(m, "an open match that counts").toBeTruthy();
  return m as { id: number; a_id: string; asker: string; b_id: string; partner: string; opponent: string };
}

const absenceNotices = (userId: string) =>
  d1(`select count(*) as n from notifications where user_id = '${userId}' and kind = 'absence_marked'`)[0]!.n as number;

// Recording is folded until the fixed time has started (D133): open it if it is.
async function openRecord(page: Page) {
  const fold = content(page).getByText("Már lejátszottátok? Írjátok be az eredményt");
  if (await fold.isVisible()) await fold.click();
  await expect(content(page).getByRole("button", { name: "Rögzítem az eredményt" })).toBeVisible();
}

test("Helyettes: marked before the match and taken back, then ticked on the result form and confirmed", async ({ browser }) => {
  const m = openMatch();
  // Only the result's own email to the opponents (match_result) goes out; nothing for the marks.
  const otherEmails = () => d1("select count(*) as n from email_messages where kind <> 'match_result'")[0]!.n;
  const emailsBefore = otherEmails();
  const partnerNotices = absenceNotices(m.b_id);

  // Before the match: no name, no approval.
  const asker = await as(browser, m.asker);
  await visit(asker.page, `/matches/${m.id}`);
  const main = content(asker.page);
  await main.getByText("Helyettes kell?").click();
  await main.getByRole("combobox", { name: "Ki nem tud játszani?" }).click();
  await asker.page.getByRole("option", { name: m.partner }).click();
  await main.getByRole("button", { name: "Helyettes jön helyette" }).click();
  await expect(main).toContainText("Rendben, helyettes jön helyette.");
  await expect(main).toContainText(`${m.partner} helyett helyettes játszik nálatok.`);
  expect(absenceNotices(m.b_id)).toBe(partnerNotices + 1);

  // The opponent sees it.
  const opp = await as(browser, m.opponent);
  await visit(opp.page, `/matches/${m.id}`);
  await expect(content(opp.page)).toContainText(`${m.partner} helyett helyettes játszik az ellenfeleiteknél.`);

  // Taken back.
  await main.getByRole("button", { name: `Mégis ${m.partner} játszik` }).click();
  await expect(main).toContainText("Visszavontad: mégis ő játszik.");
  expect(d1(`select count(*) as n from match_absences where match_id = ${m.id}`)[0]!.n).toBe(0);

  // After the match: ticked on the result form.
  await visit(asker.page, `/matches/${m.id}`);
  await openRecord(asker.page);
  const form = main.locator("form").filter({ has: asker.page.getByRole("button", { name: "Rögzítem az eredményt" }) });
  const venue = form.getByRole("combobox", { name: "Hol játszottatok?" });
  if (await venue.count()) {
    await venue.click();
    await asker.page.getByRole("option").first().click();
  }
  await form.getByLabel("1. szett, Ti").fill("4");
  await form.getByLabel("1. szett, Ők").fill("1");
  await form.getByLabel("2. szett, Ti").fill("4");
  await form.getByLabel("2. szett, Ők").fill("2");
  await form.getByLabel(`${m.partner} nem játszott, helyettes állt be`).check();
  await form.getByRole("button", { name: "Rögzítem az eredményt" }).click();
  await expect(main).toContainText("Rögzítettük.");
  await expect(main).toContainText(`${m.partner} helyett helyettes játszott nálatok.`);
  await asker.context.close();

  // The opponent confirms it with who didn't play.
  await visit(opp.page, `/matches/${m.id}`);
  const confirm = content(opp.page).getByRole("region", { name: "Eredmény" });
  await expect(confirm).toContainText(`${m.partner} helyett helyettes játszott az ellenfeleiteknél.`);
  await confirm.getByRole("button", { name: "Megerősítem" }).click();
  await expect(content(opp.page)).toContainText("Megerősítetted");
  await opp.context.close();

  // The absent player isn't rated for it; the recording player is.
  expect(d1(`select count(*) as n from elo_changes where match_id = ${m.id} and user_id = '${m.b_id}'`)[0]!.n).toBe(0);
  expect(d1(`select count(*) as n from elo_changes where match_id = ${m.id} and user_id = '${m.a_id}'`)[0]!.n).toBe(1);
  // No email for the marks.
  expect(otherEmails()).toBe(emailsBefore);
});

test("no Helyettesek page or menu item for the Szervező (#400: nothing to approve)", async ({ browser }) => {
  const org = await as(browser, ORGANIZER.email);
  await visit(org.page, "/admin/leagues/minta");
  const sidebar = org.page.locator("[data-sidebar=sidebar]");
  await expect(sidebar.getByRole("link", { name: "Viták" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Helyettesek" })).toHaveCount(0);
  const res = await org.page.goto("/admin/leagues/minta/substitutes");
  expect(res?.status()).toBe(404);
  await org.context.close();
});
