// A league's first season that starts at the minimum entries (#335, D124):
// the Admin opens it without dates, lowers the league's minimum to 3, and
// enters three pairs on Párok; the third entry fixes round 1 to the first Monday at
// least 7 days later, and every entered player gets one email and one
// notice. Meanwhile the landing card and the league page show how many
// pairs are still needed, then the start day. Its own city, league, players
// and pairs, removed at the end; the walkthrough's league is never touched.
import { budapestDay, firstSeasonStart } from "@padel-liga/rules";
import { expect, test, type Page } from "@playwright/test";

import { ADMIN, as, content, d1, d1Delete, d1Insert, visit } from "./support";

const CITY = { slug: "e2e-indulo", name: "Indulóváros" };
const LEAGUE = { slug: "e2e-indulo", name: "Padelpárbaj Indulóváros" };
const SEASON = "Indulóvárosi első szezon";
const PLAYERS = ["1a", "1b", "2a", "2b", "3a", "3b"].map((n) => ({ id: `e2e-indulo-${n}`, name: `Induló ${n.toUpperCase()}`, email: `indulo.${n}@example.test` }));
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const league = `(select id from leagues where slug = ${q(LEAGUE.slug)})`;
const ids = PLAYERS.map((p) => q(p.id)).join(", ");

function removeOwnRows() {
  d1Delete(`delete from seasons where league_id = ${league}`);
  d1Delete(`delete from pairs where league_id = ${league}`);
  d1Delete(`delete from users where id in (${ids})`);
  d1Delete(`delete from email_messages where to_email like 'indulo.%@example.test'`);
  d1Delete(`delete from leagues where slug = ${q(LEAGUE.slug)}`);
  d1Delete(`delete from cities where slug = ${q(CITY.slug)}`);
}

test.beforeAll(() => {
  // Rows a killed run left behind would clash on the slugs.
  removeOwnRows();
  d1Insert(`insert into cities (slug, name, listed) values (${q(CITY.slug)}, ${q(CITY.name)}, 1)`);
  d1Insert(`insert into leagues (city, slug, name, min_entries) values (${q(CITY.slug)}, ${q(LEAGUE.slug)}, ${q(LEAGUE.name)}, 5)`);
  d1Insert(
    `insert into users (id, email, name, level, consent_at) values ` +
      PLAYERS.map((p) => `(${q(p.id)}, ${q(p.email)}, ${q(p.name)}, 'halado', unixepoch())`).join(", "),
  );
  d1Insert(
    `insert into pairs (league_id, player_a, player_b) values ` +
      [0, 2, 4].map((i) => `(${league}, ${q(PLAYERS[i]!.id)}, ${q(PLAYERS[i + 1]!.id)})`).join(", "),
  );
});

test.afterAll(removeOwnRows);

const card = (page: Page) => page.getByRole("region", { name: `${CITY.name}: a liga állása` });

