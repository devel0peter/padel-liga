// Withdrawing a pair mid-phase (#34, D87) on a real SQLite with every
// migration applied (~/test/sqlite): the write itself, and every reader of
// groups, matches and tables ignoring the withdrawn pair's matches. Email is
// stubbed; nothing here sends any.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

// No VAPID keys: notifications are stored, not pushed.
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({ listedCities: async () => [{ slug: "gyor" }] }));
vi.mock("~/lib/email/outbox.server", () => ({
  queueSeasonEntered: async (...args: any[]) => h.mails.push(args),
  queueGroupsPublished: async (...args: any[]) => h.mails.push(args),
  queueSeasonEntryDecision: async (...args: any[]) => h.mails.push(args),
  queueMatchEmails: async (messages: any[]) => h.mails.push(...messages),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const E = await import("~/lib/season-entries.server");
const G = await import("~/lib/groups.server");
const M = await import("~/lib/matches.server");
const R = await import("~/lib/results.server");
const D = await import("~/lib/decisions.server");
const O = await import("~/lib/match-overview.server");
const L = await import("~/lib/ladder.server");
const P = await import("~/lib/pairs.server");
const A = await import("~/lib/account-deletion.server");
const S = await import("~/lib/seasons.server");
const { IN_RUNNING_PHASE, NOT_IN_RUNNING_PHASE, TAKEN_OUT_TEXT } = await import("~/lib/season-entries");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (iso: string) => new Date(iso);
// Starts as ranges one match long (D144): the start is the only choice.
const hour = (starts: Date[]) => starts.map((s) => ({ start: s, end: new Date(s.getTime() + 3_600_000) }));

// Phases from Monday 9 Nov 2026 (Budapest, UTC+1).
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const DEADLINE_1 = sec(PHASES[0]!) + 21 * 86400 - 60;
const NOW = at("2026-11-20T12:00:00Z"); // week 2 of phase 1
const ORG = { id: "o" };
const REASON = "Sérülés, a kör végéig nem tudnak játszani.";

const S40 = { sets: [[4, 0], [4, 0]] };
const S41 = { sets: [[4, 1], [4, 1]] };
const S21 = { sets: [[4, 2], [2, 4]], superTieBreak: [10, 8] };
const played = (score: object) => JSON.stringify({ kind: "played", score });

// Pairs 1-4 in group 1 of phase 1 (seed order), pair 5 entered but in no
// group. Pair 4 (Gábor + Hanna) is the one withdrawn: it has a final match
// (m2), a result waiting 3 days (m4) and an open one (m6). Matches among
// 1-3 make a three-way tie on points that pair 4's results would break.
function freshDb({ withPair4 = true } = {}) {
  h.raw = migratedDatabase();
  h.mails = [];
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  for (const id of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "o"])
    h.raw
      .prepare("insert into users (id, email, name, phone, level, consent_at) values (?, ?, ?, '+36301234567', 'halado', 1)")
      .run(id, `${id}@x.hu`, `Játékos ${id.toUpperCase()}`);
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values
    (1, 1, 'a', 'b'), (2, 1, 'c', 'd'), (3, 1, 'e', 'f'), (4, 1, 'g', 'h'), (5, 1, 'i', 'j')`);
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
  const pairIds = withPair4 ? [1, 2, 3, 4, 5] : [1, 2, 3, 5];
  for (const p of pairIds)
    h.raw
      .prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, 'approved', 1, ?)")
      .run(p, sec("2026-11-03T10:00:00Z"));
  h.raw.prepare("insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, ?)").run(sec("2026-11-06T10:00:00Z"));
  (withPair4 ? [1, 2, 3, 4] : [1, 2, 3]).forEach((p, i) =>
    h.raw.prepare("insert into group_pairs (group_id, pair_id, seed) values (1, ?, ?)").run(p, i + 1),
  );
  const match = (id: number, a: number, b: number, week: number, status = "open", outcome: string | null = null) =>
    h.raw
      .prepare("insert into matches (id, group_id, pair_a, pair_b, week, deadline, status, outcome) values (?, 1, ?, ?, ?, ?, ?, ?)")
      .run(id, a, b, week, DEADLINE_1, status, outcome);
  // A three-way tie on points among 1-3: each wins once.
  match(1, 1, 2, 1, "final", played(S40));
  match(3, 3, 1, 2, "final", played(S21)); // 3 beat 1
  match(5, 2, 3, 3, "final", played(S41)); // 2 beat 3
  if (withPair4) {
    match(2, 4, 3, 1, "final", played(S40)); // 4 beat 3
    match(4, 1, 4, 2, "result_pending");
    match(6, 2, 4, 3);
    // Pair 1 recorded m4 three days ago: due for the 48-hour auto-accept.
    h.raw
      .prepare("insert into match_events (match_id, pair_id, user_id, kind, score, at) values (4, 1, 'a', 'result_recorded', ?, ?)")
      .run(JSON.stringify(S41), sec("2026-11-17T12:00:00Z"));
  }
}

beforeEach(() => freshDb());

const withdraw = (reason = REASON, now = NOW) => E.withdrawPairMidPhase(ORG, 1, 4, 1, reason, now);
const row = (sql: string, ...args: unknown[]) => h.raw.prepare(sql).get(...args);
const rows = (sql: string, ...args: unknown[]) => h.raw.prepare(sql).all(...args);

describe("withdrawPairMidPhase", () => {
  it("needs a reason, at most 300 characters", async () => {
    expect(await withdraw("  ")).toEqual({ ok: false, error: expect.stringMatching(/miért/) });
    expect(await withdraw("x".repeat(301))).toEqual({ ok: false, error: expect.stringMatching(/300/) });
    expect(row("select withdrawn_at from group_pairs where pair_id = 4").withdrawn_at).toBeNull();
  });

  it("words the refusal without a running round", () => {
    expect(NOT_IN_RUNNING_PHASE).toBe("Ez a pár most nem játszik kihirdetett csoportban. Frissítsd az oldalt.");
    expect(NOT_IN_RUNNING_PHASE).not.toMatch(/futó kör/);
  });

  it("refuses a pair that plays in no running group, and one of another league or season", async () => {
    expect(await E.withdrawPairMidPhase(ORG, 1, 5, 1, REASON, NOW)).toEqual({ ok: false, error: NOT_IN_RUNNING_PHASE });
    expect(await E.withdrawPairMidPhase(ORG, 2, 4, 1, REASON, NOW)).toMatchObject({ ok: false });
    // After the phase's deadline the round is over: nothing to withdraw from.
    expect(await withdraw(REASON, at("2026-11-30T12:00:00Z"))).toEqual({ ok: false, error: NOT_IN_RUNNING_PHASE });
  });

  it("withdraws the pair from its group and the season, and bumps only its matches' revision", async () => {
    expect(await withdraw()).toEqual({ ok: true });
    expect(row("select withdrawn_at, withdrawal_reason from group_pairs where pair_id = 4")).toEqual({
      withdrawn_at: sec(NOW.toISOString()),
      withdrawal_reason: REASON,
    });
    expect(row("select status, decided_by from season_entries where pair_id = 4")).toEqual({ status: "withdrawn", decided_by: "o" });
    expect(rows("select id, revision from matches order by id")).toEqual([
      { id: 1, revision: 0 },
      { id: 2, revision: 1 },
      { id: 3, revision: 0 },
      { id: 4, revision: 1 },
      { id: 5, revision: 0 },
      { id: 6, revision: 1 },
    ]);
    expect(row("select action, target from audit_log where action = 'season_entry.withdraw'")).toEqual({
      action: "season_entry.withdraw",
      target: "pair:4",
    });
    // The other pairs stay where they were.
    expect(rows("select pair_id from group_pairs where withdrawn_at is null order by pair_id")).toEqual([
      { pair_id: 1 },
      { pair_id: 2 },
      { pair_id: 3 },
    ]);
  });

  it("tells the pair (with the reason) and the group's other pairs (without it) in the app only", async () => {
    await withdraw();
    const sent = rows("select user_id, kind, title, body, url from notifications order by user_id");
    expect(sent.map((n: any) => n.user_id)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(new Set(sent.map((n: any) => n.kind))).toEqual(new Set(["pair_withdrawn"]));
    const own = sent.filter((n: any) => n.user_id === "g" || n.user_id === "h");
    const others = sent.filter((n: any) => n.user_id !== "g" && n.user_id !== "h");
    for (const n of own) expect(n.body).toContain(REASON);
    for (const n of others) {
      expect(n.body).not.toContain(REASON);
      expect(n.body).not.toContain("Játékos");
    }
    expect(h.mails).toEqual([]);
  });

  it("a second click changes nothing", async () => {
    await withdraw();
    expect(await withdraw()).toEqual({ ok: false, error: NOT_IN_RUNNING_PHASE });
    expect(rows("select id from notifications")).toHaveLength(8);
  });

  it("after it the pair can be entered again, and joins at the next phase", async () => {
    await withdraw();
    expect(await E.enterPairByOrganizer(ORG, 1, 4, 1, NOW)).toEqual({
      ok: true,
      joins: { phase: 2, startsAt: at(PHASES[1]!) },
    });
    // Still out of phase 1's group: entering again doesn't bring it back.
    expect(row("select withdrawn_at from group_pairs where pair_id = 4").withdrawn_at).not.toBeNull();
  });

  it("the plain take-out still refuses a pair in the running round", async () => {
    expect(await E.removePairFromSeason(ORG, 1, 4, 1, NOW)).toEqual({ ok: false, error: IN_RUNNING_PHASE });
  });
});

describe("the withdrawn pair's matches, for every reader (#34)", () => {
  it("public table: equal to one where the pair never played", async () => {
    await withdraw();
    const page = await L.ladderPage("gyor", NOW);
    freshDb({ withPair4: false });
    const never = await L.ladderPage("gyor", NOW);
    if (page?.kind !== "ladder" || never?.kind !== "ladder") throw new Error("no ladder");
    const group = page.bands[0]!.groups[0]!;
    const without = never.bands[0]!.groups[0]!;
    expect(group.rows).toEqual(without.rows);
    expect(group.rows.map((r) => r.points)).toEqual([4, 4, 4]);
    expect(group.weeks).toEqual(without.weeks);
    expect(group.withdrawn).toEqual([["Játékos G", "Játékos H"]]);
    expect(without.withdrawn).toEqual([]);
  });

  it("running-group checks: the pair is free (dissolve, account deletion), its history stays", async () => {
    expect(await G.pairInRunningGroup(4, NOW)).toBe(true);
    await withdraw();
    expect(await G.pairInRunningGroup(4, NOW)).toBe(false);
    expect(await G.pairInRunningGroup(1, NOW)).toBe(true);
    const list = await P.leaguePairs(1, NOW);
    const locked = new Map(list.map((p) => [p.id, p.locked]));
    expect([locked.get(1), locked.get(4)]).toEqual([true, false]);
    // By season: Párok offers the withdrawal only for the season it plays in.
    expect(list.find((p) => p.id === 1)?.lockedIn).toEqual([1]);
    expect(list.find((p) => p.id === 4)?.lockedIn).toEqual([]);
    const facts = await A.deletionFacts(NOW);
    expect(facts.playing.has("g")).toBe(false);
    expect(facts.playing.has("a")).toBe(true);
    expect(facts.history.has("g")).toBe(true);
  });

  it("Kezdőlap: the pair has no group; the others see it marked and the match off", async () => {
    await withdraw();
    expect(await M.currentGroups("g", NOW)).toEqual([]);
    const [mine] = await M.currentGroups("a", NOW);
    // The group card's table (#201) leaves the pair and all its matches out,
    // as if it never played, and names it below.
    expect(mine!.pairs.map((p) => p.pairId)).not.toContain(4);
    expect(mine!.withdrawn).toEqual(["Játékos G – Játékos H"]);
    expect(mine!.matches.map((m) => m.id)).toEqual([1, 3]);
    const table = mine!.pairs.map(({ name: _, mine: __, ...r }) => r);
    freshDb({ withPair4: false });
    const [never] = await M.currentGroups("a", NOW);
    expect(table).toEqual(never!.pairs.map(({ name: _, mine: __, ...r }) => r));
    expect(table.map((r) => r.points)).toEqual([4, 4, 4]);
    expect(never!.withdrawn).toEqual([]);
  });

  it("reminders: the pair's matches are not running any more", async () => {
    expect((await M.runningMatches(NOW)).map((m) => m.id)).toContain(6);
    await withdraw();
    expect((await M.runningMatches(NOW)).map((m) => m.id)).toEqual([1, 3, 5]);
  });

  it("match page and steps: off for both pairs, no scheduling or result step", async () => {
    await withdraw();
    const page = await M.matchPage(6, "c", NOW);
    expect(page?.voided).toBe("Játékos G – Játékos H visszalépett a körből: ez a meccs elmarad, és nem számít a tabellában.");
    expect(page?.actions.propose).toBe(false);
    expect(page?.resultActions).toEqual({ record: false, confirm: false, dispute: false });
    expect((await M.matchPage(6, "g", NOW))?.voided).toMatch(/^Visszaléptetek/);
    expect((await M.matchPage(1, "a", NOW))?.voided).toBeNull();
    expect(await M.matchStep("c", 6, { kind: "propose", ranges: hour([at("2026-11-27T17:00:00Z")]), clubId: null }, NOW)).toEqual({
      ok: false,
      error: M.VOIDED,
    });
    expect(await R.resultStep("c", 6, { kind: "record", score: S40 } as any, NOW)).toEqual({ ok: false, error: M.VOIDED });
    expect(await R.resultStep("g", 4, { kind: "confirm" } as any, NOW)).toEqual({ ok: false, error: M.VOIDED });
  });

  it("match page: no phone numbers either way, they are no opponents any more", async () => {
    expect((await M.matchPage(6, "c", NOW))?.contacts).toHaveLength(2);
    await withdraw();
    expect((await M.matchPage(6, "c", NOW))?.contacts).toEqual([]);
    expect((await M.matchPage(6, "g", NOW))?.contacts).toEqual([]);
    expect((await M.matchPage(1, "a", NOW))?.contacts).toHaveLength(2);
  });

  it("anonymizing a withdrawn player's account takes the reason off the group row and the partner's notice", async () => {
    await withdraw();
    // A notice of another withdrawal with a reason, not about this pair, stays.
    h.raw
      .prepare("insert into notifications (user_id, kind, title, body, url) values ('h', 'pair_withdrawn', 'x', 'Más. Indok: Költözés', '/profile#parod')")
      .run();
    // Another pair withdrawn with the same reason: its player's notice stays.
    h.raw
      .prepare("insert into notifications (user_id, kind, title, body, url) values ('i', 'pair_withdrawn', 'x', ?, '/profile#parod')")
      .run(`Más pár. Indok: ${REASON}`);
    expect(await A.deleteAccount("o", "g", NOW)).toEqual({ ok: true, mode: "anonymize" });
    expect(row("select withdrawn_at is not null as w, withdrawal_reason from group_pairs where pair_id = 4")).toEqual({
      w: 1,
      withdrawal_reason: null,
    });
    const partner = rows("select body from notifications where user_id = 'h' and kind = 'pair_withdrawn' order by id").map((n: any) => n.body);
    expect(partner[0]).not.toContain(REASON);
    expect(partner[0]).toMatch(/szóljatok a szervezőnek\.$/);
    expect(partner[1]).toBe("Más. Indok: Költözés");
    expect(rows("select id from notifications where user_id = 'g'")).toEqual([]);
    expect(row("select body from notifications where user_id = 'i'").body).toBe(`Más pár. Indok: ${REASON}`);
    // The other pairs' notices had no reason and are untouched.
    expect(rows("select body from notifications where user_id = 'a'")[0].body).toContain("A csoport nélkülük folytatja.");
  });

  it("auto-accept leaves the pair's waiting result alone", async () => {
    await withdraw();
    expect(await R.autoAcceptResults(NOW)).toBe(0);
    expect(row("select status from matches where id = 4").status).toBe("result_pending");
  });

  it("without the withdrawal the same result is accepted (the fixture is due)", async () => {
    expect(await R.autoAcceptResults(NOW)).toBe(1);
  });

  it("organizer pages: out of the running overview, marked in the list, nothing to decide", async () => {
    await withdraw();
    const [phase] = await O.runningPhases(1, NOW);
    expect(phase!.matches.map((m) => m.id)).toEqual([1, 3, 5]);
    expect(await O.organizerMatch(1, 6, NOW)).toMatchObject({ label: "Nem számít: visszalépés", stuck: null });
    const list = await D.leagueMatches(1);
    expect(list.matches.filter((m) => m.voided).map((m) => m.id)).toEqual([2, 4, 6]);
    expect(list.matches.find((m) => m.id === 2)?.label).toBe("Nem számít: visszalépés");
    expect((await D.decisionPage(1, 6))?.voided).toBe(true);
    expect(await D.decideMatch("o", 1, 6, { kind: "unplayed" }, "Teszt", NOW)).toEqual({ ok: false, error: M.VOIDED });
  });

  it("the season groups page marks the pair", async () => {
    await withdraw();
    const [group] = await G.phaseGroups(1);
    expect(group!.pairs.map((p) => [p.pairId, p.withdrawn])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, true],
    ]);
  });

  it("Párod: both players read that the organizer took them out, with no Nevezünk button", async () => {
    await withdraw();
    const seasons = await S.listSeasons(1);
    for (const id of ["g", "h"]) {
      const view = (await E.entryViews({ id, email: `${id}@x.hu`, name: id, level: "halado" } as any, seasons, NOW)).get(1);
      expect(view).toEqual({ kind: "status", status: "withdrawn", text: TAKEN_OUT_TEXT, note: null });
    }
  });
});
