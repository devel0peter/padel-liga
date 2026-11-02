// player-status.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): each account's registration, active pairs and entry in the
// league's current or next season, for the admin tables.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { playerStatuses } = await import("~/lib/player-status.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const NOW = new Date("2026-11-03T12:00:00Z");

function season(id: number, leagueId: number, name: string, start: string, deadline: string) {
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (?, ?, ?, ?, ?, ?)",
    )
    .run(id, leagueId, name, sec(start) - 7 * 86400, sec(start) - 86400, start.slice(0, 10));
  h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (?, 1, ?, ?)").run(id, sec(start), sec(deadline));
}

describe("playerStatuses on real SQLite", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győr'), (2, 'deb', 'deb', 'Debrecen')`);
    h.raw.exec(`insert into users (id, email, name, level, phone, consent_at) values
      ('a', 'Anna@X.hu', 'Anna', 'halado', '+36301234567', 1),
      ('b', 'b@x.hu', 'Béla', null, null, 1),
      ('c', 'c@x.hu', 'Cecil', 'kezdo', null, 1),
      ('d', 'd@x.hu', 'Dóra', 'kezdo', null, 1)`);
    // An account that hasn't finished the first-login page.
    h.raw.exec(`insert into users (id, email, name) values ('n', 'n@x.hu', '')`);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b, status) values
      (1, 1, 'a', 'b', 'active'), (2, 1, 'c', 'a', 'dissolved'), (3, 2, 'c', 'd', 'active'), (4, 1, 'c', 'd', 'active')`);
    // Győr: an ended season, the current one and the next; Debrecen: none.
    season(1, 1, "Ősz", "2026-09-07T22:00:00Z", "2026-09-27T21:59:00Z");
    season(2, 1, "Tél", "2026-11-08T23:00:00Z", "2026-11-29T22:59:00Z");
    season(3, 1, "Tavasz", "2027-03-07T23:00:00Z", "2027-03-28T21:59:00Z");
    h.raw.exec(`insert into season_entries (season_id, pair_id, status) values (1, 1, 'approved'), (3, 1, 'pending'), (2, 2, 'approved')`);
  });

  it("gives each account's registration, level, phone given and active pairs", async () => {
    const { byId } = await playerStatuses(NOW);
    expect(byId.get("a")).toEqual({
      registered: true,
      level: "halado",
      phone: true,
      pairs: [{ leagueId: 1, league: "Győr", city: "gyor", partner: "Béla", entry: { season: "Tavasz", status: "pending" }, season: "Tél" }],
    });
    expect(byId.get("b")?.pairs.map((p) => p.partner)).toEqual(["Anna"]);
    expect(byId.get("b")).toMatchObject({ level: null, phone: false });
    // A dissolved pair doesn't count; Debrecen has no season to enter.
    expect(byId.get("c")?.pairs).toEqual([
      { leagueId: 2, league: "Debrecen", city: "deb", partner: "Dóra", entry: null, season: null },
      { leagueId: 1, league: "Győr", city: "gyor", partner: "Dóra", entry: null, season: "Tél" },
    ]);
    expect(byId.get("n")).toEqual({ registered: false, level: null, phone: false, pairs: [] });
  });

  it("matches accounts by lowercased email, and holds no email or phone number", async () => {
    const { byEmail, byId } = await playerStatuses(NOW);
    expect(byEmail.get("anna@x.hu")).toBe(byId.get("a"));
    expect(byEmail.get("nobody@x.hu")).toBeUndefined();
    const values = JSON.stringify([...byId.values()]);
    expect(values).not.toContain("@");
    expect(values).not.toContain("+36");
  });
});
