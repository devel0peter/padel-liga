// The deploy step of #153 (D62): migration 0030 enters every entry still
// pending, with its joining phase worked out as if approved at that moment.
// Runs every migration before it on a real SQLite, adds rows, then applies
// 0030.
import { describe, expect, it } from "vitest";

const { readdirSync, readFileSync } = await import(/* @vite-ignore */ `node:${"fs"}`);
const { DatabaseSync } = await import(/* @vite-ignore */ `node:${"sqlite"}`);

const MIGRATIONS = new URL("../../drizzle/", import.meta.url);
const MIGRATION = "0030_entries_without_approval.sql";

function apply(raw: any, file: string) {
  for (const stmt of readFileSync(new URL(file, MIGRATIONS), "utf8").split("--> statement-breakpoint"))
    if (stmt.trim()) raw.exec(stmt);
}

const DAY = 86400;

// Before 0030 is applied: a league, two pairs per season, and seasons whose
// phases start relative to now (the migration reads the clock).
function before() {
  const raw = new DatabaseSync(":memory:");
  const files = (readdirSync(MIGRATIONS) as string[]).filter((f) => f.endsWith(".sql")).sort();
  expect(files).toContain(MIGRATION);
  for (const f of files.filter((f) => f < MIGRATION)) apply(raw, f);
  raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győr')`);
  for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"])
    raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, 'kezdo', 1)").run(id, `${id}@x.hu`, id);
  raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (1, 1, 'a', 'b'), (2, 1, 'c', 'd'), (3, 1, 'e', 'f'), (4, 1, 'g', 'h')`);
  return raw;
}

function season(raw: any, id: number, phaseStarts: number[]) {
  const now = Math.floor(Date.now() / 1000);
  raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (?, 1, ?, ?, ?, '2026-11-09')",
    )
    .run(id, `S${id}`, now - 30 * DAY, now + DAY);
  phaseStarts.forEach((days, i) =>
    raw
      .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (?, ?, ?, ?)")
      .run(id, i + 1, now + days * DAY, now + (days + 20) * DAY),
  );
}

const rows = (raw: any) =>
  raw.prepare("select season_id, pair_id, status, joins_phase, decided_at is not null as decided from season_entries order by id").all();

describe("migration 0030_entries_without_approval (#153)", () => {
  it("enters pending entries from the next phase, and leaves the others alone", () => {
    const raw = before();
    // Season 1 hasn't started; season 2 is in phase 1; season 3 hasn't
    // started but its phase 1 groups are out.
    season(raw, 1, [5, 26, 47]);
    season(raw, 2, [-3, 18, 39]);
    season(raw, 3, [5, 26, 47]);
    raw.exec(`insert into groups (season_id, phase, number, published_at) values (3, 1, 1, unixepoch())`);
    raw.exec(`insert into season_entries (season_id, pair_id, status, joins_phase) values
      (1, 1, 'pending', null), (1, 2, 'approved', 1), (1, 3, 'rejected', null), (1, 4, 'withdrawn', null),
      (2, 1, 'pending', null), (3, 1, 'pending', null)`);

    apply(raw, MIGRATION);

    expect(rows(raw)).toEqual([
      { season_id: 1, pair_id: 1, status: "approved", joins_phase: 1, decided: 1 },
      { season_id: 1, pair_id: 2, status: "approved", joins_phase: 1, decided: 0 },
      { season_id: 1, pair_id: 3, status: "rejected", joins_phase: null, decided: 0 },
      { season_id: 1, pair_id: 4, status: "withdrawn", joins_phase: null, decided: 0 },
      { season_id: 2, pair_id: 1, status: "approved", joins_phase: 2, decided: 1 },
      { season_id: 3, pair_id: 1, status: "approved", joins_phase: 2, decided: 1 },
    ]);
  });

  it("a pending entry with no phase left moves into the next season (null)", () => {
    const raw = before();
    season(raw, 1, [-50, -29, -8]);
    raw.exec(`insert into season_entries (season_id, pair_id, status) values (1, 1, 'pending')`);
    apply(raw, MIGRATION);
    expect(rows(raw)).toEqual([{ season_id: 1, pair_id: 1, status: "approved", joins_phase: null, decided: 1 }]);
  });

  it("sends nothing", () => {
    const raw = before();
    season(raw, 1, [5, 26, 47]);
    raw.exec(`insert into season_entries (season_id, pair_id, status) values (1, 1, 'pending')`);
    apply(raw, MIGRATION);
    expect(raw.prepare("select count(*) as n from email_messages").get().n).toBe(0);
    expect(raw.prepare("select count(*) as n from notifications").get().n).toBe(0);
  });
});
