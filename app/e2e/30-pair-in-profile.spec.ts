// Walkthrough step 37 (D140, #346): the pair is a section of Profil. The
// old Párom address (/pair) leads to Profil's Párod section with its query;
// no menu has Párom; a player in two leagues sees a card per league.
// Read-only, but for a league membership it adds and takes back; no email.
import { expect, test } from "@playwright/test";

import { OUTSIDER, PAIRS, as, content, d1, d1Delete, d1Insert, visit } from "./support";

const anna = PAIRS.p1[0];
const partner = PAIRS.p1[1];

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
  await expect(sidebar.getByRole("link", { name: "Kezdőlap" })).toBeVisible();
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
    await expect(section.getByRole("heading", { name: "Párod" })).toBeVisible();
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
