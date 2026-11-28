// Smoke E2E for Organizer Epic #307 pages:
// Áttekintés (#438, #439), Döntések (#434), Szezon (#376, #378, #401),
// Kör (#377, #437), Játékosok → Várakozók (#435, #380, #381),
// Levelek (#387, #388), Beállítások (#436, #384, #389, #390), Súgó (#386).
import { expect, test } from "@playwright/test";

import { ORGANIZER, as, content, seasonPath, visit } from "./support";

test("46. organizer Epic #307 hub pages load cleanly with no email leaks", async ({ browser }) => {
  const { context, page } = await as(browser, ORGANIZER.email);

  // Áttekintés
  await visit(page, "/admin/leagues/minta");
  await expect(content(page)).toContainText("Rád vár");
  await expect(content(page)).toContainText("Mi jön");
  await expect(content(page)).toContainText("Jelentkezések");
  await expect(content(page)).not.toContainText("@example.test");

  // Döntések (Nyitott + Lezárt)
  await visit(page, "/admin/leagues/minta/disputes");
  await expect(content(page).getByRole("heading", { name: "Döntések", level: 1 })).toBeVisible();
  await visit(page, "/admin/leagues/minta/disputes?tab=closed");
  await expect(content(page)).not.toContainText("@example.test");

  // Játékosok → Várakozók & Fekete pontok
  await visit(page, "/admin/leagues/minta/players?tab=waiting");
  await expect(content(page).getByRole("heading", { name: "Játékosok", level: 1 })).toBeVisible();
  await expect(content(page)).not.toContainText("@example.test");

  // Szezon → Körök & Statisztika
  const season = await seasonPath(page);
  await visit(page, season);
  await expect(content(page)).toContainText("1. kör");
  await visit(page, `${season}?tab=stats`);
  await expect(content(page)).toContainText("Helyszínek");
  await expect(content(page)).not.toContainText("@example.test");

  // Kör → Statisztika
  await visit(page, `${season}/rounds/1?tab=stats`);
  await expect(content(page)).toContainText(/Helyszínek|A kör statisztikája a csoportok közzététele után jelenik meg/);

  // Levelek (Körlevél + Kimenő)
  await visit(page, "/admin/leagues/minta/mail");
  await expect(content(page).getByRole("heading", { name: "Levelek", level: 1 })).toBeVisible();
  await visit(page, "/admin/leagues/minta/mail?tab=outbox");
  await expect(content(page)).not.toContainText("@example.test");

  // Beállítások (Liga, Klubok, Emlékeztetők, Napló)
  await visit(page, "/admin/leagues/minta/settings");
  await expect(content(page).getByRole("heading", { name: "Beállítások", level: 1 })).toBeVisible();
  await visit(page, "/admin/leagues/minta/settings?tab=log");
  await expect(content(page)).not.toContainText("@example.test");

  // Súgó
  await visit(page, "/admin/leagues/minta/help");
  await expect(content(page).getByRole("heading", { name: "Szervezői útmutató", level: 1 })).toBeVisible();
  await expect(content(page)).toContainText("1. Indulás");

  await context.close();
});
