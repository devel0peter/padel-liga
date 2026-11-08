// rankings.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): who the Ranglista lists (D137), the ratings and places,
// nothing before the league starts, and no email or phone.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { rankingsPage } = await import("~/lib/rankings.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const BEFORE = new Date("2026-11-07T10:00:00Z");
const DURING = new Date("2026-11-20T10:00:00Z");

function user(id: string, name: string, level = "halado", elo: number | null = null) {
  h.raw
    .prepare("insert into users (id, email, name, phone, level, elo, consent_at) values (?, ?, ?, '+36301234567', ?, ?, 1)")
    .run(id, `${id}@titkos.example`, name, level, elo);
}

function pair(id: number, a: string, b: string, status = "active") {
  h.raw.prepare("insert into pairs (id, league_id, player_a, player_b, status) values (?, 1, ?, ?, ?)").run(id, a, b, status);
}

function group(number: number, pairIds: number[], published = true) {
  h.raw.prepare("insert into groups (season_id, phase, number, published_at) values (1, 1, ?, ?)").run(number, published ? sec("2026-11-06T10:00:00Z") : null);
  const id = h.raw.prepare("select id from groups where number = ?").get(number).id;
  pairIds.forEach((p, i) => h.raw.prepare("insert into group_pairs (group_id, pair_id, seed) values (?, ?, ?)").run(id, p, i + 1));
}

beforeEach(() => {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('rejtett', 'Rejtett', 0)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'rejtett', 'rejtett', 'Rejtett liga')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  h.raw
    .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, ?, ?)")
    .run(sec("2026-11-08T23:00:00Z"), sec("2026-11-29T22:59:00Z"));
  // Anna 1412.4 and Bea (haladó: 1400) are pair 1; Cili and Dóra (középhaladó: 1200) pair 2.
  user("ua", "Anna", "halado", 1412.4);
  user("ub", "Bea");
  user("uc", "Cili", "kozephalado");
  user("ud", "Dóra", "kozephalado");
  pair(1, "ua", "ub");
  pair(2, "uc", "ud");
  group(1, [1, 2]);
});

describe("rankingsPage (D137)", () => {
  it("ranks the players and the pairs by Élő-pont, marks the viewer, links the profiles", async () => {
    const page = (await rankingsPage("gyor", "ub", DURING))!;
    expect(page.started).toBe(true);
    expect(page.players.map((r) => [r.place, r.name, r.elo, r.mine, r.href])).toEqual([
      [1, "Anna", 1412, false, "/players/ua"],
      [2, "Bea", 1400, true, "/players/ub"],
      [3, "Cili", 1200, false, "/players/uc"],
      [3, "Dóra", 1200, false, "/players/ud"],
    ]);
    // A pair's Élő-pont: its players' average.
    expect(page.pairs.map((r) => [r.place, r.name, r.elo, r.mine, r.href])).toEqual([
      [1, "Anna – Bea", 1406, true, "/pairs/1"],
      [2, "Cili – Dóra", 1200, false, "/pairs/2"],
    ]);
  });

  it("colours each row by its pair's division on the Tabella; a withdrawn pair and its players have none (D138)", async () => {
    // Three groups: 1 Bronz, 2 Réz, 3 Rookie.
    user("ue", "Edit");
    user("uf", "Feri");
    user("ug", "Gabi");
    user("uh", "Hanna");
    pair(3, "ue", "uf");
    pair(4, "ug", "uh");
    group(2, [3]);
    group(3, [4]);
    h.raw.exec(`update group_pairs set withdrawn_at = ${sec("2026-11-15T10:00:00Z")} where pair_id = 2`);
    const page = (await rankingsPage("gyor", "ub", DURING))!;
    const division = (rows: { name: string; division: string | null }[]) => Object.fromEntries(rows.map((r) => [r.name, r.division]));
    expect(division(page.pairs)).toEqual({ "Anna – Bea": "bronz", "Cili – Dóra": null, "Edit – Feri": "rez", "Gabi – Hanna": "rookie" });
    expect(division(page.players)).toMatchObject({ Anna: "bronz", Bea: "bronz", Cili: null, Edit: "rez", Gabi: "rookie" });
  });

  it("counts each player's rated matches", async () => {
    h.raw.prepare("insert into matches (id, group_id, pair_a, pair_b, week, deadline, status) values (1, 1, 1, 2, 1, ?, 'final')").run(sec("2026-11-29T22:59:00Z"));
    h.raw
      .prepare("insert into elo_changes (match_id, user_id, rating_before, rating_after, delta, k, at) values (1, 'ua', 1400, 1412.4, 12.4, 40, ?)")
      .run(sec("2026-11-12T10:00:00Z"));
    const page = (await rankingsPage("gyor", "ua", DURING))!;
    expect(page.players.find((r) => r.key === "ua")!.matches).toBe(1);
    expect(page.players.find((r) => r.key === "ub")!.matches).toBe(0);
  });

  it("lists only pairs that have been in a published group, and their players", async () => {
    user("ue", "Emma");
    user("uf", "Flóra");
    pair(3, "ue", "uf");
    group(2, [3], false);
    const page = (await rankingsPage("gyor", "ua", DURING))!;
    expect(page.players.map((r) => r.key)).not.toContain("ue");
    expect(page.pairs.map((r) => r.key)).not.toContain("3");
  });

  it("leaves out a dissolved pair but keeps its players, and a deleted account and its pair", async () => {
    h.raw.exec(`update pairs set status = 'dissolved' where id = 2`);
    h.raw.prepare("update users set name = 'Törölt játékos', deleted_at = ? where id = 'ub'").run(sec("2026-11-12T10:00:00Z"));
    const page = (await rankingsPage("gyor", "ua", DURING))!;
    expect(page.players.map((r) => r.key)).toEqual(["ua", "uc", "ud"]);
    expect(page.pairs).toEqual([]);
  });

  it("shows no rating before the league starts", async () => {
    expect(await rankingsPage("gyor", "ua", BEFORE)).toEqual({
      league: { name: "Padelpárbaj Győr", slug: "gyor" },
      started: false,
      players: [],
      pairs: [],
    });
  });

  it("knows no unknown league or one in a city not listed", async () => {
    expect(await rankingsPage("nincs", "ua", DURING)).toBeNull();
    expect(await rankingsPage("rejtett", "ua", DURING)).toBeNull();
  });

  it("carries no email or phone", async () => {
    const text = JSON.stringify(await rankingsPage("gyor", "ua", DURING));
    expect(text).not.toContain("@");
    expect(text).not.toContain("+36");
  });
});
