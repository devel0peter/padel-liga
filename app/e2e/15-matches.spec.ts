// Walkthrough steps 17 to 19, 24 and 25 (#25, #26, #27, #31): after Közzététel (step 11) a player
// sees their group and matches on Kezdőlap, pairs propose and accept a slot,
// record and confirm an agreed time, nobody else can open the match, and a
// booked match gets its venue and is cancelled, once in time and once late;
// the cron gives the morning reminders and "holnap meccs" in the app (their emails are off, #191).
import { addDays, budapestClock, budapestDay, budapestTime } from "@padel-liga/rules";
import { devices, expect, test, type Page } from "@playwright/test";

import { PAIRS, as, content, d1, d1Update, emailsSince, logOffset, visit, waitForEmails, type Player } from "./support";

// A Budapest day `days` from today.
const inDays = (days: number) => addDays(budapestDay(new Date()), days);
// How the time pickers name a day (D144): "nov. 14., szombat".
const dayName = (day: string) =>
  new Intl.DateTimeFormat("hu-HU", { timeZone: "UTC", month: "short", day: "numeric", weekday: "long" }).format(new Date(`${day}T00:00:00Z`));
const hh = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

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

// Records an agreed time with the day and hour chips (D144); the form is open (D148).
async function recordAgreed(page: Page, day: string, hour: number) {
  const main = content(page);
  await main.getByRole("radiogroup", { name: "A meccs napja" }).getByRole("radio", { name: dayName(day) }).click();
  await main.getByRole("radiogroup", { name: "Kezdés" }).getByRole("radio", { name: `${dayName(day)} ${hh(hour)}` }).click();
  await page.getByRole("button", { name: "Rögzítem az időpontot" }).click();
}

test("17. Kezdőlap shows the group, the division line, the next match with phones, the group's matches with the week off, Teendők", async ({ browser }) => {
  const { context, page } = await as(browser, anna);
  await visit(page, "/home");
  const main = content(page);
  await expect(main.getByRole("heading", { name: "Teendők" })).toBeVisible();
  // Two groups: group 1 is Bronz, group 2 Réz (spec 4).
  await expect(main.getByText(/^(Bronz divízió, 1\. csoport|Réz divízió, 2\. csoport)$/)).toBeVisible();
  await expect(main.getByText("Hamarosan itt lesz a csoportod")).toHaveCount(0);
  // The group's matches under its table (D138): a group of 3, so 3 weeks, one
  // match each, and the pair rests one week; Anna's 2 matches open their page (D140).
  const fixtures = main.getByRole("group", { name: "A csoport meccsei" });
  await expect(fixtures.locator("li")).toHaveCount(3);
  await expect(fixtures.getByText(`Pihen: ${anna.name} – ${PAIRS.p1[1].name}`)).toHaveCount(1);
  await expect(fixtures.locator('a[href^="/matches/"]')).toHaveCount(2);
  // Both matches are a Teendő.
  await expect(main.getByRole("link", { name: /^Ajánlj időpontot/ })).toHaveCount(2);
  // Következő meccsetek (D140): the earliest match, its opponents tap to call and to write (D135).
  const [next] = annasMatches().sort((x, y) => x.week - y.week);
  const card = main.getByRole("region", { name: "Következő meccsetek" });
  await expect(card).toContainText("Egyeztetésre vár");
  await expect(card.getByRole("link", { name: "A meccs oldala" })).toHaveAttribute("href", `/matches/${next!.id}`);
  await expect(card.locator('a[href^="tel:"]')).toHaveCount(2);
  for (const o of next!.opponents) await expect(card.locator(`a[href="mailto:${o.email}"]`)).toHaveCount(1);
  // No other address shown: not Anna's, not her partner's; besides the two,
  // only the one Írj mindenkinek link (test 17a).
  await expect(main.getByRole("list", { name: "Az ellenfelek elérhetősége" }).locator('a[href^="mailto:"]')).toHaveCount(2);
  await expect(main.locator('a[href^="mailto:"]')).toHaveCount(3);
  await expect(main).not.toContainText(anna.email);
  await expect(main).not.toContainText(PAIRS.p1[1].email);
  await expect(fixtures.getByRole("region", { name: "1. hét" })).toBeVisible();
  await context.close();
});