async function enter(page: Page, a: string, b: string) {
  const row = content(page).getByRole("row").filter({ hasText: a }).filter({ hasText: b });
  await row.getByRole("button", { name: "Benevezés" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Benevezés", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText(/Nevezés \(.+\): Nevezett/);
}

test("a first season opens without dates and starts by itself at the minimum entries", async ({ browser }) => {
  const { context, page } = await as(browser, ADMIN.email);

  // Szezonok: the first season, without a registration deadline or start date.
  await visit(page, `/admin/leagues/${LEAGUE.slug}/seasons`);
  await content(page).getByRole("radio", { name: /Első szezon: akkor indul, ha összegyűlik a minimum nevezés \(5 pár\)/ }).click();
  await expect(content(page).locator("#firstPhaseStart")).toHaveCount(0);
  await expect(content(page).locator("#registrationCloses")).toHaveCount(0);
  await content(page).getByLabel("Név").fill(SEASON);
  await content(page).getByRole("button", { name: "Létrehozás" }).click();
  const seasonRow = content(page).getByRole("row").filter({ hasText: SEASON });
  await expect(seasonRow).toContainText("0 pár nevezett, még 5 kell, utána indul.");

  // The league's page: the minimum, editable while the season waits.
  await visit(page, `/admin/leagues/${LEAGUE.slug}`);
  await content(page).getByLabel(/Az első szezon akkor indul, ha ennyi pár nevezett/).fill("3");
  await content(page).getByRole("button", { name: "Mentés" }).click();
  await expect(content(page).getByRole("status")).toHaveText("Elmentetted a minimumot.");

  // Two pairs entered: one more is needed, on the landing card and the league page.
  await visit(page, `/admin/leagues/${LEAGUE.slug}/pairs`);
  await enter(page, PLAYERS[0]!.name, PLAYERS[1]!.name);
  await enter(page, PLAYERS[2]!.name, PLAYERS[3]!.name);
  const anon = await browser.newPage();
  await visit(anon, "/");
  await expect(card(anon)).toContainText("2 pár nevezett, még 1 kell, utána indul.");
  await expect(card(anon).getByRole("link", { name: "Nevezek az 1. körre" })).toBeVisible();
  // The league page is for logged-in players only (D134): the Admin's view.
  await visit(page, `/league/${LEAGUE.slug}`);
  await expect(content(page)).toContainText("2 pár nevezett, még 1 kell, utána indul.");
  await visit(page, `/admin/leagues/${LEAGUE.slug}/pairs`);
  expect(d1(`select count(*) as n from email_messages where kind = 'season_start'`)).toEqual([{ n: 0 }]);

  // The third entry reaches the minimum: round 1 is fixed, everyone is told once.
  await enter(page, PLAYERS[4]!.name, PLAYERS[5]!.name);
  const [stored] = d1(`select first_phase_start as start, start_fixed_at as fixed from seasons where league_id = ${league}`);
  const fixedAt = new Date(Number(stored!.fixed) * 1000);
  expect(Math.abs(Date.now() - fixedAt.getTime())).toBeLessThan(5 * 60_000);
  // The rule's Monday for the moment the minimum was reached.
  expect(stored!.start).toBe(firstSeasonStart({ entries: 3, minimum: 3, at: fixedAt, breaks: [] }));
  expect(String(stored!.start) > budapestDay(fixedAt)).toBe(true);
  expect(d1(`select count(*) as n from season_phases where season_id = (select id from seasons where league_id = ${league})`)).toEqual([{ n: 4 }]);
  const mails = d1(`select to_email from email_messages where kind = 'season_start' order by to_email`);
  expect(mails.map((m) => m.to_email)).toEqual(PLAYERS.map((p) => p.email).sort());
  const notices = d1(`select user_id from notifications where kind = 'season_start' and user_id in (${ids}) order by user_id`);
  expect(notices.map((n) => n.user_id)).toEqual(PLAYERS.map((p) => p.id).sort());

  // The start day instead of the count, in "nov. 23., hétfő" form.
  const day = new Intl.DateTimeFormat("hu-HU", { timeZone: "UTC", month: "short", day: "numeric", weekday: "long" }).format(
    new Date(`${stored!.start}T00:00:00Z`),
  );
  await visit(anon, "/");
  await expect(card(anon).getByRole("definition")).toHaveText(day);
  await expect(card(anon).getByRole("term")).toHaveText("Indul");
  await expect(card(anon)).not.toContainText("Nevezés zárul");
  await visit(page, `/league/${LEAGUE.slug}`);
  await expect(content(page)).toContainText(/Az 1\. kör .+ indul\./);
  await anon.close();

  // Once the season has its start the minimum means nothing: not shown.
  await visit(page, `/admin/leagues/${LEAGUE.slug}`);
  await expect(content(page).getByRole("heading", { name: "Minimum nevezés" })).toHaveCount(0);
  // The fixed first Monday can't be moved by editing the season.
  await visit(page, `/admin/leagues/${LEAGUE.slug}/seasons`);
  await content(page).getByRole("row").filter({ hasText: SEASON }).getByRole("link", { name: "Szerkesztés" }).click();
  await expect(content(page).locator("#firstPhaseStart")).toHaveAttribute("readonly", "");
  await expect(content(page)).toContainText("A minimum elérésekor dőlt el, és a játékosok megkapták: nem módosítható.");
  await context.close();
});
