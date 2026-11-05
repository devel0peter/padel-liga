// ladder.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): which phase the public league page shows, the bands, and
// that nothing but names leaves the module (#30).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { ladderPage } = await import("~/lib/ladder.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

// Phases from Monday 9 Nov 2026 (Budapest, UTC+1).
const STARTS = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];

function freshDb() {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  STARTS.forEach((start, i) =>
    h.raw
      .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, ?, ?, ?)")
      .run(i + 1, sec(start), sec(start) + 21 * 86400 - 60),
  );
}

/** `count` published groups of 3 pairs for `phase`, pair ids unique across phases. */
function publish(phase: number, count: number, published = true) {
  for (let g = 1; g <= count; g++) {
    h.raw
      .prepare("insert into groups (season_id, phase, number, published_at) values (1, ?, ?, ?)")
      .run(phase, g, published ? sec("2026-11-06T10:00:00Z") : null);
    const groupId = h.raw.prepare("select id from groups where season_id = 1 and phase = ? and number = ?").get(phase, g).id;
    for (let s = 1; s <= 3; s++) {
      const n = phase * 1000 + g * 10 + s;
      for (const side of ["a", "b"]) {
        h.raw
          .prepare("insert into users (id, email, name, phone, level, consent_at) values (?, ?, ?, '+36301234567', 'halado', 1)")
          .run(`u${n}${side}`, `u${n}${side}@titkos.example`, `Játékos ${n}${side.toUpperCase()}`);
      }
      h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)").run(n, `u${n}a`, `u${n}b`);
      h.raw.prepare("insert into group_pairs (group_id, pair_id, seed) values (?, ?, ?)").run(groupId, n, s);
    }
    // Round robin of 3: week 1: 1-2, week 2: 1-3, week 3: 2-3.
    const base = phase * 1000 + g * 10;
    [
      [1, base + 1, base + 2],
      [2, base + 1, base + 3],
      [3, base + 2, base + 3],
    ].forEach(([week, a, b]) =>
      h.raw
        .prepare("insert into matches (group_id, pair_a, pair_b, week, deadline) values (?, ?, ?, ?, ?)")
        .run(groupId, a, b, week, sec(STARTS[phase - 1]!) + 21 * 86400 - 60),
    );
  }
}

const at = (iso: string) => new Date(iso);

beforeEach(freshDb);

