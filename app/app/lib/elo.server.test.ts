// Player Elo after every played match (#13) on a real SQLite with every
// migration applied (~/test/sqlite): a confirmed result, the cron's
// auto-accept and an organizer's ruling change the four players' ratings;
// a walkover doesn't; an override replays the match in its place; a pair
// withdrawn later keeps its changes; every reader of a pair's Elo sees the
// current rating. Email is stubbed; nothing here sends any.
import { expectedScore, replayElo } from "@padel-liga/rules";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, beforeBatch: null as null | (() => void) }));

// No VAPID keys: notifications are stored, not pushed.
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => {
  const { db } = (await import("~/test/sqlite")).mockClient(h);
  const batch = db.batch.bind(db);
  // A hook to change the database between the replay's reads and its write.
  (db as any).batch = async (queries: any[]) => {
    const hook = h.beforeBatch;
    h.beforeBatch = null;
    hook?.();
    return batch(queries as any);
  };
  return { db };
});
vi.mock("~/lib/cities.server", () => ({ listedCities: async () => [{ slug: "gyor" }] }));
vi.mock("~/lib/email/outbox.server", () => ({
  queueSeasonEntered: async () => {},
  queueGroupsPublished: async () => {},
  queueSeasonEntryDecision: async () => {},
  queueMatchEmails: async () => {},
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { updateElo } = await import("~/lib/elo.server");
const R = await import("~/lib/results.server");
const D = await import("~/lib/decisions.server");
const E = await import("~/lib/season-entries.server");
const M = await import("~/lib/matches.server");
const L = await import("~/lib/ladder.server");
const P = await import("~/lib/pairs.server");
const G = await import("~/lib/groups.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (iso: string) => new Date(iso);

const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const DEADLINE_1 = sec(PHASES[0]!) + 21 * 86400 - 60;
const T1 = at("2026-11-10T18:00:00Z");
const T2 = at("2026-11-12T18:00:00Z");
const T3 = at("2026-11-14T18:00:00Z");

const WIN_A = { sets: [[4, 1], [4, 2]] } as const;
const WIN_B = { sets: [[1, 4], [2, 4]] } as const;

// Pairs 1-4 in group 1 of phase 1; every player halado (1400), except pair
// 4: kezdő (1000). Matches: 1 (1–2), 2 (3–4), 3 (1–3), 4 (2–4), 5 (1–4),
// 6 (2–3), all open.
function freshDb() {
  h.raw = migratedDatabase();
  h.beforeBatch = null;
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  for (const id of ["a", "b", "c", "d", "e", "f", "g", "h", "o"])
    h.raw
      .prepare("insert into users (id, email, name, phone, level, consent_at) values (?, ?, ?, '+36301234567', ?, 1)")
      .run(id, `${id}@x.hu`, `Játékos ${id.toUpperCase()}`, id === "g" || id === "h" ? "kezdo" : "halado");
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (1, 1, 'a', 'b'), (2, 1, 'c', 'd'), (3, 1, 'e', 'f'), (4, 1, 'g', 'h')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  PHASES.forEach((start, i) =>
    h.raw
      .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, ?, ?, ?)")
      .run(i + 1, sec(start), sec(start) + 21 * 86400 - 60),
  );
  for (const p of [1, 2, 3, 4])
    h.raw
      .prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, 'approved', 1, ?)")
      .run(p, sec("2026-11-03T10:00:00Z"));
  h.raw.prepare("insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, ?)").run(sec("2026-11-06T10:00:00Z"));
  [1, 2, 3, 4].forEach((p, i) => h.raw.prepare("insert into group_pairs (group_id, pair_id, seed) values (1, ?, ?)").run(p, i + 1));
  [
    [1, 1, 2, 1],
    [2, 3, 4, 1],
    [3, 1, 3, 2],
    [4, 2, 4, 2],
    [5, 1, 4, 3],
    [6, 2, 3, 3],
  ].forEach(([id, a, b, week]) =>
    h.raw.prepare("insert into matches (id, group_id, pair_a, pair_b, week, deadline) values (?, 1, ?, ?, ?, ?)").run(id, a, b, week, DEADLINE_1),
  );
}

beforeEach(() => freshDb());

const row = (sql: string, ...args: unknown[]) => h.raw.prepare(sql).get(...args);
const rows = (sql: string, ...args: unknown[]) => h.raw.prepare(sql).all(...args);
const elo = (id: string) => (row("select elo from users where id = ?", id) as { elo: number | null }).elo;
const changes = () => rows("select match_id, user_id, rating_before, rating_after, delta, k, at from elo_changes order by at, match_id, user_id");

// A result recorded by pair_a's first player and confirmed by pair_b's.
const PLAYERS: Record<number, [string, string]> = { 1: ["a", "c"], 2: ["e", "g"], 3: ["a", "e"], 4: ["c", "g"], 5: ["a", "g"], 6: ["c", "e"] };
async function confirmed(matchId: number, score: object, when: Date) {
  const [recorder, confirmer] = PLAYERS[matchId]!;
  expect(await R.resultStep(recorder, matchId, { kind: "record", score } as any, when)).toMatchObject({ ok: true });
  expect(await R.resultStep(confirmer, matchId, { kind: "confirm" }, when)).toMatchObject({ ok: true });
}

describe("updateElo after a confirmed result (#13)", () => {
  it("gives two equal new pairs +20 and -20 and stores a history row per player", async () => {
    await confirmed(1, WIN_A, T1);
    expect([elo("a"), elo("b"), elo("c"), elo("d")]).toEqual([1420, 1420, 1380, 1380]);
    expect(elo("e")).toBeNull();
    expect(changes()).toEqual(
      ["a", "b", "c", "d"].map((u) => ({
        match_id: 1,
        user_id: u,
        rating_before: 1400,
        rating_after: u < "c" ? 1420 : 1380,
        delta: u < "c" ? 20 : -20,
        k: 40,
        at: sec("2026-11-10T18:00:00Z"),
      })),
    );
  });

  it("doesn't change anything for a result only recorded", async () => {
    expect(await R.resultStep("a", 1, { kind: "record", score: WIN_A } as any, T1)).toMatchObject({ ok: true });
    expect(changes()).toEqual([]);
    expect(elo("a")).toBeNull();
  });

  it("chains a later match on the earlier one's ratings", async () => {
    await confirmed(1, WIN_A, T1);
    await confirmed(3, WIN_B, T2); // pair 3 (1400) beats pair 1 (1420)
    const delta = 40 * (1 - expectedScore(1400, 1420));
    expect(elo("e")).toBeCloseTo(1400 + delta, 10);
    expect(elo("a")).toBeCloseTo(1420 - delta, 10);
    expect(row("select count(*) n from elo_changes where user_id = 'a'")).toEqual({ n: 2 });
  });

  it("writes nothing on a second replay with nothing new", async () => {
    await confirmed(1, WIN_A, T1);
    const before = changes();
    let wrote = false;
    h.beforeBatch = () => (wrote = true);
    await updateElo(T2);
    expect(wrote).toBe(false);
    expect(changes()).toEqual(before);
  });
});

describe("updateElo after the cron's auto-accept (#13)", () => {
  it("rates a result accepted after 48 hours", async () => {
    expect(await R.resultStep("a", 1, { kind: "record", score: WIN_A } as any, T1)).toMatchObject({ ok: true });
    expect(await R.autoAcceptResults(at("2026-11-12T19:00:00Z"))).toBe(1);
    expect(elo("a")).toBe(1420);
    expect(row("select at from elo_changes where user_id = 'a'")).toEqual({ at: sec("2026-11-12T19:00:00Z") });
  });
});

describe("updateElo after an organizer's ruling (#13)", () => {
  it("rates a played score the organizer sets", async () => {
    expect(await D.decideMatch("o", 1, 2, { kind: "played", score: WIN_B } as any, "Így volt.", T1)).toMatchObject({ ok: true });
    // Pair 4 (1000) beats pair 3 (1400).
    const delta = 40 * (1 - expectedScore(1000, 1400));
    expect(elo("g")).toBeCloseTo(1000 + delta, 10);
    expect(elo("e")).toBeCloseTo(1400 - delta, 10);
  });

  it("doesn't rate a walkover, a both-inactive or an unplayed match", async () => {
    expect(await D.decideMatch("o", 1, 1, { kind: "walkover", winner: "a" }, "Nem jöttek el.", T1)).toMatchObject({ ok: true });
    expect(await D.decideMatch("o", 1, 2, { kind: "both-inactive" }, "Egyik sem jelentkezett.", T1)).toMatchObject({ ok: true });
    expect(await D.decideMatch("o", 1, 3, { kind: "unplayed" }, "Nem egyeztek meg.", T1)).toMatchObject({ ok: true });
    expect(changes()).toEqual([]);
    expect(rows("select elo from users where elo is not null")).toEqual([]);
  });

  it("takes back a match overridden to a walkover", async () => {
    await confirmed(1, WIN_A, T1);
    expect(await D.decideMatch("o", 1, 1, { kind: "walkover", winner: "b" }, "Nem ők játszottak.", T2)).toMatchObject({ ok: true });
    expect(changes()).toEqual([]);
    expect(["a", "b", "c", "d"].map(elo)).toEqual([null, null, null, null]);
  });

  it("replays an overridden match in its place, as if the new outcome had been there from the start", async () => {
    await confirmed(1, WIN_A, T1);
    await confirmed(3, WIN_A, T2);
    await confirmed(5, WIN_A, T3);
    // Match 1 was the other way round: the organizer flips it later.
    expect(await D.decideMatch("o", 1, 1, { kind: "played", score: WIN_B } as any, "Fordítva írták be.", at("2026-11-16T10:00:00Z"))).toMatchObject({
      ok: true,
    });
    const start = (id: string) => (id === "g" || id === "h" ? 1000 : 1400);
    const expected = replayElo(start, [
      { id: 1, a: ["a", "b"], b: ["c", "d"], winner: "b" },
      { id: 3, a: ["a", "b"], b: ["e", "f"], winner: "a" },
      { id: 5, a: ["a", "b"], b: ["g", "h"], winner: "a" },
    ]);
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) expect(elo(id)).toBe(expected.players.get(id)!.rating);
    // Match 1 keeps its place: when it first became final.
    expect(rows("select distinct match_id, at from elo_changes order by at")).toEqual([
      { match_id: 1, at: sec("2026-11-10T18:00:00Z") },
      { match_id: 3, at: sec("2026-11-12T18:00:00Z") },
      { match_id: 5, at: sec("2026-11-14T18:00:00Z") },
    ]);
    expect(changes()).toHaveLength(12);
  });
});

describe("updateElo and a pair withdrawn mid-phase (#13, #34)", () => {
  it("keeps the changes of the withdrawn pair's final matches and doesn't rate the others", async () => {
    await confirmed(2, WIN_A, T1); // pair 3 beats pair 4
    expect(await R.resultStep("c", 4, { kind: "record", score: WIN_A } as any, T2)).toMatchObject({ ok: true });
    expect(await E.withdrawPairMidPhase({ id: "o" }, 1, 4, 1, "Sérülés, a kör végéig nem tudnak játszani.", T2)).toEqual({ ok: true });
    const g = elo("g");
    expect(g).toBeLessThan(1000);
    await confirmed(1, WIN_A, T3);
    expect(elo("g")).toBe(g);
    expect(rows("select distinct match_id from elo_changes order by match_id")).toEqual([{ match_id: 1 }, { match_id: 2 }]);
    // The pending result of the withdrawn pair is never accepted, so never rated.
    expect(await R.autoAcceptResults(at("2026-11-20T12:00:00Z"))).toBe(0);
    expect(row("select count(*) n from elo_changes where match_id = 4")).toEqual({ n: 0 });
  });
});

describe("updateElo when a result becomes final during the replay (#13)", () => {
  it("starts over and includes it", async () => {
    await confirmed(1, WIN_A, T1);
    expect(await R.resultStep("a", 3, { kind: "record", score: WIN_A } as any, T2)).toMatchObject({ ok: true });
    // Match 3 is confirmed between this replay's reads and its write.
    expect(await R.resultStep("e", 3, { kind: "confirm" }, T2)).toMatchObject({ ok: true });
    h.raw.exec("delete from elo_changes; update users set elo = null");
    h.beforeBatch = () => {
      h.raw.exec("update matches set status = 'final', outcome = '{\"kind\":\"played\",\"score\":{\"sets\":[[4,1],[4,2]]}}', revision = revision + 1 where id = 5");
      h.raw.prepare("insert into match_decisions (match_id, kind, outcome, at) values (5, 'organizer', ?, ?)").run(JSON.stringify({ kind: "played", score: WIN_A }), sec("2026-11-14T18:00:00Z"));
    };
    await updateElo(T3);
    expect(rows("select distinct match_id from elo_changes order by match_id")).toEqual([{ match_id: 1 }, { match_id: 3 }, { match_id: 5 }]);
  });
});

describe("Elo readers use the current rating (#13)", () => {
  it("seeding, the group table, the public ladder and the organizer's lists", async () => {
    await confirmed(2, WIN_A, T1); // pair 3 (e, f) beats pair 4 (g, h)
    const pair3 = (elo("e")! + elo("f")!) / 2;
    const pair4 = (elo("g")! + elo("h")!) / 2;
    expect(pair3).toBeGreaterThan(1400);
    expect(pair4).toBeLessThan(1000);

    // Seeding (the groups draft and the stored groups).
    expect((await G.eligiblePairs(1)).find((p) => p.pairId === 3)?.averageElo).toBe(pair3);
    expect((await G.phaseGroups(1))[0]!.pairs.find((p) => p.pairId === 4)?.averageElo).toBe(pair4);
    // The group table's last tiebreak (standings step 5).
    expect((await M.groupMembers([1])).get(1)!.find((p) => p.pairId === 3)?.elo).toBe(pair3);
    // The public ladder's last tiebreak: pairs 1 and 2 haven't played, so
    // seed order (1 first) until pair 2's rating is higher.
    const order = async () => {
      const page = JSON.stringify(await L.ladderPage("gyor", T3));
      return page.indexOf("Játékos C") < page.indexOf("Játékos A") ? [2, 1] : [1, 2];
    };
    expect(await order()).toEqual([1, 2]);
    h.raw.exec("update users set elo = 1500 where id in ('c', 'd')");
    expect(await order()).toEqual([2, 1]);
    expect((await M.groupMembers([1])).get(1)!.find((p) => p.pairId === 2)?.elo).toBe(1500);
    h.raw.exec("update users set elo = null where id in ('c', 'd')");
    // The organizer's Párok and Nevezések lists.
    expect((await P.leaguePairs(1, T3)).find((p) => p.id === 4)?.elo).toBe(pair4);
    expect((await E.listSeasonEntries(1)).map((r) => r.averageElo).sort()).toEqual([1400, 1400, pair3, pair4].sort());
  });
});
