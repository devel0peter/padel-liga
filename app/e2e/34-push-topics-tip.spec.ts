// Push topics (#349, D159) on Profil → Értesítések: five switches, all on;
// one switched off is saved for the account and stays after a reload; with
// push off they are disabled and keep their values. Runs after the
// walkthrough; leaves the state as it found it (every switch back on).
import { expect, test } from "@playwright/test";

import { PAIRS, as, content, d1, visit } from "./support";

// Substitutes are hidden in the first season (D145): the last topic is
// "Mulasztások".
const TOPICS = ["Időpont-egyeztetés", "Emlékeztetők", "Eredmények", "Csoport és szezon", "Mulasztások"];

test("Profil: push topics, all on; one off is saved; with push off they are disabled and keep their values", async ({ browser }) => {
  const anna = PAIRS.p1[0];
  const [{ id }] = d1(`select id from users where email = '${anna.email}'`);
  const optOuts = () => d1(`select kind from notification_opt_outs where user_id = '${id}' order by kind`).map((r) => r.kind);
  const { context, page } = await as(browser, anna);
  await visit(page, "/profile?tab=settings");
  const settings = content(page).getByRole("region", { name: "Értesítések" });
  const topics = settings.getByRole("group", { name: "Push témák" });
  const topic = (name: string) => topics.getByRole("switch", { name });
  const pushSwitch = settings.getByRole("switch", { name: "Push értesítés" });

  for (const name of TOPICS) await expect(topic(name)).toBeChecked();
  await expect(topics.getByRole("switch")).toHaveCount(TOPICS.length);
  await expect(topics).toContainText("Miről kérsz push értesítést?");

  // Emlékeztetők off: saved for the account, still off after a reload.
  await topic("Emlékeztetők").click();
  await expect(topic("Emlékeztetők")).not.toBeChecked();
  await expect.poll(optOuts).toEqual(["topic:reminders"]);
  await visit(page, "/profile?tab=settings");
  await expect(topic("Emlékeztetők")).not.toBeChecked();
  await expect(topic("Eredmények")).toBeChecked();

  // Push off: the topics are disabled, with the line why, and keep their values.
  await pushSwitch.click();
  await expect(pushSwitch).not.toBeChecked();
  for (const name of TOPICS) await expect(topic(name)).toBeDisabled();
  await expect(topics).toContainText("akkor számítanak, ha bekapcsolod");
  await expect.poll(optOuts).toEqual(["channel:push", "topic:reminders"]);
  await visit(page, "/profile?tab=settings");
  await expect(topic("Emlékeztetők")).toBeDisabled();
  await expect(topic("Emlékeztetők")).not.toBeChecked();

  // Push on again: the topics as they were; then everything back on.
  await pushSwitch.click();
  await expect(pushSwitch).toBeChecked();
  await expect(topic("Emlékeztetők")).toBeEnabled();
  await expect(topic("Emlékeztetők")).not.toBeChecked();
  await topic("Emlékeztetők").click();
  await expect(topic("Emlékeztetők")).toBeChecked();
  await expect.poll(optOuts).toEqual([]);
  await context.close();
});

// The Kezdőlap tip (#262, D160): the suite's server has no push keys (no
// real push from a test), so no device could subscribe and the push tip is
// not offered. The tip's conditions, "Most nem" and the shared subscribe are
// in tips.test.ts, app.home-tips.test.ts and push/device.test.ts.
test("Kezdőlap: no push tip while the site can't push", async ({ browser }) => {
  const { context, page } = await as(browser, PAIRS.p1[0]);
  await visit(page, "/home");
  await expect(page).toHaveTitle(/^Kezdőlap/);
  await expect(content(page).getByRole("region", { name: "Tipp" })).toHaveCount(0);
  await expect(content(page).getByRole("button", { name: "Bekapcsolom" })).toHaveCount(0);
  await context.close();
});
