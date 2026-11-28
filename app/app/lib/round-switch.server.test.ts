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
  queuePartnerChangeEmail: async () => {},
}));

const { migratedDatabase } = await import("~/test/sqlite");
const G = await import("~/lib/groups.server");
const R = await import("~/lib/round-switch.server");
const S = await import("~/lib/strikes.server");
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
      .prepare("insert into season_phases (season_id, number, starts_at, deadline, set_games) values (?, ?, ?, ?, 4)")
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

  it("places a pair entered for phase 2 by its starting Elo, with no discount (D107f)", async () => {
    addPair(9, { joinsPhase: 2 });
    finishAll();
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    // Kezdő + kezdő: 1000, not 900.
    expect(s.newPairs.map((n) => [n.pair.pairId, n.rating])).toEqual([[9, 1000]]);
    expect(s.origins.get(9)).toEqual({ kind: "new" });
    // 9 pairs: 3+3+3, the weakest pair at the bottom.
    expect(ids(s.draft).map((g) => g.length)).toEqual([3, 3, 3]);
    expect(ids(s.draft)[2]).toContain(9);
  });

  it("rates a returning player by their current Elo: the pair enters the bottom of its target's division", async () => {
    addPair(9, { joinsPhase: 2 });
    // A rated player (1500) with a kezdő partner (1000): 1250, exactly group 2's
    // average, so group 2 is the target and, one group per division, the entry.
    h.raw.exec("update users set elo = 1500 where id = 'p9a'");
    finishAll();
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.newPairs.map((n) => n.rating)).toEqual([1250]);
    expect(ids(s.draft)[1]).toContain(9);
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

  it("notifies league Szervezők and Admins once with blocker count, respects opt-out, and skips manual rebuild (#432)", async () => {
    h.raw.exec(`
      insert into users (id, email, name, platform_role) values
        ('org1', 'org1@x.hu', 'Szervező Egy', 'player'),
        ('org2', 'org2@x.hu', 'Szervező Kettő', 'player'),
        ('adm1', 'adm1@x.hu', 'Admin Egy', 'superadmin');
      insert into league_admins (league_id, user_id) values (1, 'org1'), (1, 'org2');
      insert into notification_opt_outs (user_id, kind) values ('org2', 'round_draft_ready');
    `);
    const disputed = matchOf(5, 6);
    finishAll([disputed]);
    h.raw.prepare("update matches set status = 'disputed' where id = ?").run(disputed);

    expect(await R.draftRoundSwitches(AFTER)).toBe("drafted phase 2 of season 1");
    const rows = all(
      "select user_id, kind, title, body, url, push_due_at from notifications where kind = 'round_draft_ready' order by user_id",
    ) as { user_id: string; kind: string; title: string; body: string; url: string; push_due_at: number | null }[];
    expect(rows.map((r) => r.user_id)).toEqual(["adm1", "org1"]);
    expect(rows[0].title).toContain("kész a 2. kör tervezete");
    expect(rows[0].body).toContain("Előtte 1 döntés vár rád.");
    expect(rows[0].url).toBe("/admin/leagues/gyor/seasons/1/groups?phase=2");
    expect(rows[0].push_due_at).not.toBeNull();

    // Manual rebuild ("Tervezet újraszámolása") sends no new notification.
    expect(await R.generateRoundSwitchDraft(1, 2, "org1", AFTER)).toEqual({ ok: true });
    const afterRebuild = all("select id from notifications where kind = 'round_draft_ready'");
    expect(afterRebuild).toHaveLength(2);
  });
});

