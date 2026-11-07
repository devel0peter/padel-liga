// Walkthrough steps 17 to 19, 24 and 25 (#25, #26, #27, #31): after Közzététel (step 11) a player
// sees their group and matches on Kezdőlap, pairs propose and accept a slot,
// record and confirm an agreed time, nobody else can open the match, and a
// booked match gets its venue and is cancelled, once in time and once late;
// the cron gives the morning reminders and "holnap meccs" in the app (their emails are off, #191).
import { addDays, budapestClock, budapestDay, budapestTime } from "@padel-liga/rules";
import { expect, test, type Page } from "@playwright/test";

import { PAIRS, as, content, d1, emailsSince, logOffset, visit, waitForEmails, type Player } from "./support";

// A datetime-local value `days` from today at hh:mm, Budapest time.
const slot = (days: number, time: string) => `${addDays(budapestDay(new Date()), days)}T${time}`;

const anna = PAIRS.p1[0];

// The match ids of anna's pair, by week, and who plays against her there.
function annasMatches(): { id: number; week: number; opponents: Player[] }[] {
  const rows = d1(
    `select m.id, m.week, ua.email as a1, ub.email as a2, va.email as b1, vb.email as b2 from matches m
     join pairs pa on pa.id = m.pair_a join users ua on ua.id = pa.player_a join users ub on ub.id = pa.player_b
     join pairs pb on pb.id = m.pair_b join users va on va.id = pb.player_a join users vb on vb.id = pb.player_b
     where '${anna.email}' in (ua.email, ub.email, va.email, vb.email) order by m.week`,
  ) as { id: number; week: number; a1: string; a2: string; b1: string; b2: string }[];
  const everyone = Object.values(PAIRS).flat();
  return rows.map((r) => {
    const theirs = [r.a1, r.a2].includes(anna.email) ? [r.b1, r.b2] : [r.a1, r.a2];
    return { id: r.id, week: r.week, opponents: theirs.map((e) => everyone.find((p) => p.email === e)!) };
  });
}

const status = (page: Page) => page.getByRole("region", { name: "Állapot" });

test("17. Kezdőlap shows the group, the division line, the matches by week with the week off, Teendők and phones", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  await visit(page, "/home");
  const main = content(page);
  await expect(main.getByRole("heading", { name: "Teendők" })).toBeVisible();
  // Two groups: group 1 is Bronz, group 2 Réz (spec 4).
  await expect(main.getByText(/^(Bronz divízió, 1\. csoport|Réz divízió, 2\. csoport)$/)).toBeVisible();
  await expect(main.getByText("Hamarosan itt lesz a csoportod")).toHaveCount(0);
  // A group of 3: 2 matches and the week off.
  const matches = main.getByRole("list", { name: "Meccseitek" });
  await expect(matches.locator(":scope > li")).toHaveCount(3);
  await expect(matches.getByText("Pihenőhét: ezen a héten nem játszotok.")).toHaveCount(1);
  await expect(matches.getByRole("link", { name: "Egyeztetés és részletek" })).toHaveCount(2);
  await expect(matches.getByText("Egyeztetésre vár")).toHaveCount(2);
  // Both matches are a Teendő; the opponents' phones are tap to call.
  await expect(main.getByRole("link", { name: /^Ajánlj időpontot/ })).toHaveCount(2);
  await expect(matches.locator('a[href^="tel:"]')).toHaveCount(4);
  await expect(main).not.toContainText("@example.test");
  await context.close();
});

