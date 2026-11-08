// Strikes (#294, spec 8): the deadline resolution (#11) gives them in the
// cron, so the suite writes two players' strikes straight into its D1. The
// Szervező sees the counts and the season's list on "Párok" and cancels one
// with a required reason; the player sees their own count on Kezdőlap; the
// league page (players only, D134) never shows any.
import { expect, test } from "@playwright/test";

import { ORGANIZER, PAIRS, as, content, d1, d1Insert, visit } from "./support";

const REASON = "Beteg volt, orvosi igazolással.";

test("Fekete pontok: the organizer sees and cancels one with a reason; the player sees the count, the public page doesn't", async ({ browser }) => {
  const [x, y] = PAIRS.p1;
  const [ids] = d1(`select g.season_id as season, p.id as pair, ux.id as x, uy.id as y
      from group_pairs gp join groups g on g.id = gp.group_id join pairs p on p.id = gp.pair_id
      join users ux on ux.id in (p.player_a, p.player_b) join users uy on uy.id in (p.player_a, p.player_b)
      where ux.email = '${x.email}' and uy.email = '${y.email}' and g.published_at is not null order by g.phase desc limit 1`);
  expect(ids).toBeTruthy();
  const at = Math.floor(Date.now() / 1000) - 3600;
  for (const [user, source, ago] of [
    [ids!.x, "deadline", 7200],
    [ids!.x, "no_show", 60],
    [ids!.y, "deadline", 7200],
  ] as const)
    d1Insert(`insert into strikes (season_id, user_id, pair_id, source, at) values (${ids!.season}, '${user}', ${ids!.pair}, '${source}', ${at - ago})`);

  const { context, page } = await as(browser, ORGANIZER.email);
  await visit(page, `/admin/leagues/minta/pairs?q=${encodeURIComponent(x.name)}`);
  const main = content(page);
  const pairRow = main.getByRole("table", { name: "Párok listája" }).getByRole("row").filter({ hasText: x.name });
  await expect(pairRow).toContainText("2 fekete pont");
  await expect(pairRow).toContainText("1 fekete pont");
  const list = main.getByRole("table", { name: "Fekete pontok" });
  await expect(main.getByRole("heading", { name: /^Fekete pontok · / })).toBeVisible();
  await expect(list.getByRole("row").filter({ hasText: x.name })).toHaveCount(2);
  await expect(list).toContainText("Nem jelent meg");
  await expect(list).toContainText("Határidő: nem próbált egyeztetni");
  // No address or phone on the page.
  await expect(main).not.toContainText("@");

  // Cancel x's no-show strike: a reason is required.
  const noShow = list.getByRole("row").filter({ hasText: x.name }).filter({ hasText: "Nem jelent meg" });
  await noShow.getByRole("button", { name: "Törlés" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Fekete pont törlése: ${x.name}`);
  await expect(dialog.getByRole("button", { name: "Törlés" })).toBeDisabled();
  await dialog.getByLabel("Indok").fill(REASON);
  await dialog.getByRole("button", { name: "Törlés" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(noShow).toContainText(`Törölve (${ORGANIZER.name}): ${REASON}`);
  await expect(pairRow).not.toContainText("2 fekete pont");
  await expect(pairRow.getByText("1 fekete pont")).toHaveCount(2);
  await context.close();

  // The audit entry has the reason.
  expect(d1("select detail from audit_log where action = 'strike.cancel' order by id desc limit 1")[0]!.detail).toBe(REASON);

  // The player: the count on the season card, with what the 3rd means.
  const p = await as(browser, x);
  await visit(p.page, "/home");
  await expect(content(p.page)).toContainText("Fekete pontjaid ebben a szezonban: 1.");
  await expect(content(p.page)).toContainText("A 3.-nál a párod és te a kör végén kikerültök a ligából.");
  // Never public.
  await visit(p.page, "/league/minta");
  await expect(content(p.page)).not.toContainText("fekete pont");
  await p.context.close();
});
