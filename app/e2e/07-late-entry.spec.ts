// Walkthrough step 11, last check: a pair entering after the groups are
// published joins round 2, at once (#153).
import { expect, test } from "@playwright/test";

import { PAIRS, as, content, pairUp, registerAll, visit } from "./support";

test("11. a pair entering after Közzététel starts in round 2", async ({ browser }) => {
  const [reka, levente] = PAIRS.late;
  await registerAll(browser, PAIRS.late);
  await pairUp(browser, PAIRS.late);
  const player = await as(browser, reka);
  await visit(player.page, "/profile");
  await expect(content(player.page)).toContainText(levente.name);
  await player.page.getByRole("button", { name: "Nevezünk" }).click();
  await expect(player.page.getByRole("status")).toContainText("Beneveztetek: a 2. körtől játszotok");
  await player.page.reload();
  await expect(content(player.page)).toContainText("Beneveztetek: a 2. körtől játszotok.");
  await player.context.close();
});
