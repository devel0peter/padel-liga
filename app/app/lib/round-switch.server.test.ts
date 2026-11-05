// round-switch.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the next phase's draft from the ending phase's tables
// (#12, #35, D107), the cron step, the organizer's rebuild and publish.
// Email is stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueGroupsPublished: async (messages: any[]) => h.mails.push(...messages),
  queueStrikeWarnings: async () => {},
}));

const { migratedDatabase } = await import("~/test/sqlite");
const G = await import("~/lib/groups.server");
const R = await import("~/lib/round-switch.server");
const { DISPUTES_FIRST, NOT_READY, OUTDATED_DRAFT } = await import("~/lib/round-switch");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

// Phases from Monday 9 Nov 2026 (Budapest, UTC+1).
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const BEFORE = new Date("2026-11-07T10:00:00Z");
const DURING = new Date("2026-11-20T10:00:00Z");
// Monday after phase 1's deadline, 07:00 Budapest.
const AFTER = new Date("2026-11-30T06:00:00Z");
const APPROVED = sec("2026-11-06T10:00:00Z");

// Average starting Elo by pair id: 1600, 1500, 1400, 1400, 1300, 1200, 1100, 1100, 1000.
const LEVELS: [string, string][] = [
  ["versenyzo", "versenyzo"],
  ["versenyzo", "halado"],
  ["halado", "halado"],
  ["halado", "halado"],
  ["halado", "kozephalado"],
  ["kozephalado", "kozephalado"],
  ["kozephalado", "kezdo"],
  ["kozephalado", "kezdo"],
  ["kezdo", "kezdo"],
];

function addPair(id: number, entry: { joinsPhase?: number } = {}) {
  const levels = LEVELS[id - 1]!;
  for (const side of ["a", "b"] as const)
    h.raw
      .prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, ?, 1)")
      .run(`p${id}${side}`, `p${id}${side}@x.hu`, `Játékos ${id}${side.toUpperCase()}`, levels[side === "a" ? 0 : 1]);
  h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)").run(id, `p${id}a`, `p${id}b`);
  h.raw
    .prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, 'approved', ?, ?)")
    .run(id, entry.joinsPhase ?? 1, APPROVED + id);
}

function addSeason(id: number, league = 1) {
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (?, ?, ?, ?, ?, '2026-11-09')",
    )
    .run(id, league, `Szezon ${id}`, sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  PHASES.forEach((start, i) =>
    h.raw
      .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (?, ?, ?, ?)")
      .run(id, i + 1, sec(start), sec(start) + 21 * 86400 - 60),
  );
}