test("17a. Írj mindenkinek on Kezdőlap and the match page: one SMS and one email to the partner and both opponents, never the player (D147)", async ({ browser }) => {
  const [next] = annasMatches().sort((x, y) => x.week - y.week);
  const partner = PAIRS.p1[1];
  const others = [partner, ...next!.opponents];
  const four = [anna, ...others];
  // Every player has the same number from the welcome page: four different
  // ones here, so Anna's own can be told apart. Put back at the end.
  const before = d1(`select email, phone from users where email in (${four.map((p) => `'${p.email}'`).join(", ")})`) as { email: string; phone: string | null }[];
  const number = (i: number) => `+3630111000${i}`;
  four.forEach((p, i) => d1Update(`update users set phone = '${number(i)}' where email = '${p.email}'`));
  try {
    const { context, page } = await as(browser, anna);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    for (const path of ["/home", `/matches/${next!.id}`]) {
      await visit(page, path);
      const box = content(page).getByRole("group", { name: "Írj mindenkinek" });
      await expect(box).toContainText("a párodnak és az ellenfeleknek");
      // Android's form on a desktop browser: sms:<numbers>?body=…
      const sms = (await box.getByRole("link", { name: "SMS mindenkinek" }).getAttribute("href"))!;
      expect(sms).toMatch(/^sms:\+36[\d,+]+\?body=/);
      expect(sms.slice(4, sms.indexOf("?")).split(",").sort()).toEqual([number(1), number(2), number(3)]);
      expect(sms).not.toContain(number(0));
      const body = decodeURIComponent(sms.split("body=")[1]!);
      expect(body).toContain(`${next!.week}. heti meccsünkről írok`);
      expect(body).toContain("rögzítsük az appban is:");
      expect(body).toMatch(new RegExp(`https?://[^/]+/matches/${next!.id}$`));
      // One email to the same three, with the subject.
      const mailto = (await box.getByRole("link", { name: "E-mail mindenkinek" }).getAttribute("href"))!;
      expect(mailto.slice(7, mailto.indexOf("?")).split(",").sort()).toEqual(others.map((p) => p.email).sort());
      expect(mailto).not.toContain(anna.email);
      expect(decodeURIComponent(mailto)).toContain(`subject=Padelpárbaj: ${next!.week}. heti meccs`);
      // The three numbers as shown, to the clipboard.
      await box.getByRole("button", { name: "Számok másolása" }).click();
      await expect(box.getByRole("status")).toHaveText("Kimásoltuk.");
      const copied = (await page.evaluate("navigator.clipboard.readText()")) as string;
      expect(copied.split(", ").sort()).toEqual(["+36 30 111 0001", "+36 30 111 0002", "+36 30 111 0003"]);
      await expect(box).not.toContainText("Nincs telefonszáma");
    }

    // An iPhone gets iOS's form after hydration: sms:/open?addresses=…&body=…
    const iphone = await browser.newContext({ storageState: await context.storageState(), userAgent: devices["iPhone 15"].userAgent });
    const ios = await iphone.newPage();
    await visit(ios, `/matches/${next!.id}`);
    const href = content(ios).getByRole("group", { name: "Írj mindenkinek" }).getByRole("link", { name: "SMS mindenkinek" });
    await expect(href).toHaveAttribute("href", /^sms:\/open\?addresses=\+36[\d,+]+&body=/);
    await iphone.close();

    // A partner without a number: left out of the SMS, named under the buttons.
    d1Update(`update users set phone = null where email = '${partner.email}'`);
    await visit(page, `/matches/${next!.id}`);
    const box = content(page).getByRole("group", { name: "Írj mindenkinek" });
    const sms = (await box.getByRole("link", { name: "SMS mindenkinek" }).getAttribute("href"))!;
    expect(sms.slice(4, sms.indexOf("?")).split(",").sort()).toEqual([number(2), number(3)]);
    await expect(box).toContainText(`Nincs telefonszáma: ${partner.name}`);
    expect(await box.getByRole("link", { name: "E-mail mindenkinek" }).getAttribute("href")).toContain(partner.email);

    // A tap counts as trying to schedule (D148): the page tells the app in the
    // background, and Napló says the SMS app was opened. Copying adds nothing.
    const napló = content(page).getByRole("region", { name: "Napló" });
    await expect(napló).not.toContainText("indított a többieknek");
    const contact = page.waitForResponse((r) => r.url().endsWith(`/matches/${next!.id}/contact`) && r.request().method() === "POST");
    await box.getByRole("link", { name: "SMS mindenkinek" }).click();
    expect((await contact).status()).toBe(204);
    await visit(page, `/matches/${next!.id}`);
    await expect(napló.getByRole("listitem").filter({ hasText: "SMS-t indított a többieknek" })).toContainText(`${anna.name} (ti)`);
    await context.close();
  } finally {
    for (const p of before) d1Update(`update users set phone = ${p.phone === null ? "null" : `'${p.phone}'`} where email = '${p.email}'`);
  }
});