test("18. propose → accept: a refused proposal, the email to the other pair, scheduled for both", async ({ browser }) => {
  const [first] = annasMatches();
  const [opponent] = first!.opponents;
  const player = await as(browser, anna);
  await visit(player.page, `/matches/${first!.id}`);
  const main = content(player.page);
  await expect(main.getByRole("heading", { name: "Hogyan egyeztessetek?" })).toBeVisible();
  await expect(main).toContainText("Ajánljatok legalább 3 időpontot, legalább 2 különböző napra");

  // Two slots on one day: refused with the rules' own messages.
  await player.page.getByLabel("1. időpont").fill(slot(4, "18:00"));
  await player.page.getByLabel("2. időpont").fill(slot(4, "06:30"));
  await player.page.getByRole("button", { name: "Elküldöm az időpontokat" }).click();
  await expect(main.getByRole("alert")).toContainText("Legalább 3 különböző időpontot ajánlj.");
  await expect(main.getByRole("alert")).toContainText("Az időpontok legalább 2 különböző napra essenek.");
  await expect(main.getByText("Az időpont 7:00 és 22:00 között kezdődjön.").first()).toBeVisible();

  const offset = logOffset();
  await player.page.getByLabel("2. időpont").fill(slot(5, "19:30"));
  await player.page.getByLabel("3. időpont").fill(slot(6, "10:00"));
  await player.page.getByRole("button", { name: "Elküldöm az időpontokat" }).click();
  await expect(main.getByRole("status").filter({ hasText: "Elküldtük az időpontokat a másik párnak." })).toBeVisible();
  await expect(status(player.page)).toContainText("Ajánlottatok időpontokat, a másik pár válaszára vár");
  await expect(main.getByRole("heading", { name: "Ezeket ajánlottátok" })).toBeVisible();

  // Instant email to both players of the other pair, with the link.
  const sent = await waitForEmails(offset, 2, (m) => m.subject.startsWith("Időpontokat ajánlottak"));
  expect(sent.map((m) => m.to).sort()).toEqual(first!.opponents.map((p) => p.email).sort());
  expect(sent[0]!.text).toContain(`/matches/${first!.id}`);
  expect(sent[0]!.text).not.toContain(anna.email);

  // The other pair: a Teendő on Kezdőlap, then accept one slot.
  const other = await as(browser, opponent!);
  await visit(other.page, "/home");
  await content(other.page).getByRole("link", { name: /^Válaszolj az időpont-ajánlatra/ }).click();
  await expect(other.page).toHaveURL(new RegExp(`/matches/${first!.id}$`));
  await other.page.waitForLoadState("networkidle");
  await content(other.page).getByRole("radiogroup", { name: "Ajánlott időpontok" }).getByRole("radio").nth(1).click();
  await other.page.getByRole("button", { name: "Elfogadom" }).click();
  await expect(content(other.page).getByRole("status").filter({ hasText: "Lefixáltátok a meccset." })).toBeVisible();
  await expect(status(other.page)).toContainText(/Lefixálva: .*19:30/);
  // Add to calendar (#192): the Google link and the .ics, with names and no contact data.
  const calendar = content(other.page).getByLabel("Naptárba");
  const google = new URL((await calendar.getByRole("link", { name: "Google Naptár" }).getAttribute("href"))!);
  expect(google.origin + google.pathname).toBe("https://calendar.google.com/calendar/render");
  expect(google.searchParams.get("ctz")).toBe("Europe/Budapest");
  expect(google.searchParams.get("details")).toContain(anna.name);
  const icsHref = (await calendar.getByRole("link", { name: ".ics letöltése" }).getAttribute("href"))!;
  expect(icsHref).toBe(`/matches/${first!.id}/calendar.ics`);
  const ics = await other.context.request.get(icsHref);
  expect(ics.status()).toBe(200);
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  const icsText = (await ics.text()).replace(/\r\n /g, "");
  expect(icsText).toContain(`UID:match-${first!.id}@padelparbaj.hu`);
  expect(icsText).toContain("STATUS:CONFIRMED");
  expect(icsText).toContain(anna.name);
  expect(icsText.replace(/UID:\S+/, "")).not.toContain("@");
  // The log: both steps, with who did them.
  const log = content(other.page).getByRole("region", { name: "Napló" });
  await expect(log.getByRole("listitem")).toHaveCount(2);
  await expect(log).toContainText(`${anna.name} (ellenfél)`);
  await expect(log).toContainText(`${opponent!.name} (ti)`);
  await other.context.close();

  // Anna's partner sees it scheduled too.
  const partner = await as(browser, PAIRS.p1[1]);
  await visit(partner.page, "/home");
  await expect(content(partner.page).getByRole("list", { name: "Meccseitek" })).toContainText(/Lefixálva: .*19:30/);
  await partner.context.close();
  await player.context.close();
});

