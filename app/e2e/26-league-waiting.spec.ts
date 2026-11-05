// The league page before any group is published (#181): a logged-out visitor
// sees when the next round starts, no group, table or division band, and the
// link back to the landing page. Its own data: a league in a city of its own,
// with a season and no group, removed again at the end. The walkthrough's
// league (groups published since 06) is never touched.
import { addDays, budapestDay, budapestTime, phaseCalendar } from "@padel-liga/rules";
import { expect, test } from "@playwright/test";

import { firstRoundStart } from "../app/lib/seed";
import { content, d1Delete, d1Insert, visit } from "./support";

const CITY = { slug: "e2e-varakozo", name: "Várakozóváros" };
const LEAGUE = { slug: "e2e-varakozo", name: "Padelpárbaj Várakozóváros" };
const SEASON = "Várakozó szezon";

const now = new Date();
// Round 1 a week after the seed's, so the date is not the walkthrough's.
const start = addDays(firstRoundStart(now), 7);
const phases = phaseCalendar(start, []);
const secs = (d: Date) => Math.floor(d.getTime() / 1000);
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const seasonId = `(select s.id from seasons s join leagues l on l.id = s.league_id where l.slug = ${q(LEAGUE.slug)})`;

function removeOwnRows() {
  d1Delete(`delete from season_phases where season_id = ${seasonId}`);
  d1Delete(`delete from seasons where league_id = (select id from leagues where slug = ${q(LEAGUE.slug)})`);
  d1Delete(`delete from leagues where slug = ${q(LEAGUE.slug)}`);
  d1Delete(`delete from cities where slug = ${q(CITY.slug)}`);
}

test.beforeAll(() => {
  d1Insert(`insert into cities (slug, name, listed) values (${q(CITY.slug)}, ${q(CITY.name)}, 1)`);
  d1Insert(`insert into leagues (city, slug, name) values (${q(CITY.slug)}, ${q(LEAGUE.slug)}, ${q(LEAGUE.name)})`);
  d1Insert(
    `insert into seasons (league_id, name, registration_opens_at, registration_closes_at, first_phase_start, breaks) ` +
      `select id, ${q(SEASON)}, ${secs(budapestTime(addDays(budapestDay(now), -1), 0, 0))}, ` +
      `${secs(budapestTime(addDays(start, -1), 23, 59))}, ${q(start)}, '[]' from leagues where slug = ${q(LEAGUE.slug)}`,
  );
  d1Insert(
    `insert into season_phases (season_id, number, starts_at, deadline) values ` +
      phases.map((p) => `(${seasonId}, ${p.number}, ${secs(p.startsAt)}, ${secs(p.deadline)})`).join(", "),
  );
});

test.afterAll(removeOwnRows);

test("a visitor sees when round 1 starts, and no group, table or band yet", async ({ browser }) => {
  const page = await browser.newPage();
  await visit(page, `/league/${LEAGUE.slug}`);
  const main = content(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LEAGUE.name);
  await expect(main).toContainText(SEASON);

  // The waiting message with round 1's date: "Az 1. kör november 23-án indul."
  await expect(main.getByRole("heading", { name: "Még nincsenek kint a csoportok" })).toBeVisible();
  const startsAt = phases[0]!.startsAt;
  const month = new Intl.DateTimeFormat("hu-HU", { month: "long", timeZone: "Europe/Budapest" }).format(startsAt);
  const day = Number(new Intl.DateTimeFormat("en", { day: "numeric", timeZone: "Europe/Budapest" }).format(startsAt));
  await expect(main).toContainText(new RegExp(`Az 1\\. kör ${month} ${day}-(án|én|jén) indul\\.`));

  // Nothing of a published phase: no group, table, division band or explainer.
  await expect(main.getByRole("region", { name: /csoport$/ })).toHaveCount(0);
  await expect(main.getByRole("table")).toHaveCount(0);
  await expect(main.getByRole("region", { name: /divízió$/ })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Hogyan működik?" })).toHaveCount(0);
  await expect(main).not.toContainText(/\d+\. kör, (indul|\d+\. hét)/);

  // No email address or phone number.
  await expect(main).not.toContainText("@");
  await expect(main).not.toContainText(/\+36|\b06[ -]?\d{2}/);

  // The way back to the landing page.
  await main.getByRole("link", { name: "Vissza a nyitólapra" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await page.close();
});
