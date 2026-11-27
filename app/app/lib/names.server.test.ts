// The surname choice (#419) on a real SQLite with every migration applied
// (~/test/sqlite): the view for the card and the setting, saving a pick, and
// a name change clearing it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/background.server", () => import("~/test/background"));
// The Admin's edit module reaches the mail code; nothing here sends any.
vi.mock("~/lib/email/send.server", () => ({
  MAX_BATCH: 100,
  relayConfigured: () => false,
  sendEmails: async () => {
    throw new Error("no mail in this test");
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { pickSurname, surnameView } = await import("~/lib/names.server");
const { updateProfile, saveProfile } = await import("~/lib/auth/accounts.server");
const { updatePlayerByAdmin } = await import("~/lib/player-admin.server");

const user = (id: string) => h.raw.prepare("select id, name, surname from users where id = ?").get(id) as { id: string; name: string; surname: string | null };

describe("the surname choice on real SQLite (#419)", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győr')`);
    h.raw.exec(`insert into users (id, email, name, level, consent_at) values
      ('f', 'f@x.hu', 'Farkas Lilla', 'halado', 1), ('p', 'p@x.hu', 'Papp Ádám', 'kezdo', 1),
      ('k', 'k@x.hu', 'Kovács Anna', 'kezdo', 1), ('n', 'n@x.hu', 'Nagy Bence', 'kezdo', 1),
      ('o', 'o@x.hu', 'Ottó', 'kezdo', 1)`);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status) values (1, 1, 'f', 'p', 'active'), (2, 1, 'n', 'k', 'dissolved')`);
  });

  it("an unsure player is asked, with the team label and the other part", async () => {
    expect(await surnameView(user("f"))).toEqual({
      parts: ["Farkas", "Lilla"],
      surname: "Farkas",
      label: { own: "Farkas", partner: "Papp" },
      asks: true,
    });
  });

  it("a sure player is not asked; without an active pair there is no partner", async () => {
    expect(await surnameView(user("k"))).toEqual({ parts: ["Kovács", "Anna"], surname: "Kovács", label: { own: "Kovács", partner: null }, asks: false });
  });

  it("saves a part of the own name, and the card is gone", async () => {
    expect(await pickSurname(user("f"), "lilla")).toBe(true);
    expect(user("f").surname).toBe("Lilla");
    expect(await surnameView(user("f"))).toMatchObject({ surname: "Lilla", label: { own: "Lilla", partner: "Papp" }, asks: false });
    // "Igen" keeps the first word, and that ends the question too.
    expect(await pickSurname(user("f"), "Farkas")).toBe(true);
    expect(await surnameView(user("f"))).toMatchObject({ surname: "Farkas", asks: false });
  });

  it("refuses anything that is not a part of the own name: no free text", async () => {
    for (const bad of ["Papp", "Farkas Lilla", "", null, 3]) expect(await pickSurname(user("f"), bad)).toBe(false);
    expect(user("f").surname).toBeNull();
  });

  it("refuses a pick from a name that changed meanwhile", async () => {
    const stale = user("f");
    h.raw.exec(`update users set name = 'Farkas Ilona' where id = 'f'`);
    expect(await pickSurname(stale, "Lilla")).toBe(false);
    expect(user("f").surname).toBeNull();
  });

  it("a name change clears the pick; saving the same name keeps it", async () => {
    await pickSurname(user("f"), "Lilla");
    const profile = { name: "Farkas Lilla", level: "halado" as const, phone: "+36301234567", sex: "female" as const };
    await updateProfile("f", profile);
    expect(user("f").surname).toBe("Lilla");
    await updateProfile("f", { ...profile, name: "Farkas Lili" });
    expect(user("f").surname).toBeNull();
    await pickSurname(user("f"), "Lili");
    await saveProfile("f", { ...profile, name: "Farkas Lili Anna", consent: true });
    expect(user("f").surname).toBeNull();
  });

  it("the Admin's name edit clears it too; another field keeps it", async () => {
    h.raw.exec(`insert into users (id, email, name, platform_role, consent_at) values ('adm', 'adm@x.hu', 'Admin', 'superadmin', 1)`);
    await pickSurname(user("f"), "Lilla");
    const fields = { name: "Farkas Lilla", phone: "+36301234567", level: "halado", sex: "female" };
    expect(await updatePlayerByAdmin("adm", "f", fields)).toMatchObject({ ok: true });
    expect(user("f").surname).toBe("Lilla");
    expect(await updatePlayerByAdmin("adm", "f", { ...fields, name: "Farkas Lili" })).toMatchObject({ ok: true, changed: 1 });
    expect(user("f").surname).toBeNull();
  });

  it("a one-word name has nothing to pick and is not asked", async () => {
    expect(await surnameView(user("o"))).toMatchObject({ parts: ["Ottó"], asks: false });
  });
});