test("19. agreed time → confirm; nobody outside the two pairs can open the match", async ({ browser }) => {
  const [, second] = annasMatches();
  const [opponent] = second!.opponents;
  const player = await as(browser, anna);
  await visit(player.page, `/matches/${second!.id}`);
  const offset = logOffset();
  // Late in the evening: an agreed time has no time window (spec 6.3). It is
  // folded under the proposal form (D128).
  await player.page.getByText("Máshol már megbeszéltétek?").click();
  await player.page.getByLabel("Megbeszélt időpont").fill(slot(1, "23:00"));
  await player.page.getByRole("button", { name: "Rögzítem az időpontot" }).click();
  await expect(content(player.page).getByRole("status").filter({ hasText: "Rögzítettük. A másik pár megerősíti." })).toBeVisible();
  await expect(status(player.page)).toContainText("a másik pár megerősítésére vár");
  const sent = await waitForEmails(offset, 2, (m) => m.subject.startsWith("Erősítsd meg a meccs időpontját"));
  expect(sent.map((m) => m.to).sort()).toEqual(second!.opponents.map((p) => p.email).sort());

  const other = await as(browser, opponent!);
  await visit(other.page, `/matches/${second!.id}`);
  await expect(content(other.page).getByText("Megerősíted az időpontot?")).toBeVisible();
  await other.page.getByRole("button", { name: "Megerősítem" }).click();
  await expect(status(other.page)).toContainText(/Lefixálva: .*23:00/);
  const log = content(other.page).getByRole("region", { name: "Napló" });
  await expect(log).toContainText("Rögzítette a megbeszélt időpontot");
  await expect(log).toContainText("Megerősítette a megbeszélt időpontot");
  await other.context.close();

  // A player of the other group gets a 404, not the match.
  const everyone = Object.values(PAIRS).flat();
  const inMatch = new Set([anna, PAIRS.p1[1], ...second!.opponents].map((p) => p.email));
  const outsider = everyone.find(
    (p) => !inMatch.has(p.email) && d1(`select 1 from users where email = '${p.email}' and consent_at is not null`).length > 0,
  )!;
  const stranger = await as(browser, outsider);
  const response = await stranger.page.goto(`/matches/${second!.id}`);
  expect(response?.status()).toBe(404);
  await expect(stranger.page.getByText("Ez az oldal nem létezik.")).toBeVisible();
  await stranger.context.close();
  await player.context.close();
});

// A datetime-local value about `hours` from now, on the hour, Budapest time.
function hoursAhead(hours: number): string {
  const { day, minutes } = budapestClock(new Date(Date.now() + hours * 3_600_000));
  return `${day}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:00`;
}

test("24. venue, then a cancellation 4 days ahead and a late one: the log says who and that it was late (#27)", async ({ browser }) => {
  const [first] = annasMatches();
  const [opponent] = first!.opponents;
  const player = await as(browser, anna);
  await visit(player.page, `/matches/${first!.id}`);
  const main = content(player.page);

  // The venue: only the city's active clubs; both pairs see it.
  await player.page.getByLabel("Helyszín").click();
  await player.page.getByRole("option", { name: "Minta Padel Aréna" }).click();
  await player.page.getByLabel("Pálya (nem kötelező)").fill("2-es pálya");
  await player.page.getByRole("button", { name: "Mentem a helyszínt" }).click();
  await expect(main.getByRole("status").filter({ hasText: "Rögzítettük a helyszínt." })).toBeVisible();
  await expect(status(player.page)).toContainText("Minta Padel Aréna, 2-es pálya");
  const other = await as(browser, opponent!);
  await visit(other.page, `/matches/${first!.id}`);
  await expect(status(other.page)).toContainText("Minta Padel Aréna, 2-es pálya");

  // Days ahead: not late, back to scheduling for both. Cancelling is folded (D128).
  await main.getByText("Mégsem jó az időpont?").click();
  await main.getByRole("button", { name: "Lemondom a meccset" }).click();
  await expect(player.page.getByRole("alertdialog", { name: "Lemondod a meccset?" })).toBeVisible();
  await player.page.getByRole("button", { name: "Lemondom", exact: true }).click();
  await expect(main.getByRole("status").filter({ hasText: "Lemondtátok. Egyeztessetek új időpontot." })).toBeVisible();
  await expect(status(player.page)).toContainText("Egyeztetésre vár");

  // The other pair records a time 3 hours from now, anna confirms, then cancels: late.
  await visit(other.page, `/matches/${first!.id}`);
  await other.page.getByText("Máshol már megbeszéltétek?").click();
  await other.page.getByLabel("Megbeszélt időpont").fill(hoursAhead(3));
  await other.page.getByRole("button", { name: "Rögzítem az időpontot" }).click();
  await expect(content(other.page).getByRole("status").filter({ hasText: "Rögzítettük." })).toBeVisible();
  await visit(player.page, `/matches/${first!.id}`);
  await player.page.getByRole("button", { name: "Megerősítem" }).click();
  await expect(status(player.page)).toContainText("Lefixálva");
  await expect(main).toContainText("ez késői lemondás");
  await main.getByText("Mégsem jó az időpont?").click();
  await main.getByRole("button", { name: "Lemondom a meccset" }).click();
  await expect(player.page.getByRole("alertdialog", { name: "Késői lemondás. Biztosan lemondod?" })).toBeVisible();
  await player.page.getByRole("button", { name: "Lemondom", exact: true }).click();
  await expect(main.getByRole("status").filter({ hasText: "nektek kell új időpontokat ajánlani" })).toBeVisible();
  await expect(status(player.page)).toContainText("Későn mondtátok le, nektek kell új időpontokat ajánlani");
  const log = main.getByRole("region", { name: "Napló" });
  await expect(log.getByRole("listitem").filter({ hasText: "Késői lemondás" })).toContainText(`${anna.name} (ti)`);
  await expect(log.getByRole("listitem").filter({ hasText: "Lemondta a meccset" })).toHaveCount(2);

  // The other pair: told it's on anna's pair, no Teendő for this match.
  await visit(other.page, `/matches/${first!.id}`);
  await expect(status(other.page)).toContainText("Későn mondták le, nekik kell új időpontokat ajánlaniuk");
  await expect(content(other.page).getByRole("region", { name: "Napló" })).toContainText(`${anna.name} (ellenfél)`);
  await visit(other.page, "/home");
  await expect(content(other.page).getByRole("link", { name: new RegExp(`^Ajánlj időpontot \\(.*${anna.name}`) })).toHaveCount(0);
  await other.context.close();
  await player.context.close();
});

