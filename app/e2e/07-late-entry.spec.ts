// Walkthrough step 11, last check: a pair approved after the groups are
// published joins round 2.
import { expect, test } from "@playwright/test";

import { ORGANIZER, PAIRS, as, content, registerAll, seasonPath, visit } from "./support";

test("11. a pair approved after Közzététel starts in round 2", async ({ browser }) => {
  const [reka, levente] = PAIRS.late;
  await registerAll(browser, PAIRS.late);
  const player = await as(browser, reka);
  await visit(player.page, "/pair");
  await expect(content(player.page)).toContainText(levente.name);
  await player.page.getByRole("button", { name: "Nevezünk" }).click();
  await expect(player.page.getByRole("status")).toContainText("Neveztetek.");

  const organizer = await as(browser, ORGANIZER.email);
  await visit(organizer.page, `${await seasonPath(organizer.page)}/entries`);
  const row = organizer.page.getByRole("row").filter({ hasText: reka.name });
  await row.getByRole("button", { name: "Jóváhagyás" }).click();
  await organizer.page.getByRole("alertdialog").getByRole("button", { name: "Jóváhagyás" }).click();
  await expect(row).toHaveCount(0);
  await organizer.context.close();

  await player.page.reload();
  await expect(content(player.page)).toContainText("Jóváhagyva: a 2. körtől játszotok.");
  await player.context.close();
});
