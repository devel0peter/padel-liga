// The profile page's level lock and értékszám (#135) on a real SQLite
// (~/test/sqlite) with the real session lookup.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { createSession } = await import("~/lib/auth/session.server");
const P = await import("~/routes/profile");

const args = (request: Request) => ({ request, params: {}, context: {} }) as any;
const get = (cookie: string) => new Request("http://localhost/profile", { headers: { Cookie: cookie } });
const post = (cookie: string, fields: Record<string, string>) =>
  new Request("http://localhost/profile", {
    method: "POST",
    headers: { Cookie: cookie },
    body: new URLSearchParams({ intent: "profile", name: "Nagy Anna", phone: "+36 30 123 4567", sex: "female", ...fields }),
  });
const level = (id: string) => h.raw.prepare("select level from users where id = ?").get(id).level as string;

describe("Profil: level lock and értékszám", () => {
  let placed: string;
  let free: string;

  beforeEach(async () => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győr')`);
    h.raw.exec(`insert into users (id, email, name, level, phone, sex, consent_at) values
      ('placed', 'p@x.hu', 'Nagy Anna', 'halado', '+36301234567', 'female', 1),
      ('mate', 'm@x.hu', 'Kis Béla', 'kezdo', '+36301234568', 'male', 1),
      ('free', 'f@x.hu', 'Nagy Anna', 'kozephalado', '+36301234569', 'female', 1),
      ('nolevel', 'n@x.hu', 'Nagy Anna', null, '+36301234570', 'female', 1)`);
    h.raw.exec(`insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start)
      values (1, 1, 'Tél', 1, 2, '2026-11-09')`);
    h.raw.exec(`insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, 1000), (2, 1, 1, 2, null)`);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status) values (1, 1, 'placed', 'mate', 'active'), (2, 1, 'free', 'nolevel', 'active')`);
    // Only the first pair sits in a published group; the second in a draft.
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1), (2, 2, 1)`);
    placed = (await createSession("placed")).split(";")[0]!;
    free = (await createSession("free")).split(";")[0]!;
  });

  it("a player who hasn't taken part changes the level, and it is saved", async () => {
    expect(await P.action(args(post(free, { level: "versenyzo" })))).toMatchObject({ saved: true });
    expect(level("free")).toBe("versenyzo");
  });

  it("a player placed in a published group sees the level read-only", async () => {
    expect(await P.loader(args(get(placed)))).toMatchObject({ level: "halado", levelLocked: true });
    expect(await P.loader(args(get(free)))).toMatchObject({ levelLocked: false });
  });

  it("refuses a hand-made post that changes a locked level, in Hungarian, and keeps it", async () => {
    const refused: any = await P.action(args(post(placed, { level: "versenyzo" })));
    expect(refused.init.status).toBe(400);
    expect(refused.data.saved).toBe(false);
    expect(refused.data.errors.level).toMatch(/nem módosíthatod/);
    expect(level("placed")).toBe("halado");
  });

  it("saves the other fields of a locked player, without a level in the form or with the same one", async () => {
    expect(await P.action(args(post(placed, { name: "Új Anna" })))).toMatchObject({ saved: true });
    expect(await P.action(args(post(placed, { name: "Újabb Anna", level: "halado" })))).toMatchObject({ saved: true });
    expect(h.raw.prepare("select name, level from users where id = 'placed'").get()).toEqual({ name: "Újabb Anna", level: "halado" });
  });

  it("shows the starting értékszám of the level, nothing without one", async () => {
    expect(await P.loader(args(get(placed)))).toMatchObject({ rating: 1400 });
    expect(await P.loader(args(get(free)))).toMatchObject({ rating: 1200 });
    const nolevel = (await createSession("nolevel")).split(";")[0]!;
    expect(await P.loader(args(get(nolevel)))).toMatchObject({ rating: null });
  });
});