// Runs the cron as if it were `at` (#31).
async function cron(page: Page, at: Date) {
  const response = await page.request.get(`/cdn-cgi/local/scheduled?time=${at.getTime()}`);
  expect(response.ok()).toBe(true);
}

const isDigest = (m: { text: string }) => m.text.includes("Ez történt a meccseiddel");

test("25. the cron: 07:00 and holnap meccs the evening before, in the app only; no digest or holnap email (#31, #191)", async ({ browser }) => {
  const [, second] = annasMatches();
  const player = await as(browser, anna);
  const today = budapestDay(new Date());
  // The next 07:00 Budapest: within a day, so this run's items are in its window.
  const sevenToday = budapestTime(today, 7, 0);
  const seven = sevenToday.getTime() > Date.now() ? sevenToday : budapestTime(addDays(today, 1), 7, 0);
  const cronMail = () => Number(d1(`select count(*) as n from email_messages where kind in ('match_digest', 'match_tomorrow')`)[0]!.n);
  const tomorrowNotices = () =>
    d1(`select u.email from notifications n join users u on u.id = n.user_id where n.kind = 'match_tomorrow' and n.url = '/matches/${second!.id}'`).map(
      (r) => r.email as string,
    );

  // 07:00 (steps 18–20 left anna an unread digest item), again that morning
  // and at noon; then 18:00 today: the second match is fixed for tomorrow
  // 23:00 (step 19), so "holnap meccs", then 19:00.
  const first = logOffset();
  await cron(player.page, seven);
  await cron(player.page, new Date(seven.getTime() + 30 * 60_000));
  await cron(player.page, budapestTime(today, 12, 0));
  await cron(player.page, budapestTime(today, 18, 0));
  await expect.poll(() => tomorrowNotices().length, { timeout: 20_000 }).toBe(4);
  await cron(player.page, budapestTime(today, 19, 0));
  // Once, to the four players, in the app (and by push).
  expect(tomorrowNotices().sort()).toEqual([anna, PAIRS.p1[1], ...second!.opponents].map((p) => p.email).sort());
  // Both emails are off for now (#191, D83).
  expect(cronMail()).toBe(0);
  expect(emailsSince(first).filter((m) => isDigest(m) || m.subject.startsWith("Holnap meccs"))).toEqual([]);
  await visit(player.page, "/notifications");
  await expect(content(player.page)).toContainText("Holnap meccs");
  await player.context.close();
});
