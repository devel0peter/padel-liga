// Walkthrough steps 27 and 28 (#28, #29): after the match of step 18, one
// pair records the result (an invalid one first), the other gets the email
// and confirms it, and it shows as played for both pairs; on the match of
// step 19 the other pair disputes the result and the Szervező decides it on
// Viták, with a reason in the log.
// Runs after 16-public-ladder (every pair still at zero) and 17-match-overview.
import { expect, test, type Page } from "@playwright/test";

import { ORGANIZER, PAIRS, as, content, d1, logOffset, visit, waitForEmails, type Player } from "./support";

const anna = PAIRS.p1[0];

// Anna's matches by week, with the other pair's players (as in 15-matches).
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

// The match as the organizer pages name it (#202, #220): "X a Y ellen", the
// 1st pair first, "az" before a vowel.
function versus(matchId: number): string {
  const [r] = d1(
    `select ua.name as a1, ub.name as a2, va.name as b1, vb.name as b2 from matches m
     join pairs pa on pa.id = m.pair_a join users ua on ua.id = pa.player_a join users ub on ub.id = pa.player_b
     join pairs pb on pb.id = m.pair_b join users va on va.id = pb.player_a join users vb on vb.id = pb.player_b
     where m.id = ${matchId}`,
  ) as { a1: string; a2: string; b1: string; b2: string }[];
  const b = `${r!.b1} – ${r!.b2}`;
  return `${r!.a1} – ${r!.a2} ${/^[aáeéiíoóöőuúüű]/i.test(b) ? "az" : "a"} ${b} ellen`;
}

const status = (page: Page) => page.getByRole("region", { name: "Állapot" });
const result = (page: Page) => content(page).getByRole("region", { name: "Eredmény" });

async function fillScore(page: Page, rows: [string, string][]) {
  const labels = ["1. szett", "2. szett", "Szuper tie-break (csak 1:1-nél)"];
  for (const [i, [us, them]] of rows.entries()) {
    await result(page).getByLabel(`${labels[i]}, Ti`).fill(us);
    await result(page).getByLabel(`${labels[i]}, Ők`).fill(them);
  }
}

