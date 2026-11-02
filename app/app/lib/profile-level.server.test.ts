// hasTakenPartInSeason on a real SQLite with every migration applied
// (~/test/sqlite): placed in a published group or not.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { hasTakenPartInSeason } = await import("~/lib/profile-level.server");

describe("hasTakenPartInSeason on real SQLite", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győr')`);
    h.raw.exec(`insert into users (id, email, name, level, consent_at) values
      ('a', 'a@x.hu', 'Anna', 'halado', 1), ('b', 'b@x.hu', 'Béla', 'kezdo', 1),
      ('c', 'c@x.hu', 'Cecil', 'kezdo', 1), ('d', 'd@x.hu', 'Dóra', 'kezdo', 1),
      ('e', 'e@x.hu', 'Edit', 'kezdo', 1), ('f', 'f@x.hu', 'Fanni', 'kezdo', 1)`);
    h.raw.exec(`insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start)
      values (1, 1, 'Tél', 1, 2, '2026-11-09')`);
    h.raw.exec(`insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, 1000), (2, 1, 1, 2, null)`);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status) values
      (1, 1, 'a', 'b', 'active'), (2, 1, 'c', 'd', 'active'), (3, 1, 'e', 'a', 'dissolved')`);
    // Pair 1 sits in the published group 1, pair 2 only in the draft group 2.
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1), (2, 2, 1)`);
  });

  it("is true for both players of a pair placed in a published group", async () => {
    expect(await hasTakenPartInSeason("a")).toBe(true);
    expect(await hasTakenPartInSeason("b")).toBe(true);
  });

  it("is false for a pair that is only in a draft group", async () => {
    expect(await hasTakenPartInSeason("c")).toBe(false);
    expect(await hasTakenPartInSeason("d")).toBe(false);
  });

  it("is false for a player with no pair in a group, even with a pair that is not placed", async () => {
    expect(await hasTakenPartInSeason("e")).toBe(false);
    expect(await hasTakenPartInSeason("f")).toBe(false);
    expect(await hasTakenPartInSeason("nobody")).toBe(false);
  });
});
