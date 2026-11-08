// Walkthrough step 15: anyone can create an account (#113). An address that
// logs in on /login, not through a league's register button, finishes the
// first-login page and belongs to no league yet: Kezdőlap asks which league
// they play in (#331). After "Csatlakozom" Párod shows their own pair link,
// and that the organizer pairs those with nobody. Runs last: the new player
// has no pair, so the earlier steps' lists stay as they were.
import { expect, test } from "@playwright/test";

import { content, d1, d1Insert, emailsSince, logIn, logOffset, save, visit } from "./support";

const NEW_PLAYER = { name: "Új Játékos", email: "uj.jatekos@example.test" };

test("15. a new player without an invite or a signup registers", async ({ browser }) => {
  // Nobody invited or signed up this address.
  expect(d1(`select count(*) as n from account_invites where email = '${NEW_PLAYER.email}'`)).toEqual([{ n: 0 }]);
  expect(d1(`select count(*) as n from interest_signups where email1 = '${NEW_PLAYER.email}' or email2 = '${NEW_PLAYER.email}'`)).toEqual([{ n: 0 }]);

  const context = await browser.newContext();
  const page = await context.newPage();

  await logIn(page, NEW_PLAYER.email);
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole("heading", { name: "Üdv!" })).toBeVisible();
  // Nothing prefilled.
  await expect(content(page)).not.toContainText("A párod:");
  await expect(page.getByLabel("Neved")).toHaveValue("");
  await page.getByLabel("Neved").fill(NEW_PLAYER.name);
  await expect(page.getByLabel("Szinted")).toContainText("Válassz…");
  await page.getByLabel("Szinted").click();
  await page.getByRole("option", { name: /^Középhaladó/ }).click();
  await page.getByLabel("Telefonszám").fill("+36 30 765 4321");
  await page.getByLabel(/hozzájárulok/).check();
  // Férfi or Nő is required (#133): without it the page stays.
  await page.getByRole("button", { name: "Kész" }).click();
  await expect(page.getByText("Válaszd ki: férfi vagy nő.")).toBeVisible();
  await page.getByLabel("Férfi", { exact: true }).click();
  await page.getByRole("button", { name: "Kész" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await save(context, NEW_PLAYER.email);

  // In no league yet (D128): one card to choose, no season and no pair link.
  // Only Mintaváros has a season open; Példaváros has none, so it isn't offered.
  const choose = content(page).locator("[data-slot=card]", { hasText: "Melyik ligában játszol?" });
  await expect(choose).toContainText("Mintaváros");
  await expect(choose).toContainText("Padelpárbaj Mintaváros");
  await expect(choose).not.toContainText("Példaváros");
  await expect(content(page)).not.toContainText("Hívd meg a párodat");
  await expect(content(page)).not.toContainText("Teszt szezon");
  await visit(page, "/profile");
  await expect(content(page)).toContainText("Még nem csatlakoztál egyik ligához sem.");
  await visit(page, "/home");
  await content(page).getByRole("button", { name: "Csatlakozom" }).click();
  await expect(content(page)).not.toContainText("Melyik ligában játszol?");
  expect(d1(`select l.slug, m.source from league_members m join leagues l on l.id = m.league_id join users u on u.id = m.user_id
    where u.email = '${NEW_PLAYER.email}'`)).toEqual([{ slug: "minta", source: "chosen" }]);
  expect(d1("select a.action from audit_log a join users u on u.id = a.actor_id where u.email = '" + NEW_PLAYER.email + "' and a.action = 'league.join'")).toEqual([
    { action: "league.join" },
  ]);

  // Now the season and the own pair link (2026-10-31).
  await expect(content(page)).toContainText("Teszt szezon");
  await expect(content(page).getByText("Hívd meg a párodat")).toBeVisible();
  await visit(page, "/profile");
  await expect(content(page).getByText("Hívd meg a párodat")).toBeVisible();
  await expect(content(page)).toContainText("a szervező keres neked párt.");
  // The contact address once, and no "if it changes" line without a pair (#124).
  await expect(content(page).getByRole("link", { name: "hello@padelparbaj.hu" })).toHaveAttribute("href", "mailto:hello@padelparbaj.hu");
  await expect(content(page).getByText("hello@padelparbaj.hu")).toHaveCount(1);
  await expect(content(page)).not.toContainText("Ha változna");
  await context.close();
});

// #123: a new address that bounced before gets no code, yet the code step
// says the same as for any other address and names the other ways in: the
// contact address (and Google login, which the suite has not set up).
test("15. the code step names the contact address, also when no code goes out", async ({ page }) => {
  const bounced = "visszapattant@example.test";
  d1Insert(`insert into email_suppressions (email, reason) values ('${bounced}', 'bounced')`);
  const offset = logOffset();
  await visit(page, `/login?email=${encodeURIComponent(bounced)}`);
  await page.getByRole("button", { name: "Kódot kérek" }).click();
  await expect(page.getByRole("heading", { name: "Nézd meg a leveleidet" })).toBeVisible();
  await expect(content(page)).toContainText(`Küldtünk egy 6 jegyű kódot ide: ${bounced}.`);
  await expect(content(page)).toContainText(
    "Nem jött meg? Nézd meg a spam mappát is, adj meg másik címet, vagy írj nekünk: hello@padelparbaj.hu.",
  );
  await expect(content(page).getByRole("link", { name: "hello@padelparbaj.hu" })).toHaveAttribute("href", "mailto:hello@padelparbaj.hu");
  await expect(content(page).getByRole("link", { name: /Google/ })).toHaveCount(0);
  expect(emailsSince(offset).filter((e) => e.to === bounced)).toEqual([]);
});