test("18. propose → accept: a refused proposal, the email to the other pair, scheduled for both", async ({ browser }) => {
  const [first] = annasMatches();
  const [opponent] = first!.opponents;
  const player = await as(browser, anna);
  await visit(player.page, `/matches/${first!.id}`);
  const main = content(player.page);
  await expect(main.getByRole("heading", { name: "Hogyan egyeztessetek?" })).toBeVisible();
  await expect(main).toContainText("adjátok meg, mikor értek rá, legalább 2 különböző napra");
  // No time yet (D148): first write to each other, then record the time (open);
  // the ranges are folded below.
  await expect(main.getByRole("region", { name: "Írjatok egymásnak" })).toContainText("Beszéljétek meg SMS-ben vagy e-mailben");
  await expect(main.getByRole("region", { name: "Megbeszéltétek? Rögzítsétek az időpontot" }).getByRole("button", { name: "Rögzítem az időpontot" })).toBeVisible();

  // Availability ranges with chips (D144). One day only: refused with the rules' own message.
  const PROPOSE = "Vagy adjátok meg, mikor értek rá, és a másik pár választ";
  await main.getByText(PROPOSE).click();
  const propose = main.getByRole("group", { name: PROPOSE });
  await expect(propose).toContainText("Adjatok meg ráérést legalább 2 különböző napra.");
  const days = propose.getByRole("radiogroup", { name: "Nap" });
  await days.getByRole("radio", { name: dayName(inDays(4)) }).click();
  await propose.getByRole("button", { name: "Délután 14–18" }).click();
  // The same day again, overlapping: joined into one range.
  await propose.getByLabel("Ettől").click();
  await player.page.getByRole("option", { name: "16:00" }).click();
  await propose.getByLabel("Eddig").click();
  await player.page.getByRole("option", { name: "19:00" }).click();
  await propose.getByRole("button", { name: "Hozzáadom" }).click();
  const list = propose.getByRole("list", { name: "Ráérésetek" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("14:00–19:00");
  await propose.getByRole("button", { name: "Elküldöm, mikor érünk rá" }).click();
  await expect(propose.getByRole("alert")).toContainText("Legalább 2 különböző napot adj meg.");

  // A second day, its own range: sent.
  const offset = logOffset();
  await days.getByRole("radio", { name: dayName(inDays(5)) }).click();
  await propose.getByLabel("Ettől").click();
  await player.page.getByRole("option", { name: "19:00" }).click();
  await propose.getByLabel("Eddig").click();
  await player.page.getByRole("option", { name: "21:00" }).click();
  await propose.getByRole("button", { name: "Hozzáadom" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await propose.getByRole("button", { name: "Elküldöm, mikor érünk rá" }).click();
  await expect(main.getByRole("status").filter({ hasText: "Elküldtük a másik párnak, mikor értek rá." })).toBeVisible();
  await expect(status(player.page)).toContainText("Ajánlottatok időpontokat, várjuk a másik pár válaszát");
  await expect(main.getByRole("heading", { name: "Ekkor értek rá" })).toBeVisible();
  await expect(main.getByRole("region", { name: "Ekkor értek rá" })).toContainText("14:00–19:00");

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
  // Every whole hour a match fits in: 14:00–19:00 and 19:00–21:00 give 5 and 2; they pick 20:00.
  const starts = content(other.page).getByRole("radiogroup", { name: "Választható időpontok" });
  await expect(starts.getByRole("radio")).toHaveCount(5 + 2);
  await starts.getByRole("radio", { name: `${dayName(inDays(5))} 20:00` }).click();
  await other.page.getByRole("button", { name: "Elfogadom" }).click();
  await expect(content(other.page).getByRole("status").filter({ hasText: "Lefixáltátok a meccset." })).toBeVisible();
  await expect(status(other.page)).toContainText(/Lefixálva: .*20:00/);
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
  // The log: both steps (and anna's SMS tap from test 17a), with who did them.
  const log = content(other.page).getByRole("region", { name: "Napló" });
  await expect(log.getByRole("listitem")).toHaveCount(3);
  await expect(log).toContainText(`${anna.name} (ellenfél)`);
  await expect(log).toContainText(`${opponent!.name} (ti)`);
  await other.context.close();

  // Anna's partner sees it scheduled too.
  const partner = await as(browser, PAIRS.p1[1]);
  await visit(partner.page, "/home");
  // In the group's matches the fixed one shows its time (D140).
  await expect(content(partner.page).getByRole("group", { name: "A csoport meccsei" }).locator(`a[href="/matches/${first!.id}"]`)).toContainText("20:00");
  await partner.context.close();
  await player.context.close();
});

test("19. agreed time → confirm; nobody outside the two pairs can open the match", async ({ browser }) => {
  const [, second] = annasMatches();
  const [opponent] = second!.opponents;
  const player = await as(browser, anna);
  await visit(player.page, `/matches/${second!.id}`);
  const offset = logOffset();
  // Tomorrow, the last start of the day, with the day and hour chips (D144).
  // The form is open under Írjatok egymásnak (D148).
  await recordAgreed(player.page, inDays(1), 22);
  // Fixed by itself in 24 hours (or at the start, if sooner) unless the other pair objects (D148).
  await expect(content(player.page).getByRole("status").filter({ hasText: /^Rögzítettük\. Fix lesz .*-kor, ha a másik pár nem jelez\.$/ })).toBeVisible();
  await expect(status(player.page)).toContainText("ha a másik pár nem jelez");
  const sent = await waitForEmails(offset, 2, (m) => m.subject.startsWith("Megbeszélt időpont a meccsetekre"));
  expect(sent.map((m) => m.to).sort()).toEqual(second!.opponents.map((p) => p.email).sort());

  const other = await as(browser, opponent!);
  await visit(other.page, `/matches/${second!.id}`);
  const confirm = content(other.page).getByRole("region", { name: "Megerősíted az időpontot?" });
  await expect(confirm).toContainText("ha nem jelzitek, hogy nem így beszéltétek");
  await other.page.getByRole("button", { name: "Megerősítem" }).click();
  await expect(status(other.page)).toContainText(/Lefixálva: .*22:00/);
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

// The first start the agreed-time chips offer at least 2 hours from now
// (7:00–22:00 Budapest): always under 24 hours ahead, so cancelling it is late.
function soonStart(): { day: string; hour: number } {
  const { day, minutes } = budapestClock(new Date(Date.now() + 2 * 3_600_000));
  const hour = Math.ceil(minutes / 60);
  if (hour < 7) return { day, hour: 7 };
  return hour > 22 ? { day: addDays(day, 1), hour: 7 } : { day, hour };
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
  // The folded result form has its own court field (D146): this one is the venue form's.
  await main.getByRole("region", { name: "Hol lesz a meccs?" }).getByLabel("Pálya (nem kötelező)").fill("2-es pálya");
  await player.page.getByRole("button", { name: "Mentem a helyszínt" }).click();
  await expect(main.getByRole("status").filter({ hasText: "Rögzítettük a helyszínt." })).toBeVisible();
  await expect(status(player.page)).toContainText("Minta Padel Aréna, 2-es pálya");
  const other = await as(browser, opponent!);
  await visit(other.page, `/matches/${first!.id}`);
  await expect(status(other.page)).toContainText("Minta Padel Aréna, 2-es pálya");

  // Days ahead: not late, back to scheduling for both. Cancelling is folded (D133).
  await main.getByText("Mégsem jó az időpont?").click();
  await main.getByRole("button", { name: "Lemondom a meccset" }).click();
  await expect(player.page.getByRole("alertdialog", { name: "Lemondod a meccset?" })).toBeVisible();
  await player.page.getByRole("button", { name: "Lemondom", exact: true }).click();
  await expect(main.getByRole("status").filter({ hasText: "Lemondtátok. Egyeztessetek új időpontot." })).toBeVisible();
  await expect(status(player.page)).toContainText("Egyeztetésre vár");

  // The other pair records a time 3 hours from now, anna confirms, then cancels: late.
  await visit(other.page, `/matches/${first!.id}`);
  const soon = soonStart();
  await recordAgreed(other.page, soon.day, soon.hour);
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
