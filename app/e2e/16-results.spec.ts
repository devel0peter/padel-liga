// Walkthrough step 20 (#28): after the match of step 18, one pair records the
// result (an invalid one first), the other gets the email and confirms it,
// and it shows as played for both pairs.
import { expect, test, type Page } from "@playwright/test";

import { PAIRS, as, content, d1, logOffset, visit, waitForEmails, type Player } from "./support";

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

const status = (page: Page) => page.getByRole("region", { name: "Állapot" });
const result = (page: Page) => content(page).getByRole("region", { name: "Eredmény" });

async function fillScore(page: Page, rows: [string, string][]) {
  const labels = ["1. szett", "2. szett", "Szuper tie-break (csak 1:1-nél)"];
  for (const [i, [us, them]] of rows.entries()) {
    await result(page).getByLabel(`${labels[i]}, Ti`).fill(us);
    await result(page).getByLabel(`${labels[i]}, Ők`).fill(them);
  }
}

test("20. record → confirm: an invalid score refused, the email, played for both pairs", async ({ browser }) => {
  const [first] = annasMatches();
  const [opponent] = first!.opponents;
  const player = await as(browser, anna);
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
  await partner.context.close();
  await player.context.close();
});
