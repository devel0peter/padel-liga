// The profile level and the Élő-pont (#135): a player placed in a published
// group sees the level read-only, one who hasn't played can still change it,
// and both see the starting Élő-pont with its explanation. Runs last, on the
// state the walkthrough left: group 1 to 3 were published in spec 06, and the
// player of spec 14 has no group.
import { expect, test } from "@playwright/test";

import { PAIRS, as, content, levelLabel, visit } from "./support";

const STARTING = { Kezdő: "1000", Középhaladó: "1200", Haladó: "1400", Versenyző: "1600" } as const;

test("Profil: a player in a published group can't change the level, and sees the Élő-pont", async ({ browser }) => {
  const anna = PAIRS.p1[0];
  const { context, page } = await as(browser, anna);
  // "Játékosprofil", the default tab (D136): the Élő-pont in the summary.
  await visit(page, "/profile");
  const main = content(page);
  await expect(main.getByTestId("rating")).toContainText(STARTING[levelLabel(anna) as keyof typeof STARTING]);

  // The explanation is one tap away and leads to the Élő section of the rules.
  await main.getByRole("button", { name: "Mi az Élő-pont?" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Mi az Élő-pont?");
  await expect(dialog.getByRole("link", { name: "Részletek a szabályzatban" })).toHaveAttribute("href", "/rules#section-8");

  // "Beállításaim": the level is locked, the other fields still save.
  await page.keyboard.press("Escape");
  await main.getByRole("tab", { name: "Beállításaim" }).click();
  await expect(page).toHaveURL(/\?tab=settings/);
  await expect(main.getByTestId("level-locked")).toContainText(levelLabel(anna));
  await expect(main.getByTestId("level-locked")).toContainText("a liga eredményei döntik el");
  // No level field to change, in the form or anywhere else on the page.
  await expect(main.getByRole("combobox", { name: "Szinted" })).toHaveCount(0);
  await main.getByRole("button", { name: "Mentés" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Elmentettük." })).toBeVisible();
  await context.close();
});

test("Profil: a player without a group changes the level and the Élő-pont follows", async ({ browser }) => {
  const { context, page } = await as(browser, "kereso.kata@example.test");
  await visit(page, "/profile");
  const main = content(page);
  await expect(main.getByTestId("rating")).toContainText(STARTING.Középhaladó);

  await visit(page, "/profile?tab=settings");
  await expect(main.getByTestId("level-locked")).toHaveCount(0);
  await main.getByRole("combobox", { name: "Szinted" }).click();
  await page.getByRole("option", { name: /^Versenyző/ }).click();
  await main.getByRole("button", { name: "Mentés" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Elmentettük." })).toBeVisible();

  await visit(page, "/profile");
  await expect(main.getByTestId("rating")).toContainText(STARTING.Versenyző);
  await context.close();
});
