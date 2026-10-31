// The "partner has no email" box (#96): a pair signup without the partner's
// address. The seed has none, so this one comes in through the public form.
import { expect, test } from "@playwright/test";

import { ADMIN, as, content, d1Insert, logOffset, visit, waitForEmails, type Player } from "./support";

const elek: Player = { name: "Teszt Elek", email: "teszt.elek@example.test", level: "halado" };
const PARTNER = "Cím Nélküli";

test("a pair signup without the partner's address asks for it on Párom", async ({ browser }) => {
  // A signup from before the city had a league. A league city takes no
  // signup any more (#83, see 10-landing), so it goes into the database.
  d1Insert(
    `INSERT INTO interest_signups (city, mode, name1, email1, name2, level, consent_at) ` +
      `VALUES ('minta', 'pair', '${elek.name}', '${elek.email}', '${PARTNER}', '${elek.level}', unixepoch())`,
  );

  // The Admin invites the new signup like the seeded ones.
  const admin = await as(browser, ADMIN.email);
  await visit(admin.page, "/admin/signups");
  const offset = logOffset();
  await admin.page.getByRole("button", { name: "Regisztrációs meghívó (1 cím)" }).click();
  await admin.page.getByRole("alertdialog").getByRole("button", { name: "Küldés" }).click();
  await admin.page.getByRole("alertdialog").getByRole("button", { name: "Rendben" }).click();
  await admin.context.close();
  await waitForEmails(offset, 1, (e) => e.to === elek.email);

  // The new player registers and adds the partner's address.
  const player = await as(browser, elek);
  await visit(player.page, "/pair");
  await expect(content(player.page)).toContainText(`A párodnak (${PARTNER}) nincs e-mail-címe nálunk.`);
  const saved = logOffset();
  await player.page.getByLabel("A párod e-mail-címe").fill("cim.nelkuli@example.test");
  await player.page.getByRole("button", { name: "Mentés" }).click();
  await expect(player.page.getByRole("status")).toContainText("Elmentettük. Ha még nincs fiókja, most megkapja a meghívót.");
  await player.context.close();

  // The partner's invite goes out at once (#112), like every invite.
  const [invite] = await waitForEmails(saved, 1, (e) => e.to === "cim.nelkuli@example.test");
  expect(invite.text).toContain("https://padelparbaj.hu/register?email=cim.nelkuli%40example.test");
});
