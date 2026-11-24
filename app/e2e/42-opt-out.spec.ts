// Walkthrough step 43 (#395, D176): default in, and "Nem folytatom" on
// Ligáim. Anna's pair plays round 1 of Mintaváros (published in 06-groups):
// her card says they are in round 2 and until when she can opt out; she opts
// out after the confirmation, her partner gets one notice (no email), Párok
// shows "Kilép a kör végén", Napló has her entry; only she can take it back,
// and she does ("Mégis folytatom"), so 99-round-switch drafts the pair as
// before. The suite can't wait for round 1 to start, so the spec moves its
// first day into the past (d1Update) and puts it back at the end.
import { expect, test } from "@playwright/test";

import { ORGANIZER, PAIRS, as, content, d1, d1Update, logOffset, emailsSince, seasonPath, visit } from "./support";

const anna = PAIRS.p1[0];
const partner = PAIRS.p1[1];
const DAY = 86400;

test("43. Nem folytatom on Ligáim: the confirmation, the partner's notice, Párok and Napló, then Mégis folytatom", async ({ browser }) => {
  const org = await as(browser, ORGANIZER.email);
  const season = await seasonPath(org.page);
  const id = Number(/\/seasons\/(\d+)$/.exec(season)![1]);
  const [before] = d1(`select starts_at, deadline from season_phases where season_id = ${id} and number = 1`) as { starts_at: number; deadline: number }[];
  const now = Math.floor(Date.now() / 1000);
  const [pair] = d1(`select p.id from pairs p join users u on u.id = p.player_a where u.email = '${anna.email}' and p.status = 'active'`) as { id: number }[];
  const [{ id: partnerId }] = d1(`select id from users where email = '${partner.email}'`) as { id: string }[];
  const offset = logOffset();

  try {
    // Round 1 runs: it started yesterday, its deadline is still ahead.
    d1Update(`update season_phases set starts_at = ${Math.min(before!.starts_at, now - DAY)} where season_id = ${id} and number = 1`);
    expect(before!.deadline).toBeGreaterThan(now + DAY);

    const { context, page } = await as(browser, anna);
    await visit(page, "/leagues");
    const section = content(page).getByRole("region", { name: "Következő kör" });
    await expect(section).toContainText(/^Következő körBenne vagytok a 2\. körben \(\w+\. \d+-t[óő]l\)\. Ha nem folytatnád, jelezd \w+\. \d+\., 23:59-ig\./);
    await test.info().attach("Ligáim, default in", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

    // The confirmation says what happens; Mégse changes nothing.
    await section.getByRole("button", { name: "Nem folytatom" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Nem folytatod a 2. körben?");
    await expect(dialog).toContainText("A párotok az 1. kör után kilép a szezonból.");
    await expect(dialog).toContainText("Az 1. kör hátralévő meccsei számítanak, ezeket még le kell játszanotok.");
    await expect(dialog).toContainText("A párod új partnerrel folytathatja.");
    await test.info().attach("the confirmation", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await dialog.getByRole("button", { name: "Mégse" }).click();
    expect(d1(`select opt_out_phase from season_entries where season_id = ${id} and pair_id = ${pair!.id}`)).toEqual([{ opt_out_phase: null }]);

    await section.getByRole("button", { name: "Nem folytatom" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Nem folytatom" }).click();
    await expect(section).toContainText("Jelezted, hogy nem folytatod: az 1. kör után kiléptek a szezonból. Meggondolhatod");
    await expect(section.getByRole("button", { name: "Mégis folytatom" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(section).toBeVisible();
    expect(await page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth")).toBeLessThanOrEqual(0);
    await test.info().attach("Ligáim, opted out, 390px", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.setViewportSize({ width: 1280, height: 800 });

    // The partner: one notice, no names, no email; the card without the button.
    expect(d1(`select title, body from notifications where user_id = '${partnerId}' and kind = 'pair_opt_out'`)).toEqual([
      { title: "A párod nem folytatja", body: expect.stringContaining("A párod nem folytatja a 2. körben, így a párotok kimarad belőle.") },
    ]);
    const p = await as(browser, partner);
    await visit(p.page, "/leagues");
    const theirs = content(p.page).getByRole("region", { name: "Következő kör" });
    await expect(theirs).toContainText("A párod jelezte, hogy nem folytatja: az 1. kör után kiléptek a szezonból.");
    await expect(theirs.getByRole("button")).toHaveCount(0);
    await p.context.close();

    // The organizer: Párok and Napló.
    await visit(org.page, "/admin/leagues/minta/pairs");
    // The pair's row (Párok also lists Anna's strikes under "Fekete pontok").
    await expect(content(org.page).getByRole("row").filter({ hasText: anna.name }).filter({ hasText: "Kilép a kör végén" })).toHaveCount(1);
    await test.info().attach("Párok", { body: await org.page.screenshot({ fullPage: true }), contentType: "image/png" });
    expect(d1(`select count(*) as n from audit_log where action = 'season_entry.opt_out' and target = 'pair:${pair!.id}'`)).toEqual([{ n: 1 }]);

    // Mégis folytatom: default in again, the partner told once more.
    await section.getByRole("button", { name: "Mégis folytatom" }).click();
    await expect(section).toContainText("Benne vagytok a 2. körben");
    await expect(section.getByRole("button", { name: "Nem folytatom" })).toBeVisible();
    expect(d1(`select opt_out_phase from season_entries where season_id = ${id} and pair_id = ${pair!.id}`)).toEqual([{ opt_out_phase: null }]);
    expect(d1(`select count(*) as n from audit_log where action = 'season_entry.opt_out_undo' and target = 'pair:${pair!.id}'`)).toEqual([{ n: 1 }]);
    expect(d1(`select count(*) as n from notifications where user_id = '${partnerId}' and kind = 'pair_opt_out'`)).toEqual([{ n: 2 }]);
    // Never an email about it.
    expect(emailsSince(offset).filter((e) => e.to === partner.email || e.to === anna.email)).toEqual([]);
    expect(d1(`select count(*) as n from email_messages where to_email in ('${anna.email}', '${partner.email}') and created_at >= ${now}`)).toEqual([{ n: 0 }]);
    await context.close();
  } finally {
    // Whatever happened above: default in again, and round 1's own first day,
    // so 99-round-switch drafts the pair as before.
    // The date first: it never depends on the pair lookup.
    try {
      d1Update(`update season_phases set starts_at = ${before!.starts_at} where season_id = ${id} and number = 1`);
      if (pair) d1Update(`update season_entries set opt_out_phase = null, opted_out_by = null, opted_out_at = null where season_id = ${id} and pair_id = ${pair.id}`);
    } finally {
      await org.context.close();
    }
  }
});