describe("ladderPage", () => {
  it("is null for a league that doesn't exist", async () => {
    expect(await ladderPage("nincs", at("2026-11-10T10:00:00Z"))).toBeNull();
  });

  it("before any group is published it says when round 1 starts", async () => {
    publish(1, 3, false); // a draft is not public
    const page = await ladderPage("gyor", at("2026-11-03T10:00:00Z"));
    expect(page).toEqual({
      league: { name: "Padelpárbaj Győr", city: "gyor" },
      season: "2026/27 tél",
      kind: "waiting",
      next: { round: 1, startsOn: "november 9-én" },
    });
  });

  it("with 5 published groups the bands are Bronz 1, Réz 2, Rookie 2", async () => {
    publish(1, 5);
    const page = await ladderPage("gyor", at("2026-11-10T10:00:00Z"));
    expect(page?.kind).toBe("ladder");
    if (page?.kind !== "ladder") return;
    expect(page.bands.map((b) => [b.label, b.groups.map((g) => g.number)])).toEqual([
      ["Bronz divízió", [1]],
      ["Réz divízió", [2, 3]],
      ["Rookie divízió", [4, 5]],
    ]);
  });

  it("shows this week's matches: week 2 on the second Monday, week 1 before the phase starts", async () => {
    publish(1, 3);
    const weekOf = async (now: string) => {
      const page = await ladderPage("gyor", at(now));
      if (page?.kind !== "ladder") throw new Error("no ladder");
      return { week: page.week, started: page.started, matches: page.bands[0]!.groups[0]!.weekMatches.length, range: [page.weekFrom, page.weekTo] };
    };
    expect(await weekOf("2026-11-07T10:00:00Z")).toEqual({ week: 1, started: false, matches: 1, range: ["nov. 9.", "nov. 15."] });
    expect(await weekOf("2026-11-17T10:00:00Z")).toEqual({ week: 2, started: true, matches: 1, range: ["nov. 16.", "nov. 22."] });
  });

  it("shows a scheduled match's time in Budapest time, and 'no time yet' for the others", async () => {
    publish(1, 1);
    // Week 1 is pair 1011 vs 1012: agreed for Tue 10 Nov 2026, 18:30 Budapest (17:30 UTC).
    h.raw
      .prepare("update matches set status = 'scheduled', scheduled_at = ? where pair_a = 1011 and pair_b = 1012")
      .run(sec("2026-11-10T17:30:00Z"));
    const page = await ladderPage("gyor", at("2026-11-07T10:00:00Z"));
    if (page?.kind !== "ladder") throw new Error("no ladder");
    expect(page.bands[0]!.groups[0]!.weekMatches.map((m) => m.when)).toEqual(["nov. 10., kedd 18:30"]);
    const week2 = await ladderPage("gyor", at("2026-11-17T10:00:00Z"));
    if (week2?.kind !== "ladder") throw new Error("no ladder");
    expect(week2.bands[0]!.groups[0]!.weekMatches.map((m) => m.when)).toEqual([null]);
  });

  it("shows the table in table order (Elo, then seed), with names, before any result", async () => {
    publish(1, 1);
    const page = await ladderPage("gyor", at("2026-11-10T10:00:00Z"));
    if (page?.kind !== "ladder") throw new Error("no ladder");
    expect(page.bands[0]!.groups[0]!.rows.map((r) => [r.rank, r.names[0], r.points])).toEqual([
      [1, "Játékos 1011A", 0],
      [2, "Játékos 1012A", 0],
      [3, "Játékos 1013A", 0],
    ]);
  });

  describe("counts final results only (#186)", () => {
    type Outcome = { kind: string; [key: string]: unknown };
    const played = (sets: [number, number][], superTieBreak?: [number, number]): Outcome => ({
      kind: "played",
      score: { sets, ...(superTieBreak ? { superTieBreak } : {}) },
    });

    // Group 1 with a fourth pair (1014): six matches for the four result kinds.
    function fourPairGroup() {
      publish(1, 1);
      const groupId = h.raw.prepare("select id from groups where number = 1").get().id;
      for (const side of ["a", "b"]) {
        h.raw
          .prepare("insert into users (id, email, name, phone, level, consent_at) values (?, ?, ?, '+36301234567', 'halado', 1)")
          .run(`u1014${side}`, `u1014${side}@titkos.example`, `Játékos 1014${side.toUpperCase()}`);
      }
      h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (1014, 1, 'u1014a', 'u1014b')").run();
      h.raw.prepare("insert into group_pairs (group_id, pair_id, seed) values (?, 1014, 4)").run(groupId);
      for (const [a, week] of [[1011, 3], [1012, 2], [1013, 1]] as const)
        h.raw
          .prepare("insert into matches (group_id, pair_a, pair_b, week, deadline) values (?, ?, 1014, ?, ?)")
          .run(groupId, a, week, sec(STARTS[0]!) + 21 * 86400 - 60);
    }
    const setMatch = (a: number, b: number, status: string, outcome: Outcome | null) =>
      h.raw
        .prepare("update matches set status = ?, outcome = ? where pair_a = ? and pair_b = ?")
        .run(status, outcome ? JSON.stringify(outcome) : null, a, b);
    const tableOf = async () => {
      const page = await ladderPage("gyor", at("2026-11-17T10:00:00Z"));
      if (page?.kind !== "ladder") throw new Error("no ladder");
      const group = page.bands[0]!.groups[0]!;
      return { rows: Object.fromEntries(group.rows.map((r) => [r.names[0].slice(-5, -1), [r.points, r.matches]])), group };
    };

    function playSeason() {
      fourPairGroup();
      // Confirmed: 1011 beats 1012.
      setMatch(1011, 1012, "final", played([[4, 1], [4, 2]]));
      // Auto-accepted (a ruling with no user): 1013 beats 1011.
      setMatch(1011, 1013, "final", played([[1, 4], [2, 4]]));
      // Organizer walkover: 1012 wins 4-0 4-0 over 1013.
      setMatch(1012, 1013, "final", { kind: "walkover", winner: "a" });
      // A result that waits for the other pair, and a disputed one.
      setMatch(1012, 1014, "result_pending", null);
      setMatch(1011, 1014, "disputed", null);
    }

    it("the table holds exactly the confirmed, auto-accepted and walkover results", async () => {
      playSeason();
      const { rows } = await tableOf();
      // 1011: win 3 + loss 1; 1012: loss 1 + walkover win 3; 1013: win 3 + walkover loss 0; 1014: nothing yet.
      expect(rows).toEqual({ "1011": [4, 2], "1012": [4, 2], "1013": [3, 2], "1014": [0, 0] });
    });

    it("a waiting or disputed result stays out whatever outcome is stored on the match", async () => {
      playSeason();
      setMatch(1012, 1014, "result_pending", played([[4, 0], [4, 0]]));
      setMatch(1011, 1014, "disputed", played([[4, 0], [4, 0]]));
      const { rows, group } = await tableOf();
      expect(rows["1014"]).toEqual([0, 0]);
      expect(rows["1011"]).toEqual([4, 2]);
      expect(group.results.map((m) => m.result)).toEqual(["4:1, 4:2", "kontumác"]); // week 2 is shown above, not listed again
    });

    it("a disputed result counts as soon as the organizer decides it", async () => {
      playSeason();
      setMatch(1011, 1014, "final", { kind: "walkover", winner: "b" });
      const { rows } = await tableOf();
      expect(rows).toEqual({ "1011": [4, 3], "1012": [4, 2], "1013": [3, 2], "1014": [3, 1] });
    });

    it("both lose counts a match with no points, unplayed counts nothing", async () => {
      playSeason();
      setMatch(1011, 1014, "final", { kind: "both-inactive" });
      setMatch(1012, 1014, "final", { kind: "unplayed" });
      const { rows, group } = await tableOf();
      expect(rows).toEqual({ "1011": [4, 3], "1012": [4, 2], "1013": [3, 2], "1014": [0, 1] });
      // The unplayed match has no score to show; both-inactive says so.
      expect(group.results.map((m) => m.result)).toContain("Mindkét pár vereséget kap (0:4, 0:4)");
      expect(group.results).toHaveLength(3);
    });

    it("the played matches show their scores for the week and in the results list", async () => {
      playSeason();
      const page = await ladderPage("gyor", at("2026-11-10T10:00:00Z")); // week 1
      if (page?.kind !== "ladder") throw new Error("no ladder");
      const group = page.bands[0]!.groups[0]!;
      expect(group.weekMatches.map((m) => m.result)).toEqual(["4:1, 4:2", null]);
      expect(group.results.map((m) => m.result)).toEqual(["1:4, 2:4", "kontumác"]); // the week-1 result is under the week, not listed twice (#202)
    });
  });

  it("moves on to the next phase once its groups are published and it has started", async () => {
    publish(1, 3);
    publish(2, 4);
    const page = await ladderPage("gyor", at("2026-11-30T10:00:00Z"));
    if (page?.kind !== "ladder") throw new Error("no ladder");
    expect(page.phase).toBe(2);
    expect(page.bands.flatMap((b) => b.groups).length).toBe(4);
    // Phase 2 is published but not started: phase 1 stays on show.
    const before = await ladderPage("gyor", at("2026-11-25T10:00:00Z"));
    if (before?.kind !== "ladder") throw new Error("no ladder");
    expect(before.phase).toBe(1);
  });

  it("carries no email, phone or internal id but the pair's, for its profile link (#36)", async () => {
    publish(1, 3);
    h.raw.prepare("update matches set status = 'scheduled', scheduled_at = ? where week = 1").run(sec("2026-11-10T17:30:00Z"));
    const page = await ladderPage("gyor", at("2026-11-10T10:00:00Z"));
    const text = JSON.stringify(page);
    expect(text).not.toMatch(/titkos\.example|@|\+36|30123|"u1\d+/);
    expect(text).toContain("Játékos 1011A");
    // No field is an id, whatever its value: collect every key of the data.
    const keys = new Set<string>();
    JSON.parse(text, function (key) {
      if (key) keys.add(key);
      return this[key];
    });
    // The one id: a table row's pair, for /pairs/<id> (#36). No user, group or match id.
    expect([...keys].filter((k) => /(^|[a-z])id$/i.test(k))).toEqual(["pairId"]);
    const rows = page?.kind === "ladder" ? page.bands.flatMap((b) => b.groups.flatMap((g) => g.rows)) : [];
    expect(rows.map((r) => r.pairId).sort()).toEqual([1011, 1012, 1013, 1021, 1022, 1023, 1031, 1032, 1033]);
  });

  it("is null for a league whose city is not listed (drafts and test leagues stay hidden)", async () => {
    publish(1, 3);
    h.raw.exec("update cities set listed = 0 where slug = 'gyor'");
    expect(await ladderPage("gyor", at("2026-11-10T10:00:00Z"))).toBeNull();
  });
});
