// Walkthrough step 23 (#158): the Szervező's "Meccsek" after steps 17 to 19:
// every match of the running phase with its status, last step and activity,
// the stuck filter, one match's log and phones, and nobody else gets in.
import { addDays, budapestDay, budapestTime } from "@padel-liga/rules";
import { expect, test } from "@playwright/test";

import { ORGANIZER, PAIRS, as, content, d1, d1Insert, visit } from "./support";

const LIST = "/admin/leagues/minta/matches";
const anna = PAIRS.p1[0];

// An untouched match of the other group, and the pair and player that step.
function untouchedMatch(): { id: number; pairId: number; userId: string } {
  const [row] = d1(
    `select m.id, m.pair_a as pair_id, p.player_a as user_id from matches m join pairs p on p.id = m.pair_a
     join users u on u.id = p.player_a
     where not exists (select 1 from match_events e where e.match_id = m.id) and u.consent_at is not null
     order by m.week, m.id limit 1`,
  ) as { id: number; pair_id: number; user_id: string }[];
  return { id: row!.id, pairId: row!.pair_id, userId: row!.user_id };
}

test("23. Meccsek: every match with its status, the stuck filter, one match's log and phones; players and other leagues refused", async ({ browser }) => {
  // A proposal three days old, nobody answered: stuck. Its slots are ahead,
  // so it hasn't lapsed. No page can backdate a step, so it goes in directly.
  const stuck = untouchedMatch();
  const today = budapestDay(new Date());
  const slots = [5, 6, 7].map((d) => Math.floor(budapestTime(addDays(today, d), 18, 0).getTime() / 1000));
  const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 86400;
  d1Insert(
    `insert into match_events (match_id, pair_id, user_id, kind, slots, at) values (${stuck.id}, ${stuck.pairId}, '${stuck.userId}', 'proposal', '${JSON.stringify(slots)}', ${threeDaysAgo})`,
  );
  const matchCount = Number(d1("select count(*) as n from matches")[0]!.n);

  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, "/admin/leagues/minta");
  await page.getByRole("link", { name: "Meccsek" }).first().click();
  await expect(page).toHaveURL(new RegExp(`${LIST}$`));
  const main = content(page);
  await expect(main.getByRole("heading", { name: "Meccsek", level: 1 })).toBeVisible();
  await expect(main).toContainText("1. kör · határidő:");
  await expect(main.getByRole("heading", { name: /divízió, 1\. csoport$/ })).toBeVisible();
  await expect(main.getByRole("heading", { name: /divízió, 2\. csoport$/ })).toBeVisible();
  const rows = main.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Napló és telefonszámok" }) });
  await expect(rows).toHaveCount(matchCount);
  // Steps 18 and 19 scheduled anna's two matches; the backdated one waits.
  await expect(main.getByText(/^Lefixálva: /)).toHaveCount(2);
  await expect(main.getByText(/^Időpontokat ajánlottak, .* válaszára vár$/)).toHaveCount(1);
  // Step 19's agreed time was recorded and confirmed: both pairs stepped.
  // Step 18's was proposed and accepted: accepting isn't valid activity.
  await expect(main.getByText(/Mindkét pár lépett$/)).toHaveCount(1);
  await expect(main).not.toContainText("@example.test");
  await expect(main.locator('a[href^="tel:"]')).toHaveCount(0);

  // The stuck switch: exactly that match, as many as its count.
  await main.getByRole("button", { name: "Elakadtak (1)" }).click();
  await expect(page).toHaveURL(/\?stuck=1$/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Elakadt: 48 órája nincs válasz");
  await expect(rows.first()).toContainText("Utolsó lépés: ");
  await main.getByRole("button", { name: "Szűrők törlése" }).click();
  await expect(rows).toHaveCount(matchCount);

  // Status filter.
  await main.getByRole("combobox", { name: "Állapot" }).click();
  await page.getByRole("option", { name: "Lefixálva" }).click();
  await expect(page).toHaveURL(/status=scheduled/);
  await expect(rows).toHaveCount(2);
  await expect(main.getByRole("button", { name: "Elakadtak (0)" })).toBeVisible();

  // Step 19's match: both pairs active, four phones, the log.
  await rows.filter({ hasText: "Mindkét pár lépett" }).getByRole("link", { name: "Napló és telefonszámok" }).click();
  await expect(page).toHaveURL(new RegExp(`${LIST}/\\d+$`));
  const match = content(page);
  await expect(match.getByRole("region", { name: "Állapot" })).toContainText(/Lefixálva: /);
  await expect(match.getByRole("region", { name: "Állapot" })).toContainText("Mindkét pár lépett");
  await expect(match.getByText("Lépett", { exact: true })).toHaveCount(2);
  await expect(match.locator('a[href^="tel:"]')).toHaveCount(4);
  const log = match.getByRole("region", { name: "Napló" });
  await expect(log.getByRole("listitem")).toHaveCount(2);
  await expect(log).toContainText(anna.name);
  await expect(match).not.toContainText("@example.test");

  // The stuck one: its single step, by its player.
  await visit(page, `${LIST}/${stuck.id}`);
  await expect(match.getByRole("region", { name: "Állapot" })).toContainText("Elakadt: 48 órája nincs válasz");
  await expect(match.getByText("Még nem lépett", { exact: true })).toHaveCount(1);
  await expect(match.getByRole("region", { name: "Napló" }).getByRole("listitem")).toHaveCount(1);
  await expect(match.getByRole("region", { name: "Napló" })).toContainText("Időpontokat ajánlott:");
  await context.close();

  // A player: refused, the page and a hand-made data request alike.
  const player = await as(browser, anna);
  for (const path of [LIST, `${LIST}/${stuck.id}`]) {
    expect((await player.page.goto(path))?.status()).toBe(403);
    expect((await player.page.request.get(`${path}.data`)).status()).toBe(403);
  }
  await expect(player.page.getByText("Ehhez nincs jogod")).toBeVisible();
  await player.context.close();

  // A Szervező of another league: refused too. The Admin appoints organizers
  // on a page; a second league only for this check goes in directly.
  const other = PAIRS.p2[0];
  d1Insert(`insert into cities (slug, name, listed) values ('e2e-masik', 'Másikváros', 0)`);
  d1Insert(`insert into leagues (city, slug, name) values ('e2e-masik', 'e2e-masik', 'Másik liga')`);
  d1Insert(
    `insert into league_admins (league_id, user_id) select l.id, u.id from leagues l, users u where l.slug = 'e2e-masik' and u.email = '${other.email}'`,
  );
  const organizer = await as(browser, other);
  expect((await organizer.page.goto(LIST))?.status()).toBe(403);
  expect((await organizer.page.request.get(`${LIST}/${stuck.id}.data`)).status()).toBe(403);
  // Their own league's page opens (no running phase there).
  await visit(organizer.page, "/admin/leagues/e2e-masik/matches");
  await expect(content(organizer.page)).toContainText("Most nincs futó kör.");
  await organizer.context.close();
});
