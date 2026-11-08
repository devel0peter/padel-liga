// The public league page counts final results (#186). Runs after 18-results:
// Anna's pair has a confirmed win (walkthrough step 27) and a "both lose"
// decision on Viták (step 28), so her group's table is no longer at zero.
// Players only since D134 (step 29).
import { expect, test } from "@playwright/test";

import { PAIRS, as, content, visit } from "./support";

const anna = PAIRS.p1[0];

test("29. the group table counts the confirmed win and the organizer's decision", async ({ browser }) => {
  const { context, page } = await as(browser, PAIRS.p2[0]);
  await visit(page, "/league/minta");
  const group = content(page)
    .getByRole("region", { name: /^\d+\. csoport$/ })
    .filter({ hasText: anna.name });
  await expect(group).toHaveCount(1);

  // Column order: #, Pár, M, Gy, V, Szett, Játék, P (D133). Read the M and P cells of the body rows.
  const column = (nth: number) =>
    group.locator("tbody tr").evaluateAll((rows, i) => rows.map((row) => row.querySelectorAll("td")[i]?.textContent?.trim() ?? ""), nth);

  // Anna's pair: the win (3) and the both-lose match (0), two matches. Her opponent
  // in the win got 1, the other pair 0, each with one match.
  expect((await column(7)).sort()).toEqual(["0", "1", "3"]);
  expect((await column(2)).sort()).toEqual(["1", "1", "2"]);
  const annas = group.locator("tbody tr").filter({ hasText: anna.name });
  await expect(annas.locator("td").nth(2)).toHaveText("2");
  await expect(annas.locator("td").nth(3)).toHaveText("1"); // Gy
  await expect(annas.locator("td").nth(4)).toHaveText("1"); // V: the both-lose match
  await expect(annas.locator("td").nth(7)).toHaveText("3");

  // The played match shows its sets (from the 1st pair's side, as in the app)
  // with the super tie-break in brackets, and the decision its note, each
  // once, under its own week (#202, D133), beside the group's table (D143).
  const panel = group.getByRole("group", { name: /csoport meccsei$/ });
  const played = panel.locator('[aria-label^="Eredmény: "]');
  await expect(played).toHaveCount(1);
  await expect(played).toHaveAttribute("aria-label", /^Eredmény: (4:1, 2:4|1:4, 4:2)$/);
  await expect(played).toContainText(/\((10:8|8:10)\)/);
  await expect(panel).not.toContainText("egyik fél sem játszott");
  await expect(panel.getByText("Mindkét pár vereséget kap (0:4, 0:4)")).toHaveCount(1);
  await context.close();
});
