// Migration 0064 (#393, D172) on a copy of the live shape: Győr's round 2
// moves to 7 Dec – 3 Jan, rounds 3–4 follow with no holiday break, and
// nothing else changes. Real SQLite with the migrations before 0064 applied.
import { budapestDay } from "@padel-liga/rules";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { applyMigrations, migratedDatabase } = await import("~/test/sqlite");
const { getSeason } = await import("~/lib/seasons.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const all = (q: string) => h.raw.prepare(q).all();
const migrate = () => applyMigrations(h.raw, (f) => f >= "0064" && f < "0065");

// Győr's stored rounds before #393 (Budapest, UTC+1): round 1 extended to
// 6 Dec, rounds 2–4 after the 21 Dec – 3 Jan break.
const OLD: [number, string, string][] = [
  [1, "2026-11-08T23:00:00Z", "2026-12-06T22:59:00Z"],
  [2, "2027-01-03T23:00:00Z", "2027-01-24T22:59:00Z"],
  [3, "2027-01-24T23:00:00Z", "2027-02-14T22:59:00Z"],
  [4, "2027-02-14T23:00:00Z", "2027-03-07T22:59:00Z"],
];

function season(id: number, phases: [number, string, string][]) {
  h.raw.exec(
    `insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start, breaks)
     values (${id}, 1, 'Tél ${id}', ${sec("2026-10-28T23:00:00Z")}, ${sec("2026-11-06T22:59:00Z")}, '2026-11-09', '[{"start":"2026-12-21","end":"2027-01-03"}]')`,
  );
  for (const [n, start, end] of phases)
    h.raw.exec(`insert into season_phases (season_id, number, starts_at, deadline) values (${id}, ${n}, ${sec(start)}, ${sec(end)})`);
}

const days = async (id: number) => (await getSeason(id))!.phases.map((p) => [p.number, budapestDay(p.startsAt), budapestDay(p.deadline)]);

beforeEach(() => {
  h.raw = migratedDatabase("0064");
  h.raw.exec(`insert or ignore into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győr')`);
  h.raw.exec(`insert into users (id, email, name) values ('a', 'a@x.hu', 'A'), ('b', 'b@x.hu', 'B'), ('c', 'c@x.hu', 'C'), ('d', 'd@x.hu', 'D')`);
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (1, 1, 'a', 'b'), (2, 1, 'c', 'd')`);
});

describe("migration 0064: round 2 from 7 Dec, no holiday break (#393)", () => {
  it("moves Győr's rounds 2–4 and leaves round 1, its groups, matches, results and deadlines as they were", async () => {
    season(1, OLD);
    h.raw.exec(`insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, ${sec("2026-11-08T08:00:00Z")})`);
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1), (1, 2, 2)`);
    h.raw.exec(
      `insert into matches (id, group_id, pair_a, pair_b, week, deadline, status, outcome) values
       (1, 1, 1, 2, 1, ${sec(OLD[0]![2])}, 'final', '{"kind":"played","score":{"sets":[[4,1],[4,2]]}}'),
       (2, 1, 2, 1, 2, ${sec(OLD[0]![2])}, 'open', null)`,
    );
    const untouched = () => ({
      seasons: all("select * from seasons"),
      round1: all("select * from season_phases where number = 1"),
      groups: all("select * from groups"),
      groupPairs: all("select * from group_pairs"),
      matches: all("select * from matches"),
    });
    const before = untouched();

    migrate();

    expect(await days(1)).toEqual([
      [1, "2026-11-09", "2026-12-06"],
      [2, "2026-12-07", "2027-01-03"],
      [3, "2027-01-04", "2027-01-24"],
      [4, "2027-01-25", "2027-02-14"],
    ]);
    // Monday 00:00 and Sunday 23:59 Budapest, back to back.
    const s = (await getSeason(1))!;
    expect(s.phases.map((p) => [p.startsAt.toISOString(), p.deadline.toISOString()])).toEqual([
      ["2026-11-08T23:00:00.000Z", "2026-12-06T22:59:00.000Z"],
      ["2026-12-06T23:00:00.000Z", "2027-01-03T22:59:00.000Z"],
      ["2027-01-03T23:00:00.000Z", "2027-01-24T22:59:00.000Z"],
      ["2027-01-24T23:00:00.000Z", "2027-02-14T22:59:00.000Z"],
    ]);
    expect(untouched()).toEqual(before);
  });

  it("is a no-op on a second run", async () => {
    season(1, OLD);
    migrate();
    const once = all("select * from season_phases order by number");
    migrate();
    expect(all("select * from season_phases order by number")).toEqual(once);
  });

  it("changes no other season: other dates, or a round 2–4 whose groups are out", async () => {
    // Round 1 not extended (still to 29 Nov): a different calendar.
    season(1, [[1, "2026-11-08T23:00:00Z", "2026-11-29T22:59:00Z"], ...OLD.slice(1)]);
    // Old dates, but round 2's groups are published: its matches carry its deadline.
    season(2, OLD);
    h.raw.exec(`insert into groups (season_id, phase, number, published_at) values (2, 2, 1, ${sec("2026-12-07T08:00:00Z")})`);
    // Old dates but round 3 already moved by hand.
    season(3, [...OLD.slice(0, 2), [3, "2027-01-31T23:00:00Z", "2027-02-21T22:59:00Z"], OLD[3]!]);
    const before = all("select * from season_phases order by season_id, number");

    migrate();

    expect(all("select * from season_phases order by season_id, number")).toEqual(before);
  });

  it("moves only the season with the old dates when several are stored", async () => {
    season(1, OLD);
    season(2, [[1, "2027-03-14T23:00:00Z", "2027-04-04T21:59:00Z"]]);
    const other = all("select * from season_phases where season_id = 2");

    migrate();

    expect((await days(1)).map(([n, start]) => [n, start])).toEqual([
      [1, "2026-11-09"],
      [2, "2026-12-07"],
      [3, "2027-01-04"],
      [4, "2027-01-25"],
    ]);
    expect(all("select * from season_phases where season_id = 2")).toEqual(other);
  });
});