test("22. record → confirm: an invalid score refused, the email, played for both pairs", async ({ browser }) => {
  const [first] = annasMatches();
  const [opponent] = first!.opponents;
  const player = await as(browser, anna);
  // Before any result the group card on Kezdőlap lists the pairs, no table (#201, #220).
  await visit(player.page, "/home");
  const pairList = content(player.page).getByRole("list", { name: "Párok" });
  await expect(pairList.getByRole("listitem").filter({ hasText: "(ti)" })).toContainText(anna.name);
  await expect(content(player.page).getByRole("table", { name: "Tabella" })).toHaveCount(0);

  await visit(player.page, `/matches/${first!.id}`);
  await expect(result(player.page).getByText("Eredmény rögzítése")).toBeVisible();

  // 4:3 doesn't end a set: the engine's Hungarian message.
  await fillScore(player.page, [
    ["4", "3"],
    ["4", "1"],
  ]);
  await player.page.getByRole("button", { name: "Rögzítem az eredményt" }).click();
  await expect(result(player.page).getByRole("alert")).toContainText("1. szett: 4:3 nem lehet.");

  const offset = logOffset();
  await fillScore(player.page, [
    ["4", "1"],
    ["2", "4"],
    ["10", "8"],
  ]);
  await player.page.getByRole("button", { name: "Rögzítem az eredményt" }).click();
  await expect(content(player.page).getByRole("status").filter({ hasText: "Rögzítettük. A másik pár megerősíti." })).toBeVisible();
  await expect(status(player.page)).toContainText("Rögzítettétek: 4:1, 2:4, szuper tie-break 10:8, a másik pár megerősítésére vár");

  // Instant email to the other pair, the score from their side, the link.
  const sent = await waitForEmails(offset, 2, (m) => m.subject.startsWith("Erősítsd meg a meccs eredményét"));
  expect(sent.map((m) => m.to).sort()).toEqual(first!.opponents.map((p) => p.email).sort());
  expect(sent[0]!.text).toContain("1:4, 4:2, szuper tie-break 8:10");
  expect(sent[0]!.text).toContain(`/matches/${first!.id}#eredmeny`);

  // The other pair: a Teendő on Kezdőlap, then confirm.
  const other = await as(browser, opponent!);
  await visit(other.page, "/home");
  await content(other.page).getByRole("link", { name: /^Erősítsd meg az eredményt/ }).click();
  await expect(other.page).toHaveURL(new RegExp(`/matches/${first!.id}$`));
  await other.page.waitForLoadState("networkidle");
  await expect(result(other.page)).toContainText("Az ellenfeletek ezt rögzítette (ti vagytok elöl): 1:4, 4:2, szuper tie-break 8:10.");
  await other.page.getByRole("button", { name: "Megerősítem" }).click();
  await expect(content(other.page).getByRole("status").filter({ hasText: "Megerősítetted, az eredmény végleges." })).toBeVisible();
  await expect(status(other.page)).toContainText("Lejátszva: 1:4, 4:2, szuper tie-break 8:10 (kikaptatok)");
  const log = content(other.page).getByRole("region", { name: "Napló" });
  await expect(log).toContainText("Rögzítette az eredményt: 1:4, 4:2, szuper tie-break 8:10");
  await expect(log).toContainText("Megerősítette az eredményt");
  await other.context.close();

  // Played for anna's side too, on Kezdőlap.
  const partner = await as(browser, PAIRS.p1[1]);
  await visit(partner.page, "/home");
  await expect(content(partner.page).getByRole("list", { name: "Meccseitek" })).toContainText("Lejátszva: 4:1, 2:4, szuper tie-break 10:8 (nyertetek)");
  // The card now shows the table (#201, #220): their row has the match and the
  // win's 3 points. Columns: #, Pár, M, P, Szett, Játék.
  await expect(content(partner.page).getByRole("list", { name: "Párok" })).toHaveCount(0);
  const ours = content(partner.page).getByRole("table", { name: "Tabella" }).getByRole("row").filter({ hasText: "(ti)" });
  await expect(ours.getByRole("cell").nth(2)).toHaveText("1");
  await expect(ours.getByRole("cell").nth(3)).toHaveText("3");
  await partner.context.close();
  await player.context.close();
});

