// The running-season seed (seed-season.ts) on a real SQLite with every
// migration applied (~/test/sqlite): its SQL runs, and the Élő-pont it writes
// is exactly what the app's own replay (updateElo) leaves, so the Ranglista
// and the profiles show the seeded results' ratings.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { seasonSeedSql } = await import("./seed-season");
const { updateElo } = await import("./elo.server");

const NOW = new Date("2026-11-20T10:00:00Z");

const rows = (sql: string): any[] => h.raw.prepare(sql).all();
const ratings = () => rows("select id, elo from users where elo is not null order by id");
const changes = () => rows("select match_id, user_id, rating_before, rating_after, delta, k, at from elo_changes order by match_id, user_id");

beforeEach(() => {
  h.raw = migratedDatabase();
  h.raw.exec(seasonSeedSql(NOW));
});

describe("the season seed's Élő-pont", () => {
  it("rates the final matches: four changes each and the players' ratings", () => {
    const finals = rows("select count(*) n from matches where status = 'final'")[0].n as number;
    expect(finals).toBeGreaterThan(0);
    expect(changes()).toHaveLength(finals * 4);
    expect(ratings().length).toBeGreaterThan(0);
  });

  it("is what updateElo leaves: a replay changes nothing", async () => {
    const before = { ratings: ratings(), changes: changes() };
    await updateElo(NOW);
    expect({ ratings: ratings(), changes: changes() }).toEqual(before);
  });
});
