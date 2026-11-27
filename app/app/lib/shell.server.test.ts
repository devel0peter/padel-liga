// shell.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the team on the sidebar's user chip (D181): the user's
// first active pair, as playerLeagueSlug picks it, and the division of its
// newest published group.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { shellTeam } = await import("~/lib/shell.server");
const { playerLeagueSlug } = await import("~/lib/leagues.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const PUBLISHED = sec("2026-11-08T08:00:00Z");

function freshDb() {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'gyor', 'gyor2', 'Padelpárbaj Győr 2')`);
  h.raw
    .prepare("insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, 'Tél', ?, ?, '2026-11-09')")
    .run(sec("2026-10-28T23:00:00Z"), sec("2026-11-08T22:59:00Z"));
  for (const [id, name] of [
    ["anna", "Kiss Anna"],
    ["bea", "Nagy Bea"],
    ["cili", "Tóth Cili"],
    ["dora", "Szabó Dóra"],
    ["ede", ""],
  ])
    h.raw.prepare("insert into users (id, email, name, consent_at) values (?, ?, ?, 1)").run(id, `${id}@x.hu`, name);
}

const pair = (id: number, league: number, a: string, b: string, status = "active") =>
  h.raw.prepare("insert into pairs (id, league_id, player_a, player_b, status) values (?, ?, ?, ?, ?)").run(id, league, a, b, status);

// Groups 1..count of a round, published unless listed in `drafts`.
function round(phase: number, count: number, drafts: number[] = []) {
  const ids: Record<number, number> = {};
  for (let n = 1; n <= count; n++) {
    const id = phase * 100 + n;
    h.raw
      .prepare("insert into groups (id, season_id, phase, number, published_at) values (?, 1, ?, ?, ?)")
      .run(id, phase, n, drafts.includes(n) ? null : PUBLISHED);
    ids[n] = id;
  }
  return ids;
}

const place = (groupId: number, pairId: number, withdrawn = false) =>
  h.raw
    .prepare("insert into group_pairs (group_id, pair_id, seed, withdrawn_at) values (?, ?, 1, ?)")
    .run(groupId, pairId, withdrawn ? PUBLISHED + 3600 : null);

beforeEach(freshDb);

describe("the user chip's team (D181)", () => {
  it("is null without an active pair, also with a dissolved one", async () => {
    expect(await shellTeam("anna")).toBeNull();
    pair(1, 1, "anna", "bea", "dissolved");
    expect(await shellTeam("anna")).toBeNull();
  });

  it("is the first active pair by id, the same pair the Tabella opens, without a division before any group", async () => {
    pair(7, 2, "cili", "anna");
    pair(3, 1, "anna", "bea");
    const team = await shellTeam("anna");
    expect(team).toEqual({ pairId: 3, name: "Kiss Anna – Nagy Bea", division: null, first: true });
    expect(await playerLeagueSlug("anna")).toBe("gyor");
    // Bea is the pair's second player (the lighter circle); a nameless partner reads "Névtelen".
    expect(await shellTeam("bea")).toMatchObject({ pairId: 3, first: false });
    pair(9, 1, "dora", "ede");
    expect(await shellTeam("dora")).toMatchObject({ name: "Szabó Dóra – Névtelen" });
  });

  it("takes the division of the newest published group: a draft round doesn't count", async () => {
    pair(1, 1, "anna", "bea");
    const r1 = round(1, 3);
    place(r1[1]!, 1);
    expect((await shellTeam("anna"))?.division).toBe("Bronz");
    const r2 = round(2, 3);
    place(r2[3]!, 1);
    expect((await shellTeam("anna"))?.division).toBe("Rookie");
    // Round 3's draft: not published yet.
    const r3 = round(3, 3, [1, 2, 3]);
    place(r3[2]!, 1);
    expect((await shellTeam("anna"))?.division).toBe("Rookie");
  });

  it("skips a group the pair was withdrawn from", async () => {
    pair(1, 1, "anna", "bea");
    const r1 = round(1, 3);
    place(r1[2]!, 1);
    const r2 = round(2, 3);
    place(r2[1]!, 1, true);
    expect((await shellTeam("anna"))?.division).toBe("Réz");
  });

  it("reads the division from the group's place among its round's published groups", async () => {
    pair(1, 1, "anna", "bea");
    // Six groups, 2 / 2 / 2: group 4 is Réz.
    const six = round(1, 6);
    place(six[4]!, 1);
    expect((await shellTeam("anna"))?.division).toBe("Réz");
    // Round 2: groups 1-3 published, 4 still a draft; group 3 is the last of 3.
    const r2 = round(2, 4, [4]);
    place(r2[3]!, 1);
    expect((await shellTeam("anna"))?.division).toBe("Rookie");
  });
});
