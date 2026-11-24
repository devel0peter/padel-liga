// The release step of #396 (D173): migration 0065 stores a set format per
// round. Every round plays sets to 6, except a round 1 whose groups were
// already out (Győr's running round 1): it keeps short sets, so its results
// stay valid. Runs every migration before it on a real SQLite, adds rows,
// then applies 0065.
import { describe, expect, it } from "vitest";

const { applyMigrations, migratedDatabase } = await import("~/test/sqlite");

const MIGRATION = "0065";

function season(raw: any, id: number, phases: number, publishedRounds: number[], draftRounds: number[] = []) {
  raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (?, 1, ?, 1, 2, '2026-11-09')",
    )
    .run(id, `Szezon ${id}`);
  for (let n = 1; n <= phases; n++)
    raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (?, ?, ?, ?)").run(id, n, n * 100, n * 100 + 50);
  for (const n of publishedRounds) raw.prepare("insert into groups (season_id, phase, number, published_at) values (?, ?, 1, 1)").run(id, n);
  for (const n of draftRounds) raw.prepare("insert into groups (season_id, phase, number, published_at) values (?, ?, 1, null)").run(id, n);
}

const formats = (raw: any) =>
  raw.prepare("select season_id, number, set_games from season_phases order by season_id, number").all().map((r: any) => [r.season_id, r.number, r.set_games]);

describe("migration 0065: a set format per round (#396, D173)", () => {
  it("keeps short sets only for a round 1 already published; every other round, and every new one, plays sets to 6", () => {
    const raw = migratedDatabase(MIGRATION);
    raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
    raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
    // Győr's season 1: round 1 published and running, round 2 drafted but not out.
    season(raw, 1, 4, [1], [2]);
    // A season whose round 1 is only a draft, and one still waiting (no groups).
    season(raw, 2, 4, [], [1]);
    season(raw, 3, 4, []);

    applyMigrations(raw, (f) => f >= MIGRATION);

    expect(formats(raw)).toEqual([
      [1, 1, 4],
      [1, 2, 6],
      [1, 3, 6],
      [1, 4, 6],
      ...[2, 3].flatMap((s) => [1, 2, 3, 4].map((n) => [s, n, 6])),
    ]);

    // A round written later without a format plays sets to 6.
    raw.prepare("insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (4, 1, 'Új', 1, 2, '2027-03-01')").run();
    raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (4, 1, 1, 2)").run();
    expect(raw.prepare("select set_games from season_phases where season_id = 4").get().set_games).toBe(6);
  });
});
