// The public league page counts final results (#186). Runs after 18-results:
// Anna's pair has a confirmed win (walkthrough step 27) and a "both lose"
// decision on Viták (step 28), so her group's table is no longer at zero. A
// visitor sees it without logging in (step 29).
import { expect, test } from "@playwright/test";

import { PAIRS, content, visit } from "./support";

const anna = PAIRS.p1[0];

test("29. the group table counts the confirmed win and the organizer's decision", async ({ browser }) => {
  const page = await browser.newPage();
  await visit(page, "/league/minta");
  const group = content(page)
    .getByRole("region", { name: /^\d+\. csoport$/ })
    .filter({ hasText: anna.name });
  await expect(group).toHaveCount(1);

  // Column order: #, Pár, M, P, Szett, Játék. Read the M and P cells of the body rows.
  const column = (nth: number) =>
    group.locator("tbody tr").evaluateAll((rows, i) => rows.map((row) => row.querySelectorAll("td")[i]?.textContent?.trim() ?? ""), nth);

  // Anna's pair: the win (3) and the both-lose match (0), two matches. Her opponent
  // in the win got 1, the other pair 0, each with one match.
  expect((await column(3)).sort()).toEqual(["0", "1", "3"]);
  expect((await column(2)).sort()).toEqual(["1", "1", "2"]);
  const annas = group.locator("tbody tr").filter({ hasText: anna.name });
  await expect(annas.locator("td").nth(2)).toHaveText("2");
  await expect(annas.locator("td").nth(3)).toHaveText("3");

  // The played matches show their scores (from the 1st pair's side, as in the
  // app) and the decision, each once: under the week shown or under
  // "Lejátszott meccsek" (#202).
  await expect(group).toContainText(/4:1, 2:4, szuper tie-break 10:8|1:4, 4:2, szuper tie-break 8:10/);
  await expect(group).toContainText("Mindkét pár vereséget kap (0:4, 0:4)");
  await expect(group).not.toContainText("egyik fél sem játszott");
  await expect(group.getByText("Mindkét pár vereséget kap (0:4, 0:4)")).toHaveCount(1);
  await expect(group.getByText(/szuper tie-break/)).toHaveCount(1);
  await page.close();
});