test("23. dispute → the Szervező decides on Viták; a player can't open it", async ({ browser }) => {
  const [, second] = annasMatches();
  const [opponent] = second!.opponents;
  // Anna records a 2:0 win on her other match (scheduled in step 19).
  const player = await as(browser, anna);
  await visit(player.page, `/matches/${second!.id}`);
  await fillScore(player.page, [
    ["4", "2"],
    ["5", "3"],
  ]);
  await player.page.getByRole("button", { name: "Rögzítem az eredményt" }).click();
  await expect(content(player.page).getByRole("status").filter({ hasText: "Rögzítettük." })).toBeVisible();

  // The other pair disputes it with its own version and a note.
  const other = await as(browser, opponent!);
  await visit(other.page, `/matches/${second!.id}`);
  await expect(result(other.page).getByText("Nem így volt?")).toBeVisible();
  const dispute = result(other.page).locator("form").filter({ has: other.page.getByRole("button", { name: "Vitatom az eredményt" }) });
  await dispute.getByLabel("1. szett, Ti").fill("4");
  await dispute.getByLabel("1. szett, Ők").fill("2");
  await dispute.getByLabel("2. szett, Ti").fill("3");
  await dispute.getByLabel("2. szett, Ők").fill("5");
  await dispute.getByLabel("Szuper tie-break (csak 1:1-nél), Ti").fill("10");
  await dispute.getByLabel("Szuper tie-break (csak 1:1-nél), Ők").fill("7");
  await dispute.getByLabel("Megjegyzés a szervezőnek (nem kötelező)").fill("A szuper tie-breaket mi nyertük.");
  await other.page.getByRole("button", { name: "Vitatom az eredményt" }).click();
  await expect(content(other.page).getByRole("status").filter({ hasText: "Jeleztük a szervezőnek, ő dönt." })).toBeVisible();
  await expect(status(other.page)).toContainText("Vitatott eredmény, a szervező dönt");

  // A player gets 403 on the organizer pages.
  const refused = await other.page.goto("/admin/leagues/minta/disputes");
  expect(refused?.status()).toBe(403);
  const refusedDecide = await other.page.goto(`/admin/leagues/minta/matches/${second!.id}/decide`);
  expect(refusedDecide?.status()).toBe(403);
  await other.context.close();

  // The recording pair is told at once, in the app (#178); no names in the text.
  await visit(player.page, "/notifications");
  await expect(content(player.page)).toContainText("Vitatják az eredményt");

  // The Szervező is told too, and the notice opens the decision page (#178).
  const org = await as(browser, ORGANIZER.email);
  await visit(org.page, "/notifications");
  await content(org.page).getByText("Vitatott eredmény · ").first().click();
  await expect(org.page).toHaveURL(new RegExp(`/admin/leagues/minta/matches/${second!.id}/decide$`));

  // Viták lists it with both versions, then the Szervező decides.
  await visit(org.page, "/admin/leagues/minta/disputes");
  const main = content(org.page);
  await expect(main.getByRole("heading", { name: "Vitatott eredmények (1)" })).toBeVisible();
  await expect(main).not.toContainText("@example.test");
  // The match is named "X a Y ellen" on Viták, its decision page and Meccsek (#202, #220).
  const named = versus(second!.id);
  await expect(main.getByRole("region", { name: /^Vitatott eredmények/ })).toContainText(named);
  await main.getByRole("link", { name: "Döntök" }).click();
  await expect(org.page).toHaveURL(new RegExp(`/admin/leagues/minta/matches/${second!.id}/decide$`));
  await org.page.waitForLoadState("networkidle");
  await expect(content(org.page).getByRole("heading", { level: 1 })).toHaveText(named);
  await expect(content(org.page)).toContainText("Megjegyzés: A szuper tie-breaket mi nyertük.");
  await expect(content(org.page).getByRole("region", { name: "Napló" })).toContainText("Vitatta az eredményt");
  await content(org.page).getByRole("radio", { name: /^Mindkét pár vereséget kap/ }).click();
  await org.page.getByLabel("Indoklás").fill("Nem tudtak megegyezni, és egyik változat sem igazolható.");
  await org.page.getByRole("button", { name: "Döntés mentése" }).click();
  await expect(content(org.page).getByRole("status").filter({ hasText: "Elmentettük a döntést." })).toBeVisible();
  await expect(content(org.page).getByRole("region", { name: "Napló" })).toContainText(
    "Döntés: Mindkét pár vereséget kap (0:4, 0:4). Indoklás: Nem tudtak megegyezni",
  );
  await visit(org.page, "/admin/leagues/minta/disputes");
  await expect(content(org.page).getByRole("heading", { name: "Vitatott eredmények (0)" })).toBeVisible();
  // Meccsek (#158) shows the results: the decision, and the confirmed one.
  await visit(org.page, "/admin/leagues/minta/matches");
  await expect(content(org.page)).toContainText("Döntés: Mindkét pár vereséget kap (0:4, 0:4)");
  await expect(content(org.page)).toContainText(named);
  // From the 1st pair's side, whichever Anna's pair is.
  await expect(content(org.page)).toContainText(/Lejátszva: (4:1, 2:4, szuper tie-break 10:8|1:4, 4:2, szuper tie-break 8:10)/);
  await org.context.close();

  // Both pairs see the final outcome and the decision in the log.
  await visit(player.page, `/matches/${second!.id}`);
  await expect(status(player.page)).toContainText("Végeredmény: Mindkét pár vereséget kap (0:4, 0:4)");
  await expect(content(player.page).getByRole("region", { name: "Napló" })).toContainText("A szervező döntött");
  await player.context.close();
});