// Eight pairs in phase 1 (4+4), published.
async function freshDb() {
  h.raw = migratedDatabase();
  h.mails = [];
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('o', 'o@x.hu', 'Org', 'versenyzo', 1)`);
  addSeason(1);
  for (let id = 1; id <= 8; id++) addPair(id);
  expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
  expect(await G.publishGroups(1, "o", BEFORE)).toEqual({ ok: true });
  h.mails = [];
}

const all = (q: string, ...params: unknown[]) => h.raw.prepare(q).all(...params);
const won = (a: number, b: number) => JSON.stringify({ kind: "played", score: { sets: a < b ? [[4, 1], [4, 1]] : [[1, 4], [1, 4]] } });

// Every phase-1 match final, the pair with the lower id winning: each table
// runs in pair id order.
function finishAll(except: number[] = []) {
  for (const m of all("select id, pair_a, pair_b from matches"))
    if (!except.includes(m.id)) h.raw.prepare("update matches set status = 'final', outcome = ? where id = ?").run(won(m.pair_a, m.pair_b), m.id);
}
const matchOf = (a: number, b: number) =>
  all("select id from matches where (pair_a = ? and pair_b = ?) or (pair_a = ? and pair_b = ?)", a, b, b, a)[0].id as number;

// A phase's stored groups: pair ids per group number, by seed.
const groupsOf = (phase: number) => {
  const out: number[][] = [];
  for (const r of all(
    "select g.number, gp.pair_id from groups g join group_pairs gp on gp.group_id = g.id where g.season_id = 1 and g.phase = ? order by g.number, gp.seed",
    phase,
  ))
    (out[r.number - 1] ??= []).push(r.pair_id);
  return out;
};
const ids = (draft: { pairId: number }[][]) => draft.map((g) => g.map((p) => p.pairId));

describe("roundSwitch (#12, #35)", () => {
  beforeEach(freshDb);

  it("is running before the deadline and resolving while a match waits for the resolution", async () => {
    expect((await R.roundSwitch(1, 2, DURING))!.state).toBe("running");
    finishAll([matchOf(1, 2)]);
    expect((await R.roundSwitch(1, 2, AFTER))!.state).toBe("resolving");
    finishAll();
    expect((await R.roundSwitch(1, 2, AFTER))!.state).toBe("ready");
  });

  it("has no switch into phase 1, after the last phase, or before the ending phase is published", async () => {
    expect(await R.roundSwitch(1, 1, AFTER)).toBeNull();
    expect(await R.roundSwitch(1, 5, AFTER)).toBeNull();
    expect(await R.roundSwitch(1, 3, AFTER)).toBeNull();
  });

  it("swaps 2 pairs at the first switch of the league's first season (fast calibration)", async () => {
    finishAll();
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.fast).toBe(true);
    expect(s.tables.map((t) => t.rows.map((r) => r.pair.pairId))).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
    // Seeded by Elo: 5 (1300) and 6 (1200) below 1 and 2; 3 and 4 tie at 1400.
    expect(ids(s.draft)).toEqual([
      [1, 2, 5, 6],
      [3, 4, 7, 8],
    ]);
    expect(s.origins.get(5)).toEqual({ kind: "continuing", group: 2, place: 1 });
  });

  it("swaps 1 pair once the league setting has no fast switch left", async () => {
    h.raw.exec("update leagues set fast_switches = 0");
    finishAll();
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.fast).toBe(false);
    expect(ids(s.draft)).toEqual([
      [1, 2, 3, 5],
      [4, 6, 7, 8],
    ]);
  });

  it("is never fast in a later season of the league", async () => {
    // An earlier season of the league (a lower id): season 1 is not its first.
    addSeason(0);
    finishAll();
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.fast).toBe(false);
  });

  it("counts a recorded result not yet confirmed, and lists a disputed one", async () => {
    finishAll([matchOf(1, 2), matchOf(3, 4)]);
    const m12 = matchOf(1, 2);
    const p12 = all("select pair_a from matches where id = ?", m12)[0].pair_a;
    // Pair 2 wins 1–2 by a recorded result: 2 tops group 1.
    h.raw.prepare("update matches set status = 'result_pending' where id = ?").run(m12);
    h.raw
      .prepare("insert into match_events (match_id, pair_id, user_id, kind, score, at) values (?, ?, 'p2a', 'result_recorded', ?, ?)")
      .run(m12, 2, JSON.stringify({ sets: p12 === 2 ? [[4, 1], [4, 1]] : [[1, 4], [1, 4]] }), sec("2026-11-28T10:00:00Z"));
    h.raw.prepare("update matches set status = 'disputed' where id = ?").run(matchOf(3, 4));
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.state).toBe("ready");
    expect(s.tables[0]!.rows[0]!.pair.pairId).toBe(2);
    expect(s.disputes.map((d) => [d.kind, d.group, d.pairs.map((p) => p.pairId).sort()])).toEqual([["disputed", 1, [3, 4]]]);
  });

  it("removes leavers after promotion and relegation: a 3rd strike, a dissolved pair, a take-out, a withdrawal", async () => {
    finishAll();
    // Pair 5 wins group 2 and has a player with 3 strikes: it is promoted, then leaves.
    for (let i = 0; i < 3; i++)
      h.raw.prepare("insert into strikes (season_id, user_id, pair_id, source, at) values (1, 'p5a', 5, 'deadline', ?)").run(sec("2026-11-30T05:00:00Z"));
    // Pair 8 is dissolved after the deadline, pair 4's entry taken out.
    h.raw.exec("update pairs set status = 'dissolved' where id = 8");
    h.raw.exec("update season_entries set status = 'withdrawn' where pair_id = 4");
    // Pair 7 withdrew mid-phase: out of the table.
    h.raw.exec("update group_pairs set withdrawn_at = 1, withdrawal_reason = 'sérülés' where pair_id = 7");
    h.raw.exec("update season_entries set status = 'withdrawn' where pair_id = 7");
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.leaving.map((l) => [l.pair.pairId, l.reason]).sort()).toEqual([
      [4, "taken_out"],
      [5, "strikes"],
      [7, "withdrawn"],
      [8, "dissolved"],
    ]);
    // Group 2's table without 7 has 3 pairs, so 1 swaps at the fast switch:
    // 5 up, 4 down. Without the leavers 4 pairs stay: one group.
    expect(ids(s.draft)).toEqual([[1, 2, 3, 6]]);
  });

  it("places a pair withdrawn mid-phase and entered again as a new pair, not as leaving", async () => {
    finishAll();
    h.raw.exec("update group_pairs set withdrawn_at = 1, withdrawal_reason = 'sérülés' where pair_id = 7");
    // The organizer entered it again: it joins at the next phase.
    h.raw.exec("update season_entries set joins_phase = 2 where pair_id = 7");
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.leaving).toEqual([]);
    expect(s.newPairs.map((n) => n.pair.pairId)).toEqual([7]);
    expect(s.origins.get(7)).toEqual({ kind: "new" });
  });

  it("places a pair entered for phase 2 (interim: at the bottom)", async () => {
    addPair(9, { joinsPhase: 2 });
    finishAll();
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.newPairs.map((n) => [n.pair.pairId, n.rating])).toEqual([[9, 900]]);
    expect(s.origins.get(9)).toEqual({ kind: "new" });
    expect(ids(s.draft).map((g) => g.length)).toEqual([3, 3, 3]);
    expect(ids(s.draft)[2]).toContain(9);
  });
});

describe("generateRoundSwitchDraft and publishRoundSwitch (#35)", () => {
  beforeEach(freshDb);

  it("refuses before the ending phase is settled", async () => {
    expect(await R.generateRoundSwitchDraft(1, 2, "o", AFTER)).toEqual({ ok: false, error: NOT_READY });
    expect(groupsOf(2)).toEqual([]);
  });

  it("writes the draft unpublished, audited, and rebuilds it from the current results", async () => {
    finishAll();
    expect(await R.generateRoundSwitchDraft(1, 2, "o", AFTER)).toEqual({ ok: true });
    expect(groupsOf(2)).toEqual([
      [1, 2, 5, 6],
      [3, 4, 7, 8],
    ]);
    expect(all("select count(*) n from groups where phase = 2 and published_at is not null")[0].n).toBe(0);
    expect(all("select actor_id, action, detail from audit_log where action = 'groups.draft' order by id desc limit 1")).toEqual([
      { actor_id: "o", action: "groups.draft", detail: "phase 2: 8 pairs" },
    ]);
    // The organizer moves a pair; a rebuild drops the move.
    expect(await G.moveDraftPair(1, 6, 2, "o", 2)).toEqual({ ok: true });
    expect(groupsOf(2)[0]).toEqual([1, 2, 5]);
    expect(await R.generateRoundSwitchDraft(1, 2, "o", AFTER)).toEqual({ ok: true });
    expect(groupsOf(2)[0]).toEqual([1, 2, 5, 6]);
  });

  it("refuses to publish while the ending phase has a disputed result, then publishes phase 2 with its emails", async () => {
    finishAll([matchOf(5, 6)]);
    h.raw.prepare("update matches set status = 'disputed' where id = ?").run(matchOf(5, 6));
    expect(await R.generateRoundSwitchDraft(1, 2, "o", AFTER)).toEqual({ ok: true });
    expect(await R.publishRoundSwitch(1, 2, "o", AFTER)).toEqual({ ok: false, error: DISPUTES_FIRST });
    h.raw.prepare("update matches set status = 'final', outcome = ? where id = ?").run(won(5, 6), matchOf(5, 6));
    expect(await R.publishRoundSwitch(1, 2, "o", AFTER)).toEqual({ ok: true });
    const phase2 = all("select m.deadline from matches m join groups g on g.id = m.group_id where g.phase = 2");
    expect(phase2).toHaveLength(12);
    expect(new Set(phase2.map((m: any) => m.deadline))).toEqual(new Set([sec(PHASES[1]!) + 21 * 86400 - 60]));
    expect(h.mails).toHaveLength(16);
    expect(h.mails.every((m) => m.input.phase === 2)).toBe(true);
    expect(await R.publishRoundSwitch(1, 2, "o", AFTER)).toMatchObject({ ok: false });
  });

  it("drafts around a waiting no-show report (#33) and refuses to publish until it is decided", async () => {
    const m = matchOf(7, 8);
    finishAll([m]);
    // The deadline resolution left the match open for the organizer.
    h.raw
      .prepare("insert into no_show_reports (match_id, pair_id, status, reported_by, reported_at) values (?, 7, 'open', 'p7a', ?)")
      .run(m, sec("2026-11-28T18:00:00Z"));
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.state).toBe("ready");
    expect(s.disputes.map((d) => [d.kind, d.matchId])).toEqual([["no_show", m]]);
    expect(await R.generateRoundSwitchDraft(1, 2, "o", AFTER)).toEqual({ ok: true });
    expect(await R.publishRoundSwitch(1, 2, "o", AFTER)).toEqual({ ok: false, error: DISPUTES_FIRST });
    // Decided (a walkover for the reporting pair): it goes out.
    h.raw.prepare("update no_show_reports set status = 'confirmed' where match_id = ?").run(m);
    h.raw.prepare("update matches set status = 'final', outcome = ? where id = ?").run(won(7, 8), m);
    expect(await R.publishRoundSwitch(1, 2, "o", AFTER)).toEqual({ ok: true });
  });

  it("refuses an outdated draft: a dispute settled since changes who goes up; a rebuild fixes it", async () => {
    h.raw.exec("update leagues set fast_switches = 0");
    const m = matchOf(5, 6);
    finishAll([m]);
    h.raw.prepare("update matches set status = 'disputed' where id = ?").run(m);
    expect(await R.generateRoundSwitchDraft(1, 2, "o", AFTER)).toEqual({ ok: true });
    // Without that match 5 tops group 2 (on Elo) and goes up.
    expect(groupsOf(2)[0]).toContain(5);
    // Settled for 6: now 6 tops group 2.
    const { pair_a } = all("select pair_a from matches where id = ?", m)[0];
    const sixWins = JSON.stringify({ kind: "played", score: { sets: pair_a === 6 ? [[4, 1], [4, 1]] : [[1, 4], [1, 4]] } });
    h.raw.prepare("update matches set status = 'final', outcome = ? where id = ?").run(sixWins, m);
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(R.draftOutdated(await G.phaseGroups(1, 2), s)).toBe(true);
    expect(await R.publishRoundSwitch(1, 2, "o", AFTER)).toEqual({ ok: false, error: OUTDATED_DRAFT });
    expect(await R.generateRoundSwitchDraft(1, 2, "o", AFTER)).toEqual({ ok: true });
    expect(groupsOf(2)[0]).toContain(6);
    expect(await R.publishRoundSwitch(1, 2, "o", AFTER)).toEqual({ ok: true });
  });

  it("keeps a draft with the organizer's moves current while nothing it came from changes", async () => {
    finishAll();
    await R.generateRoundSwitchDraft(1, 2, "o", AFTER);
    await G.moveDraftPair(1, 4, 1, "o", 2);
    await G.moveDraftPair(1, 6, 2, "o", 2);
    // An Elo change alone (here: pair 7 now outrates every pair of group 2)
    // reorders seeds but keeps the groups: still current.
    h.raw.exec("update users set elo = 1900 where id in ('p7a', 'p7b')");
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.draft[1]![0]!.pairId).toBe(7);
    expect(R.draftOutdated(await G.phaseGroups(1, 2), s)).toBe(false);
    expect(await R.publishRoundSwitch(1, 2, "o", AFTER)).toEqual({ ok: true });
    expect(groupsOf(2)[0]).toContain(4);
  });

  it("refuses a stale draft: a pair entered since", async () => {
    finishAll();
    await R.generateRoundSwitchDraft(1, 2, "o", AFTER);
    addPair(9, { joinsPhase: 2 });
    expect(await R.publishRoundSwitch(1, 2, "o", AFTER)).toEqual({ ok: false, error: OUTDATED_DRAFT });
  });
});

describe("draftRoundSwitches, the cron step (#35)", () => {
  beforeEach(freshDb);

  it("waits for the resolution, drafts once as the system, and never redrafts", async () => {
    expect(await R.draftRoundSwitches(DURING)).toBeNull();
    finishAll([matchOf(1, 2)]);
    expect(await R.draftRoundSwitches(AFTER)).toBeNull();
    finishAll();
    expect(await R.draftRoundSwitches(AFTER)).toBe("drafted phase 2 of season 1");
    expect(all("select actor_id from audit_log where action = 'groups.draft' order by id desc limit 1")).toEqual([{ actor_id: null }]);
    expect(groupsOf(2)).toHaveLength(2);
    // The organizer's moves stay: the cron doesn't touch an existing draft.
    await G.moveDraftPair(1, 6, 2, "o", 2);
    expect(await R.draftRoundSwitches(AFTER)).toBeNull();
    expect(groupsOf(2)[0]).toEqual([1, 2, 5]);
  });

  it("drafts nothing after a season's last phase", async () => {
    finishAll();
    // Phase 4's deadline has passed with phase 4 published: no phase 5.
    h.raw.exec("update groups set phase = 4");
    expect(await R.draftRoundSwitches(new Date("2027-02-20T06:00:00Z"))).toBeNull();
  });

  it("leaves room for the later steps", async () => {
    const { RunBudget } = await import("~/lib/run-usage");
    finishAll();
    const run = new RunBudget();
    expect(await R.draftRoundSwitches(AFTER, { run, keep: { queries: 50, calls: 0 } })).toMatch(/left for the next/);
    expect(run.used().queries).toBe(0);
    // Room for the lookup, not for a draft: deferred, nothing replayed or written.
    const tight = new RunBudget();
    expect(await R.draftRoundSwitches(AFTER, { run: tight, keep: { queries: 50 - R.ROUND_LOOKUP_QUERIES - 1, calls: 0 } })).toMatch(/left for the next run/);
    expect(tight.used().queries).toBe(R.ROUND_LOOKUP_QUERIES);
    expect(groupsOf(2)).toEqual([]);
  });

  it("costs one query, no Elo replay, while seasons still wait for the resolution", async () => {
    const { RunBudget } = await import("~/lib/run-usage");
    // A second league and season on the same calendar, also not settled.
    h.raw.exec(`insert into leagues (id, city, slug, name) values (2, 'gyor', 'gyor-2', 'Második')`);
    addSeason(2, 2);
    h.raw.exec(`insert into groups (season_id, phase, number, published_at) values (2, 1, 1, ${sec("2026-11-07T10:00:00Z")})`);
    h.raw.exec(`insert into matches (group_id, pair_a, pair_b, week, deadline) select id, 1, 2, 1, 0 from groups where season_id = 2`);
    finishAll([matchOf(1, 2)]);
    h.raw.exec("update matches set status = 'open', outcome = null where group_id in (select id from groups where season_id = 2)");
    const run = new RunBudget();
    expect(await R.draftRoundSwitches(AFTER, { run, keep: { queries: 0, calls: 0 } })).toBeNull();
    expect(run.used().queries).toBe(1);
  });
});
