// match-overview.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the organizer's overview of the running phase (#158). The
// groups are published with groups.server.ts and the steps are taken with
// matches.server.ts, as the players take them; email is stubbed.
import { budapestTime } from "@padel-liga/rules";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueGroupsPublished: async () => {},
  queueSeasonEntryDecision: async () => {},
  queueMatchEmails: async () => {},
}));

const { migratedDatabase } = await import("~/test/sqlite");
const G = await import("~/lib/groups.server");
const M = await import("~/lib/matches.server");
const O = await import("~/lib/match-overview.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (day: string, hour: number, minute = 0) => budapestTime(day, hour, minute);
const hours = (from: Date, n: number) => new Date(from.getTime() + n * 3600 * 1000);

// Phase 1 runs Mon 9 – Sun 29 Nov 2026 (Budapest, UTC+1).
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const DEADLINE = new Date((sec(PHASES[0]!) + 21 * 86400 - 60) * 1000);
const MONDAY = at("2026-11-09", 10);
// Wednesday 11:00 of week 1: 49 hours after MONDAY, past the first 2 days.
const NOW = hours(MONDAY, 49);

// 7 pairs, 4 + 3 (as in matches.server.test.ts). Group 1: week 1 1–3 and
// 2–4, week 2 1–4 and 2–3, week 3 1–2 and 4–3. Group 2: week 1 6–7, week 2
// 5–7, week 3 5–6.
const LEVELS: [string, string][] = [
  ["versenyzo", "versenyzo"],
  ["versenyzo", "halado"],
  ["halado", "halado"],
  ["halado", "halado"],
  ["halado", "kozephalado"],
  ["kozephalado", "kozephalado"],
  ["kozephalado", "kezdo"],
];

async function freshDb() {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('pecs', 'Pécs', 1)`);
  h.raw.exec(`insert into clubs (id, slug, city, name, active) values (1, 'ace', 'gyor', 'Ace Padel', 1)`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'pecs', 'pecs', 'Padelpárbaj Pécs')`);
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
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('o', 'o@x.hu', 'Org', 'versenyzo', 1)`);
  LEVELS.forEach((levels, i) => {
    const id = i + 1;
    for (const side of ["a", "b"] as const)
      h.raw
        .prepare("insert into users (id, email, name, level, phone, consent_at) values (?, ?, ?, ?, ?, 1)")
        .run(`p${id}${side}`, `p${id}${side}@x.hu`, `Játékos ${id}${side.toUpperCase()}`, levels[side === "a" ? 0 : 1], `+3630${id}00000${side === "a" ? 1 : 2}`);
    h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)").run(id, `p${id}a`, `p${id}b`);
    h.raw
      .prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, 'approved', 1, ?)")
      .run(id, sec("2026-11-06T10:00:00Z") + (id === 4 ? 0 : id + 10));
  });
  expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
  expect(await G.publishGroups(1, "o", new Date("2026-11-08T08:00:00Z"))).toEqual({ ok: true });
}

const all = (q: string, ...params: unknown[]) => h.raw.prepare(q).all(...params);
const matchOf = (a: number, b: number): number =>
  all("select id from matches where (pair_a = ? and pair_b = ?) or (pair_a = ? and pair_b = ?)", a, b, b, a)[0].id;

const SLOTS = [at("2026-11-12", 18), at("2026-11-13", 19, 30), at("2026-11-14", 10)];

// One match in each scheduling status, and a few that nobody touched.
async function play() {
  // 1–3: a proposal on Monday, unanswered by Wednesday: stuck.
  expect((await M.matchStep("p1a", matchOf(1, 3), { kind: "propose", slots: SLOTS, clubId: null }, MONDAY)).ok).toBe(true);
  // 2–4: an agreed time, confirmed: scheduled at Ace Padel.
  expect((await M.matchStep("p2a", matchOf(2, 4), { kind: "agreed", slot: at("2026-11-12", 20), clubId: 1 }, hours(NOW, -3))).ok).toBe(true);
  expect((await M.matchStep("p4b", matchOf(2, 4), { kind: "confirm" }, hours(NOW, -2))).ok).toBe(true);
  // 1–4 (week 2): an agreed time waiting, fresh.
  expect((await M.matchStep("p4a", matchOf(1, 4), { kind: "agreed", slot: at("2026-11-17", 19), clubId: null }, hours(NOW, -1))).ok).toBe(true);
}

describe("runningPhases (#158)", () => {
  beforeEach(freshDb);

  it("lists every match of the running phase by group and week, each with its status, last activity and activity", async () => {
    await play();
    const [phase, ...rest] = await O.runningPhases(1, NOW);
    expect(rest).toEqual([]);
    expect(phase).toMatchObject({ season: "2026/27 tél", phase: 1, deadline: DEADLINE, groupCount: 2, groups: [1, 2] });
    expect(phase!.matches).toHaveLength(6 + 3);
    const byId = new Map(phase!.matches.map((m) => [m.id, m]));

    expect(byId.get(matchOf(1, 3))).toMatchObject({
      groupNumber: 1,
      week: 1,
      status: "proposed",
      label: "Időpontokat ajánlottak, Játékos 3A – Játékos 3B válaszára vár",
      lastActivity: MONDAY,
      active: { a: true, b: false },
      activity: "Csak Játékos 1A – Játékos 1B lépett",
      stuck: "unanswered",
    });
    expect(byId.get(matchOf(2, 4))).toMatchObject({
      status: "scheduled",
      label: "Lefixálva: nov. 12., csütörtök 20:00, Ace Padel",
      tone: "done",
      lastActivity: hours(NOW, -2),
      active: { a: true, b: true },
      stuck: null,
    });
    expect(byId.get(matchOf(1, 4))).toMatchObject({
      week: 2,
      status: "agreed_time",
      label: "Megbeszélt időpont (nov. 17., kedd 19:00), Játékos 1A – Játékos 1B megerősítésére vár",
      lastActivity: hours(NOW, -1),
      stuck: null,
    });
    // Untouched: stuck in week 1 (past Tuesday), not in weeks 2 and 3.
    expect(byId.get(matchOf(6, 7))).toMatchObject({
      groupNumber: 2,
      week: 1,
      status: "to_schedule",
      label: "Egyeztetésre vár",
      lastActivity: null,
      activity: "Még egyik pár sem lépett",
      stuck: "no_activity",
    });
    expect(byId.get(matchOf(2, 3))).toMatchObject({ week: 2, status: "to_schedule", stuck: null });
    expect(phase!.matches.filter((m) => m.stuck).map((m) => m.id).sort()).toEqual([matchOf(1, 3), matchOf(6, 7)].sort());
    // Sorted by week, then id.
    expect(phase!.matches.map((m) => m.week)).toEqual([...phase!.matches.map((m) => m.week)].sort());
  });

  it("names only: no phone number or email address on the list", async () => {
    await play();
    const json = JSON.stringify(await O.runningPhases(1, NOW));
    expect(json).not.toContain("@");
    expect(json).not.toContain("+36");
  });

  it("is empty before the groups are published, after the deadline, and for another league", async () => {
    expect(await O.runningPhases(1, hours(DEADLINE, 1))).toEqual([]);
    expect(await O.runningPhases(2, NOW)).toEqual([]);
    h.raw.exec("update groups set published_at = null");
    expect(await O.runningPhases(1, NOW)).toEqual([]);
  });
});

describe("organizerMatch (#158)", () => {
  beforeEach(freshDb);

  it("shows the status, both pairs' phones while the phase runs, and every step with player, pair and time", async () => {
    await play();
    const m = (await O.organizerMatch(1, matchOf(2, 4), NOW))!;
    expect(m).toMatchObject({ week: 1, groupNumber: 1, groupCount: 2, running: true, tone: "done", stuck: null, activity: "Mindkét pár lépett" });
    expect(m.pairs).toEqual([
      {
        side: "a",
        name: "Játékos 2A – Játékos 2B",
        active: true,
        players: [
          { name: "Játékos 2A", phone: "+36 30 200 0001" },
          { name: "Játékos 2B", phone: "+36 30 200 0002" },
        ],
      },
      {
        side: "b",
        name: "Játékos 4A – Játékos 4B",
        active: true,
        players: [
          { name: "Játékos 4A", phone: "+36 30 400 0001" },
          { name: "Játékos 4B", phone: "+36 30 400 0002" },
        ],
      },
    ]);
    expect(m.log).toEqual([
      {
        id: expect.any(Number),
        at: hours(NOW, -3),
        who: "Játékos 2A",
        pair: "Játékos 2A – Játékos 2B",
        text: "Rögzítette a megbeszélt időpontot: nov. 12., csütörtök 20:00, helyszín: Ace Padel",
      },
      { id: expect.any(Number), at: hours(NOW, -2), who: "Játékos 4B", pair: "Játékos 4A – Játékos 4B", text: "Megerősítette a megbeszélt időpontot" },
    ]);
    expect(JSON.stringify(m)).not.toContain("@");
  });

  it("a stuck match says why; an untouched one has an empty log", async () => {
    await play();
    expect((await O.organizerMatch(1, matchOf(1, 3), NOW))!.stuck).toBe("unanswered");
    const quiet = (await O.organizerMatch(1, matchOf(6, 7), NOW))!;
    expect(quiet).toMatchObject({ stuck: "no_activity", log: [] });
  });

  it("a deleted player's step stays in the log without a name", async () => {
    await play();
    h.raw.exec("update match_events set user_id = null where user_id = 'p1a'");
    expect((await O.organizerMatch(1, matchOf(1, 3), NOW))!.log[0]).toMatchObject({ who: "Törölt játékos", pair: "Játékos 1A – Játékos 1B" });
  });

  it("after the deadline: the log stays, phones go", async () => {
    await play();
    const m = (await O.organizerMatch(1, matchOf(2, 4), hours(DEADLINE, 1)))!;
    expect(m.running).toBe(false);
    expect(m.pairs.flatMap((p) => p.players.map((x) => x.phone))).toEqual([null, null, null, null]);
    expect(m.log).toHaveLength(2);
  });

  it("another league's match, an unpublished one or a missing one is null", async () => {
    await play();
    expect(await O.organizerMatch(2, matchOf(2, 4), NOW)).toBeNull();
    expect(await O.organizerMatch(1, 99999, NOW)).toBeNull();
    h.raw.exec("update groups set published_at = null");
    expect(await O.organizerMatch(1, matchOf(2, 4), NOW)).toBeNull();
  });
});