describe("roundSwitchPreview (#363): the next round if the round ended now", () => {
  beforeEach(freshDb);

  // A proposal by `pair` on a match: valid activity (spec 8).
  const proposes = (pair: number, matchId: number) =>
    h.raw
      .prepare("insert into match_events (match_id, pair_id, user_id, kind, slots, at) values (?, ?, ?, 'proposal', ?, ?)")
      .run(matchId, pair, `p${pair}a`, JSON.stringify([sec("2026-11-25T17:00:00Z")]), sec(DURING.toISOString()));

  it("counts an open match with the outcome the deadline would give it now (fast calibration: 2 swap)", async () => {
    // 2–3 open, only pair 3 active: a walkover for 3, so 3 passes 2 and 2 goes down.
    finishAll([matchOf(2, 3)]);
    proposes(3, matchOf(2, 3));
    const p = (await R.roundSwitchPreview(1, 2, DURING))!;
    expect(p.fast).toBe(true);
    expect(p.undecided).toBe(1);
    expect(p.tables[0]!.rows.map((r) => r.pair.pairId)).toEqual([1, 3, 2, 4]);
    expect(ids(p.draft)).toEqual([
      [1, 3, 5, 6],
      [2, 4, 7, 8],
    ]);
    expect(p.origins.get(2)).toEqual({ kind: "continuing", group: 1, place: 3 });
    // Without the projection the open match counts for nothing and 2 stays up.
    expect(ids((await R.roundSwitch(1, 2, DURING))!.draft)).toEqual([
      [1, 2, 5, 6],
      [3, 4, 7, 8],
    ]);
  });

  it("a pair reaching its 3rd strike only through a projected outcome leaves, and the groups are re-cut", async () => {
    // 7–8 open, nobody active: both lose, a strike for all four. p8a has 2 already.
    finishAll([matchOf(7, 8)]);
    for (let i = 0; i < 2; i++)
      h.raw.prepare("insert into strikes (season_id, user_id, pair_id, source, at) values (1, 'p8a', 8, 'no_show', ?)").run(sec("2026-11-15T10:00:00Z"));
    const p = (await R.roundSwitchPreview(1, 2, DURING))!;
    expect(p.leaving.map((l) => [l.pair.pairId, l.reason])).toEqual([[8, "strikes"]]);
    expect(p.draft.flat().map((x) => x.pairId)).not.toContain(8);
    expect(p.draft.map((g) => g.length)).toEqual([4, 3]);
    // Today's switch doesn't see that strike yet.
    expect((await R.roundSwitch(1, 2, DURING))!.leaving).toEqual([]);
  });

  it("counts a result waiting for confirmation as recorded, and not a disputed one", async () => {
    finishAll([matchOf(2, 3), matchOf(5, 6)]);
    const pending = matchOf(2, 3);
    const pairA = all("select pair_a from matches where id = ?", pending)[0].pair_a;
    // Pair 3 beat 2 by a recorded result: 3 passes 2.
    h.raw.prepare("update matches set status = 'result_pending' where id = ?").run(pending);
    h.raw
      .prepare("insert into match_events (match_id, pair_id, user_id, kind, score, at) values (?, 3, 'p3a', 'result_recorded', ?, ?)")
      .run(pending, JSON.stringify({ sets: pairA === 3 ? [[4, 1], [4, 1]] : [[1, 4], [1, 4]] }), sec(DURING.toISOString()));
    // 5–6 disputed: it counts for nothing, so it is no both-lose either.
    h.raw.prepare("update matches set status = 'disputed' where id = ?").run(matchOf(5, 6));
    const p = (await R.roundSwitchPreview(1, 2, DURING))!;
    expect(p.tables[0]!.rows.map((r) => r.pair.pairId)).toEqual([1, 3, 2, 4]);
    expect(p.tables[1]!.rows.map((r) => r.pair.pairId)).toEqual([5, 6, 7, 8]);
    expect(p.undecided).toBe(2);
    expect(await S.liveCounts(["p5a", "p6a"], [1])).toEqual(new Map());
  });

  it("is not shown in a season's last round nor once the real draft exists", async () => {
    expect(await R.roundSwitchPreview(1, 5, DURING)).toBeNull();
    expect(await R.roundSwitchPreview(1, 2, DURING)).not.toBeNull();
    finishAll();
    expect(await R.generateRoundSwitchDraft(1, 2, "o", AFTER)).toEqual({ ok: true });
    expect(await R.roundSwitchPreview(1, 2, AFTER)).toBeNull();
  });

  it("reads only: nothing stored, sent or audited, and the real draft and publishing work as before", async () => {
    finishAll([matchOf(7, 8)]);
    const before = all("select total_changes() as n")[0].n;
    expect(await R.roundSwitchPreview(1, 2, DURING)).not.toBeNull();
    expect(all("select total_changes() as n")[0].n).toBe(before);
    expect(groupsOf(2)).toEqual([]);
    expect(h.mails).toEqual([]);
  });
});

