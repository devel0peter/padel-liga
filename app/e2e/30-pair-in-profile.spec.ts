// Walkthrough step 37 (D140, #346; D141, #347): the pair is a section of
// Profil. The old Párom address (/pair) leads to Profil's Párod section with
// its query; no menu has Párom; a player in two leagues sees a card per
// league. "Korábbi párjaid" lists a pair that ended after playing: the
// walkthrough never ends a pair that played (it can't, while its round runs),
// so the spec dissolves p5's pair (withdrawn in 21-withdrawal) in the suite's
// D1, reads the list as Felbontva, as Partnercsere and with a deleted
// partner, and puts every row back. Read-only otherwise; no email.
import { expect, test } from "@playwright/test";

import { OUTSIDER, PAIRS, as, content, d1, d1Delete, d1Insert, d1Update, visit } from "./support";

const anna = PAIRS.p1[0];
const partner = PAIRS.p1[1];
const [x, y] = PAIRS.p5;

const budapestDate = (d: Date) =>
  new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

test("37. /pair leads to Profil's Párod section, query kept", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  await visit(page, "/pair");
  await expect(page).toHaveURL(/\/profile#parod$/);
  const section = content(page).getByRole("region", { name: "Párod" });
  await expect(section).toBeVisible();
  await expect(section).toContainText(partner.name);
  await expect(section.getByRole("list", { name: "A párod elérhetősége" }).getByRole("link", { name: partner.email })).toHaveAttribute(
    "href",
    `mailto:${partner.email}`,
  );
  // One league: no league name over the card.
  await expect(section.getByRole("heading", { name: "Padelpárbaj Mintaváros" })).toHaveCount(0);
  await visit(page, "/pair?joined=1");
  await expect(page).toHaveURL(/\/profile\?joined=1#parod$/);
  await expect(content(page).getByRole("status")).toContainText("Mostantól párban vagytok.");
  await context.close();
});

test("37. no menu has Párom; Profil stays", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  await visit(page, "/home");
  const sidebar = page.locator("[data-sidebar=sidebar]");
  await expect(sidebar.getByRole("link", { name: "Kezdőlap", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Párom" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const bar = page.getByRole("navigation", { name: "Fő menü" });
  await expect(bar.getByRole("link", { name: "Profil" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Párom" })).toHaveCount(0);
  await context.close();
});

test("37. a player in two leagues sees a card per league, each naming it", async ({ browser }) => {
  const [{ id }] = d1(`select id from users where email = '${OUTSIDER.email}'`) as { id: string }[];
  d1Insert(`insert into league_members (league_id, user_id, source) select id, '${id}', 'chosen' from leagues where slug = 'minta'`);
  try {
    const { context, page } = await as(browser, OUTSIDER.email);
    await visit(page, "/profile");
    const section = content(page).locator("#parod");
    await expect(section.getByRole("heading", { name: "Párod", exact: true })).toBeVisible();
    for (const league of ["Padelpárbaj Mintaváros", "Padelpárbaj Példaváros"]) {
      const card = section.getByRole("region", { name: league });
      await expect(card.getByRole("heading", { name: league })).toBeVisible();
      await expect(card.getByLabel("A meghívó linked")).toBeVisible();
      await expect(card.getByRole("switch", { name: "Párt keresek" })).toBeVisible();
    }
    await context.close();
  } finally {
    // Her Mintaváros pair link went with the card: gone again too.
    d1Delete(`delete from pair_links where owner_id = '${id}' and league_id = (select id from leagues where slug = 'minta')`);
    d1Delete(`delete from league_members where user_id = '${id}' and league_id = (select id from leagues where slug = 'minta')`);
  }
});

test("37. Korábbi párjaid: Felbontva, Partnercsere, a deleted partner; never an email or phone", async ({ browser }) => {
  const [row] = d1(`select p.id, p.league_id as league, ux.id as x, uy.id as y from pairs p
      join users ux on ux.id in (p.player_a, p.player_b) join users uy on uy.id in (p.player_a, p.player_b)
      where ux.email = '${x.email}' and uy.email = '${y.email}' and p.status = 'active'`) as { id: number; league: number; x: string; y: string }[];
  expect(row).toBeTruthy();
  const changeDetail = `league:${row!.league}; from pair:${row!.id}; user:${row!.y} -> user:e2e-nobody`;
  d1Update(`update pairs set status = 'dissolved', dissolved_at = unixepoch(), dissolved_by = '${row!.x}' where id = ${row!.id}`);
  try {
    const { context, page } = await as(browser, x);
    await visit(page, "/profile");
    const list = content(page).getByRole("region", { name: "Korábbi párjaid" });
    const item = list.getByRole("listitem").filter({ hasText: y.name });
    await expect(item).toContainText("Padelpárbaj Mintaváros");
    await expect(item).toContainText("1. kör");
    await expect(item).toContainText(`Felbontva: ${budapestDate(new Date())}`);
    await expect(item.getByRole("link")).toHaveAttribute("href", `/pairs/${row!.id}`);
    // The new state of Párod: no pair, so the pair link and Párt keresek.
    await expect(content(page).getByRole("region", { name: "Párod" }).getByLabel("A meghívó linked")).toBeVisible();

    // Ended by "Partner cseréje": the pair.change entry names the old pair.
    d1Insert(`insert into audit_log (actor_id, action, target, detail, league_id) values ('${row!.x}', 'pair.change', 'pair:0', '${changeDetail}', ${row!.league})`);
    await page.reload();
    await expect(list.getByRole("listitem").filter({ hasText: y.name })).toContainText("Partnercsere");

    // A deleted former partner: Törölt játékos, no link.
    d1Update(`update users set deleted_at = unixepoch() where id = '${row!.y}'`);
    await page.reload();
    await expect(list).toContainText("Törölt játékos");
    await expect(list).not.toContainText(y.name);
    await expect(list.getByRole("link")).toHaveCount(0);
    await expect(list).not.toContainText("@");
    await expect(list).not.toContainText("+36");
    await context.close();
  } finally {
    d1Update(`update users set deleted_at = null where id = '${row!.y}'`);
    d1Delete(`delete from audit_log where action = 'pair.change' and detail = '${changeDetail}'`);
    d1Update(`update pairs set status = 'active', dissolved_at = null, dissolved_by = null where id = ${row!.id}`);
  }
});
