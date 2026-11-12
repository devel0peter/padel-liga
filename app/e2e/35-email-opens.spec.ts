// Email open tracking (#243, D161) in the Admin's email log (Levelek, D157):
// a sent email that isn't a login code carries a tracking image; loading
// its address marks the email opened, with the first time and the count.
// An unknown token gets the very same image and counts nothing. Runs after
// the walkthrough (it needs sent emails); adds two opens to one email.
import { expect, test } from "@playwright/test";

import { ADMIN, as, content, d1, visit } from "./support";

const NOTE = "A megnyitás csak becslés";

test("the Admin sees when a player opened an email", async ({ browser }) => {
  const [mail] = d1(
    `select m.open_token as token, u.id as user from email_messages m join users u on lower(u.email) = lower(m.to_email)
     where m.status = 'sent' and m.open_token is not null and m.open_count = 0 order by m.id desc limit 1`,
  ) as { token: string; user: string }[];
  expect(mail, "a sent, tracked, unopened email to an account").toBeTruthy();
  // Login codes never carry a token.
  expect(d1("select count(*) as n from email_messages where kind = 'login_code' and open_token is not null")).toEqual([{ n: 0 }]);

  const { context, page } = await as(browser, ADMIN.email);
  await visit(page, `/admin/users/${mail.user}`);
  const log = content(page).getByRole("region", { name: "Levelek" });
  await expect(log).toContainText(NOTE);
  await expect(log.getByText("Nem ismert, hogy megnyitotta").first()).toBeVisible();
  await expect(log.getByText(/^Megnyitva:/)).toHaveCount(0);

  // The mail app loads the image twice; the answer is an uncacheable GIF.
  const image = async (token: string) => {
    const r = await page.request.get(`/email/open/${token}`);
    return { status: r.status(), type: r.headers()["content-type"], cache: r.headers()["cache-control"], body: (await r.body()).toString("base64") };
  };
  const first = await image(mail.token);
  expect(first.status).toBe(200);
  expect(first.type).toBe("image/gif");
  expect(first.cache).toContain("no-store");
  expect(await image(mail.token)).toEqual(first);
  // An unknown token: the same image, nothing counted.
  expect(await image("f".repeat(32))).toEqual(first);
  expect(d1(`select open_count as n from email_messages where open_token = '${mail.token}'`)).toEqual([{ n: 2 }]);
  expect(d1("select count(*) as n from email_messages where open_count > 0")).toEqual([{ n: 1 }]);

  await visit(page, `/admin/users/${mail.user}`);
  await expect(log.getByText(/^Megnyitva: \d{4}\. \d{2}\. \d{2}\. \d{1,2}:\d{2} · 2 megnyitás$/)).toHaveCount(1);
  // A login code row says nothing about opening.
  const codes = log.getByRole("row").filter({ hasText: "Belépőkód" });
  for (const row of await codes.all()) await expect(row).not.toContainText("egnyit");
  await context.close();
});