describe("permanent partner changes at the round switch (#403, D179)", () => {
  beforeEach(async () => {
    await freshDb();
    // One up, one down: easier to follow than the fast switch.
    h.raw.exec("update leagues set fast_switches = 0");
    for (const id of ["q", "r"])
      h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, 'kezdo', 1)").run(id, `${id}@x.hu`, `Játékos ${id.toUpperCase()}`);
  });

  // A final change of `pair`: its A player stays, B leaves, `partner` comes.
  const finalChange = (pair: number, partner: string, startsPhase: number | null = 2) =>
    h.raw
      .prepare(
        "insert into partner_changes (league_id, season_id, pair_id, started_by, leaving_id, partner_id, status, starts_phase, answered_at, created_at) values (1, 1, ?, ?, ?, ?, 'final', ?, ?, ?)",
      )
      .run(pair, `p${pair}a`, `p${pair}b`, partner, startsPhase, sec("2026-11-20T10:00:00Z") + pair, sec("2026-11-19T10:00:00Z"));

  it("an old pair that won its group: the new pair starts one group higher, in the winner's spot", async () => {
    finishAll();
    finalChange(5, "q");
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    // Without the change: [[1, 2, 3, 5], [4, 6, 7, 8]]; pair 5's row stands for the new pair.
    expect(ids(s.draft)[0]).toContain(5);
    const placed = s.draft[0]!.find((p) => p.pairId === 5)!;
    expect(placed.players.map((p) => p.id)).toEqual(["p5a", "q"]);
    // Rated as any pair: 5A (haladó, 1400) and Q (kezdő, 1000).
    expect(placed.averageElo).toBe(1200);
    expect(s.origins.get(5)).toEqual({ kind: "continuing", group: 2, place: 1 });
    expect(s.changes.get(5)).toEqual({ leaving: "Játékos 5B", partner: "Játékos Q" });
    expect(s.leaving).toEqual([]);
  });

  it("the leaving player opted out (#395): the new pair still keeps the spot, not listed as leaving", async () => {
    finishAll();
    finalChange(5, "q");
    h.raw.exec("update season_entries set opt_out_phase = 1, opted_out_by = 'p5b' where pair_id = 5");
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(ids(s.draft)[0]).toContain(5);
    expect(s.changes.get(5)).toEqual({ leaving: "Játékos 5B", partner: "Játékos Q" });
    expect(s.leaving).toEqual([]);
    // Without the change it would leave as "Nem folytatja".
    h.raw.exec("update partner_changes set status = 'undone'");
    expect((await R.roundSwitch(1, 2, AFTER))!.leaving.map((l) => [l.pair.pairId, l.reason])).toEqual([[5, "opted_out"]]);
  });

  it("the staying player opted out (#395): the pair leaves as \"Nem folytatja\", the change doesn't start and its players are told", async () => {
    finishAll();
    finalChange(5, "q");
    h.raw.exec("update season_entries set opt_out_phase = 1, opted_out_by = 'p5a' where pair_id = 5");
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.leaving.map((l) => [l.pair.pairId, l.reason])).toEqual([[5, "opted_out"]]);
    expect(s.draft.flat().map((p) => p.pairId)).not.toContain(5);
    expect(s.changes.size).toBe(0);
    // At the publish the change ends: the old pair is no longer in the draft.
    expect(await R.generateRoundSwitchDraft(1, 2, "o", AFTER)).toEqual({ ok: true });
    expect(await R.publishRoundSwitch(1, 2, "o", AFTER)).toEqual({ ok: true });
    expect(all("select status from partner_changes")).toEqual([{ status: "undone" }]);
    expect(all("select user_id from notifications where kind = 'partner_change' order by user_id").map((n: { user_id: string }) => n.user_id)).toEqual(["p5a", "p5b", "q"]);
    expect(all("select count(*) n from pairs where status = 'active' and player_b = 'q'")[0].n).toBe(0);
  });

  it("an old pair that finished last: the new pair starts one group lower", async () => {
    finishAll();
    finalChange(4, "q");
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(ids(s.draft)[1]).toContain(4);
    expect(s.origins.get(4)).toEqual({ kind: "continuing", group: 1, place: 4 });
    // Pair 4's row stands for the new pair: its players and its rating (4A haladó 1400, Q kezdő 1000).
    const placed = s.draft[1]!.find((p) => p.pairId === 4)!;
    expect(placed.players.map((p) => p.id)).toEqual(["p4a", "q"]);
    expect(placed.averageElo).toBe(1200);
    expect(s.changes.get(4)).toEqual({ leaving: "Játékos 4B", partner: "Játékos Q" });
  });

  it("two pairs of a group change partners: both keep their spots", async () => {
    finishAll();
    finalChange(1, "q");
    finalChange(4, "r");
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(ids(s.draft)[0]).toContain(1);
    expect(ids(s.draft)[1]).toContain(4);
    expect([...s.changes.keys()].sort()).toEqual([1, 4]);
  });

  it("an old pair that leaves by a 3rd strike: the new pair is placed by the new-pair rules", async () => {
    finishAll();
    finalChange(1, "q");
    for (let i = 0; i < 3; i++)
      h.raw.prepare("insert into strikes (season_id, user_id, pair_id, source, at) values (1, 'p1b', 1, 'deadline', ?)").run(sec("2026-11-30T05:00:00Z"));
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.leaving.map((l) => [l.pair.pairId, l.reason])).toEqual([[1, "strikes"]]);
    expect(s.origins.get(1)).toEqual({ kind: "new" });
    expect(s.newPairs.map((n) => [n.pair.pairId, n.rating])).toEqual([[1, 1300]]);
    // 1A (versenyző, 1600) and Q (kezdő, 1000): 1300, placed by D107f, not in a winner's spot.
    expect(ids(s.draft)[0]).not.toContain(1);
  });

  it("the preview and the real draft put the new pair in the same spot", async () => {
    finishAll();
    finalChange(5, "q");
    const preview = (await R.roundSwitchPreview(1, 2, DURING))!;
    const real = (await R.roundSwitch(1, 2, AFTER))!;
    expect(ids(preview.draft)).toEqual(ids(real.draft));
    expect(preview.changes.get(5)).toEqual({ leaving: "Játékos 5B", partner: "Játékos Q" });
  });

  it("publishing starts the new pair: the old pair is dissolved, the new one plays the round's matches", async () => {
    finishAll();
    finalChange(5, "q");
    expect(await R.generateRoundSwitchDraft(1, 2, "o", AFTER)).toEqual({ ok: true });
    expect(groupsOf(2)[0]).toContain(5);
    expect(await R.publishRoundSwitch(1, 2, "o", AFTER)).toEqual({ ok: true });
    const fresh = all("select id, player_a, player_b, source from pairs where status = 'active' and player_b = 'q'")[0];
    expect(fresh).toMatchObject({ player_a: "p5a", source: "change" });
    expect(all("select status from pairs where id = 5")[0].status).toBe("dissolved");
    expect(groupsOf(2)[0]).toContain(fresh.id);
    expect(groupsOf(2).flat()).not.toContain(5);
    expect(all("select count(*) n from matches m join groups g on g.id = m.group_id where g.phase = 2 and ? in (m.pair_a, m.pair_b)", fresh.id)[0].n).toBe(3);
    expect(all("select status, joins_phase from season_entries where pair_id = ?", fresh.id)).toEqual([{ status: "approved", joins_phase: 2 }]);
    // Round 1's results stay with the old pair.
    expect(all("select count(*) n from matches m join groups g on g.id = m.group_id where g.phase = 1 and 5 in (m.pair_a, m.pair_b)")[0].n).toBe(3);
    expect(all("select status, new_pair_id from partner_changes")).toEqual([{ status: "started", new_pair_id: fresh.id }]);
    expect(all("select actor_id, detail from audit_log where action = 'partner_change.start'")).toEqual([
      { actor_id: "o", detail: `pair:5 -> pair:${fresh.id}; phase 2` },
    ]);
    // The new pair's players got the new-phase emails.
    expect(h.mails.map((m) => m.toEmail)).toContain("q@x.hu");
  });

  it("a change made after this draft: the new partner plays the old pair's new matches too", async () => {
    finishAll();
    expect(await R.generateRoundSwitchDraft(1, 2, "o", AFTER)).toEqual({ ok: true });
    finalChange(5, "q", 3);
    expect(await R.publishRoundSwitch(1, 2, "o", AFTER)).toEqual({ ok: true });
    expect(all("select status from pairs where id = 5")[0].status).toBe("active");
    const marked = all("select m.id, a.absent_id, a.partner_change_id from match_absences a join matches m on m.id = a.match_id join groups g on g.id = m.group_id where g.phase = 2");
    expect(marked).toHaveLength(3);
    expect(marked.every((m: { absent_id: string; partner_change_id: number }) => m.absent_id === "p5b" && m.partner_change_id === 1)).toBe(true);
  });
});
