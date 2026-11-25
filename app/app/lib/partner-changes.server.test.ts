// Permanent partner change (#402, spec 4, D178) on a real SQLite with every
// migration applied (~/test/sqlite): starting, withdrawing, declining,
// accepting (final, or at once for a pair that hasn't played), the leaving
// player marked absent on the remaining matches (#400), the lapse after 7
// days, the organizer's undo, and the audit entries. Email is captured,
// never sent; in-app notices are read from the table.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueGroupsPublished: async () => {},
  queueStrikeWarnings: async () => {},
  queuePartnerChangeEmail: async (toEmail: string, input: any) => h.mails.push({ toEmail, ...input }),
  dailyLimit: () => 100,
  suppressedSet: async () => new Set(),
  emailSwitchedOff: async () => new Set(),
  stuckReminderInserts: () => [],
}));

const { migratedDatabase } = await import("~/test/sqlite");
const P = await import("~/lib/partner-changes.server");
const G = await import("~/lib/groups.server");
const { PARTNER_CHANGE_REFUSALS } = await import("~/lib/partner-changes");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (iso: string) => new Date(iso);

// Rounds from Monday 9 Nov 2026 (Budapest), 3 weeks each.
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const BEFORE = at("2026-11-07T10:00:00Z");
const DURING = at("2026-11-10T10:00:00Z");
const LAST_DEADLINE = sec(PHASES[3]!) + 21 * 86400 - 60;

const one = (q: string, ...p: unknown[]) => h.raw.prepare(q).get(...p);
const all = (q: string, ...p: unknown[]) => h.raw.prepare(q).all(...p) as any[];
const notices = (kind: string) => all("select user_id, title, body from notifications where kind = ? order by user_id", kind);
const audits = (action: string) => all("select actor_id, target, detail, league_id from audit_log where action = ? order by id", action);
const marks = () => all("select match_id, pair_id, absent_id, marked_by, partner_change_id from match_absences order by match_id");
const change = (id = 1) => one("select * from partner_changes where id = ?", id);

// League 1, season 1: pairs 1 (a1–b1) … 4 (a4–b4) in one published group of
// round 1 with its 6 matches; q and r are registered players of the league
// without a pair, w plays in league 2 only.
async function world() {
  h.raw = migratedDatabase();
  h.mails = [];
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'gyor', 'gyor2', 'Győr 2')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, 'Tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  PHASES.forEach((start, i) =>
    h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline, set_games) values (1, ?, ?, ?, 6)").run(i + 1, sec(start), sec(start) + 21 * 86400 - 60),
  );
  for (const id of ["a1", "b1", "a2", "b2", "a3", "b3", "a4", "b4", "q", "r", "w", "o"])
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, 'halado', 1)").run(id, `${id}@x.hu`, `Játékos ${id.toUpperCase()}`);
  h.raw.exec(`insert into league_members (league_id, user_id, source) select 1, id, 'register' from users where id <> 'w'`);
  h.raw.exec(`insert into league_members (league_id, user_id, source) values (2, 'w', 'register')`);
  h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'o')`);
  for (let i = 1; i <= 4; i++) {
    h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)").run(i, `a${i}`, `b${i}`);
    h.raw.prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, 'approved', 1, ?)").run(i, sec("2026-11-03T10:00:00Z") + i);
  }
  expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
  expect(await G.publishGroups(1, "o", BEFORE)).toEqual({ ok: true });
}

const matchesOf = (pairId: number) => all("select id from matches where pair_a = ? or pair_b = ? order by id", pairId, pairId).map((m) => m.id as number);

// The new partner accepts and the Szervező approves (#416): the change is final.
async function final(now = DURING, id = 1) {
  expect(await P.acceptPartnerChange({ id: "q" }, id, now)).toMatchObject({ ok: true });
  return P.approvePartnerChange("o", 1, id, now);
}

describe("starting, withdrawing and declining (#402 req 1-3)", () => {
  beforeEach(world);

  it("a player of an entered pair names a free player; the new partner gets one in-app notice and one email", async () => {
    expect(await P.startPartnerChange({ id: "a1" }, 1, "q", DURING)).toMatchObject({ ok: true });
    expect(change()).toMatchObject({ pair_id: 1, started_by: "a1", leaving_id: "b1", partner_id: "q", status: "open" });
    expect(notices("partner_change").map((n) => n.user_id)).toEqual(["q"]);
    expect(h.mails).toEqual([expect.objectContaining({ toEmail: "q@x.hu", kind: "asked", starter: "Játékos A1", leaving: "Játékos B1" })]);
    expect(audits("partner_change.request")).toEqual([{ actor_id: "a1", target: "partner_change:1", detail: "pair:1; user:b1 -> user:q", league_id: 1 }]);
  });

  it("either player may start it: the one who starts stays", async () => {
    expect(await P.startPartnerChange({ id: "b1" }, 1, "q", DURING)).toMatchObject({ ok: true });
    expect(change()).toMatchObject({ started_by: "b1", leaving_id: "a1" });
  });

  it("refuses a second change for the same pair while one is open, from either player", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    expect(await P.startPartnerChange({ id: "b1" }, 1, "r", DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.already });
  });

  it("can't pick a player who has an active pair, the partner, or someone outside the league; the picker lists names only", async () => {
    for (const partner of ["a2", "b1", "w", "nobody"])
      expect(await P.startPartnerChange({ id: "a1" }, 1, partner, DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.partner });
    expect(await P.partnerCandidates(1, ["a1", "b1"])).toEqual([
      { id: "o", name: "Játékos O" },
      { id: "q", name: "Játékos Q" },
      { id: "r", name: "Játékos R" },
    ]);
  });

  it("needs a pair with an entry that counts, and the season not over", async () => {
    expect(await P.startPartnerChange({ id: "q" }, 1, "r", DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.no_pair });
    h.raw.exec("update season_entries set status = 'withdrawn' where pair_id = 1");
    expect(await P.startPartnerChange({ id: "a1" }, 1, "q", DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.no_pair });
    h.raw.exec("update season_entries set status = 'approved' where pair_id = 1");
    expect(await P.startPartnerChange({ id: "a1" }, 1, "q", new Date((LAST_DEADLINE + 60) * 1000))).toMatchObject({ ok: false });
  });

  it("only the one who sent it withdraws it, while it waits; the new partner is told", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    expect(await P.withdrawPartnerChange({ id: "b1" }, 1, DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.not_yours });
    expect(await P.withdrawPartnerChange({ id: "a1" }, 1, DURING)).toMatchObject({ ok: true });
    expect(change().status).toBe("withdrawn");
    expect(audits("partner_change.withdraw")).toHaveLength(1);
    expect(await P.acceptPartnerChange({ id: "q" }, 1, DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.not_open });
  });

  it("the new partner declines: the starter is told, the pair stays, a new change can start", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    expect(await P.declinePartnerChange({ id: "a1" }, 1, DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.not_yours });
    expect(await P.declinePartnerChange({ id: "q" }, 1, DURING)).toMatchObject({ ok: true });
    expect(change().status).toBe("declined");
    expect(audits("partner_change.decline")).toHaveLength(1);
    expect(notices("partner_change").map((n) => n.user_id)).toEqual(["a1", "q"]);
    expect(await P.startPartnerChange({ id: "a1" }, 1, "r", DURING)).toMatchObject({ ok: true });
  });

  it("an unanswered change lapses after 7 days: it can't be accepted, and the pair can start another", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    const later = new Date(DURING.getTime() + 7 * 86_400_000);
    expect(await P.acceptPartnerChange({ id: "q" }, 1, later)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.not_open });
    expect(await P.startPartnerChange({ id: "a1" }, 1, "r", later)).toMatchObject({ ok: true });
    expect(change(1).status).toBe("lapsed");
    expect(change(2).status).toBe("open");
  });
});

describe("accepting in a running round (#402 req 5-7)", () => {
  beforeEach(world);

  it("accepted, it waits for the Szervező: both see \"Jóváhagyásra vár\", nothing is marked, the organizers are told (#416)", async () => {
    h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'o')`.replace("insert", "insert or ignore"));
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    h.mails = [];
    expect(await P.acceptPartnerChange({ id: "q" }, 1, DURING)).toMatchObject({ ok: true });
    expect(change()).toMatchObject({ status: "accepted", starts_phase: null });
    expect(marks()).toEqual([]);
    const { getSeason } = await import("~/lib/seasons.server");
    const season = (await getSeason(1))!;
    expect((await P.partnerChangeView("a1", 1, season, DURING))!.items[0]!.text).toMatch(/^Jóváhagyásra vár/);
    expect((await P.partnerChangeView("q", 1, season, DURING))!.items[0]!.text).toMatch(/^Jóváhagyásra vár/);
    // The organizers: one in-app notice each, their own kind; no email at all.
    expect(notices("partner_change_waiting").map((n) => n.user_id)).toEqual(["o"]);
    expect(h.mails).toEqual([]);
    expect(audits("partner_change.accept")).toEqual([{ actor_id: "q", target: "partner_change:1", detail: "pair:1", league_id: 1 }]);
    // The new partner is taken while it waits.
    const PAIRS = await import("~/lib/pairs.server");
    expect(await PAIRS.createPair("o", 1, "q", "r")).toMatchObject({ ok: false });
  });

  it("the Szervező's approval makes it final: the leaving player is marked absent on every remaining match, the new partner named; notices and email", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    h.mails = [];
    // One match of pair 1 already has a result: it keeps who played.
    const [played, ...rest] = matchesOf(1);
    h.raw.prepare("update matches set status = 'final', outcome = ? where id = ?").run(JSON.stringify({ kind: "played", score: { sets: [[6, 1], [6, 2]] } }), played);
    h.raw.exec("delete from notifications");
    expect(await P.acceptPartnerChange({ id: "q" }, 1, DURING)).toMatchObject({ ok: true });
    expect(await P.approvePartnerChange("o", 2, 1, DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.not_waiting });
    expect(await P.approvePartnerChange("o", 1, 1, DURING)).toMatchObject({ ok: true });
    expect(change()).toMatchObject({ status: "final", starts_phase: 2, decided_by: "o" });
    expect(marks()).toEqual(rest.map((m) => ({ match_id: m, pair_id: 1, absent_id: "b1", marked_by: "q", partner_change_id: 1 })));
    // The starter (accepted, then final), the leaving player and the new partner in the app; only the leaving player by email.
    expect(notices("partner_change").map((n) => n.user_id)).toEqual(["a1", "a1", "b1", "q"]);
    expect(h.mails).toEqual([expect.objectContaining({ toEmail: "b1@x.hu", kind: "final", partner: "Játékos Q", staying: "Játékos A1", from: 2 })]);
    const opponents = notices("absence_marked");
    expect(opponents.length).toBe(rest.length * 2);
    expect(opponents.every((n) => n.body.includes("Játékos Q"))).toBe(true);
    expect(audits("partner_change.approve")).toEqual([{ actor_id: "o", target: "partner_change:1", detail: "pair:1; starts phase 2", league_id: 1 }]);
    // Decided once.
    expect(await P.approvePartnerChange("o", 1, 1, DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.not_waiting });
  });

  it("the Szervező's rejection ends it: the three get the reason in the app, no email, the old pair stays (#416)", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await P.acceptPartnerChange({ id: "q" }, 1, DURING);
    h.mails = [];
    h.raw.exec("delete from notifications");
    expect(await P.rejectPartnerChange("o", 1, 1, "x".repeat(301), DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.reason });
    expect(await P.rejectPartnerChange("o", 1, 1, " Túl sok csere. ", DURING)).toMatchObject({ ok: true });
    expect(change()).toMatchObject({ status: "rejected", reason: "Túl sok csere.", decided_by: "o" });
    const told = notices("partner_change");
    expect(told.map((n) => n.user_id)).toEqual(["a1", "b1", "q"]);
    expect(told.every((n) => n.body.includes("Indoklás: Túl sok csere."))).toBe(true);
    expect(h.mails).toEqual([]);
    expect(marks()).toEqual([]);
    expect(one("select status from pairs where id = 1").status).toBe("active");
    expect(audits("partner_change.reject")).toEqual([{ actor_id: "o", target: "partner_change:1", detail: "pair:1", league_id: 1 }]);
    // Free again, and the pair can ask again.
    expect(await P.startPartnerChange({ id: "a1" }, 1, "q", DURING)).toMatchObject({ ok: true });
  });

  it("a waiting change whose old pair is gone ends instead of holding the new partner (review L2)", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await P.acceptPartnerChange({ id: "q" }, 1, DURING);
    h.raw.exec("update pairs set status = 'dissolved' where id = 1");
    h.raw.exec("delete from notifications");
    expect(await P.approvePartnerChange("o", 1, 1, DURING)).toMatchObject({ ok: false });
    expect(change().status).toBe("undone");
    expect(notices("partner_change").map((n) => n.user_id)).toEqual(["a1", "b1", "q"]);
    const PAIRS = await import("~/lib/pairs.server");
    expect(await PAIRS.createPair("o", 1, "q", "r")).toMatchObject({ ok: true });
  });

  it("the publish also ends a waiting change whose old pair is gone", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await P.acceptPartnerChange({ id: "q" }, 1, DURING);
    h.raw.exec("update pairs set status = 'dissolved' where id = 1");
    h.raw.exec(`insert into groups (id, season_id, phase, number) values (61, 1, 2, 1)`);
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (61, 2, 1)`);
    await P.startChangesAtPublish(1, 2, "o", DURING);
    expect(change().status).toBe("undone");
  });

  it("a change still waiting when the round switch draft is made starts at the following switch once approved (#416)", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await P.acceptPartnerChange({ id: "q" }, 1, DURING);
    h.raw.prepare("insert into groups (season_id, phase, number) values (1, 2, 1)").run();
    await P.approvePartnerChange("o", 1, 1, DURING);
    expect(change()).toMatchObject({ status: "final", starts_phase: 3 });
    // Not in round 2's switch.
    expect(await P.switchChanges(1, 2)).toEqual([]);
    expect((await P.switchChanges(1, 3)).map((c) => c.oldPairId)).toEqual([1]);
  });

  it("a new partner who meanwhile got a pair can't accept", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (9, 1, 'q', 'r')`);
    expect(await P.acceptPartnerChange({ id: "q" }, 1, DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.partner });
    expect(marks()).toEqual([]);
  });

  it("a change made after the round switch draft starts at the following switch", async () => {
    h.raw.prepare("insert into groups (season_id, phase, number) values (1, 2, 1)").run();
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    expect(await final()).toMatchObject({ ok: true });
    expect(change().starts_phase).toBe(3);
  });

  it("in the season's last round it starts at the season switch", async () => {
    for (const phase of [2, 3, 4]) h.raw.prepare("insert into groups (season_id, phase, number) values (1, ?, 1)").run(phase);
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    expect(await final()).toMatchObject({ ok: true });
    expect(change().starts_phase).toBeNull();
  });

  it("Ligáim's view tells each of the three their part", async () => {
    const { getSeason } = await import("~/lib/seasons.server");
    const season = (await getSeason(1))!;
    expect((await P.partnerChangeView("a2", 1, season, DURING))?.start?.candidates.map((c) => c.id)).toEqual(["o", "q", "r"]);
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    expect((await P.partnerChangeView("q", 1, season, DURING))!.items).toEqual([expect.objectContaining({ role: "partner", canAnswer: true })]);
    expect((await P.partnerChangeView("a1", 1, season, DURING))!).toMatchObject({ items: [{ role: "staying", canWithdraw: true }], start: null });
    expect((await P.partnerChangeView("b1", 1, season, DURING))!).toMatchObject({ items: [{ role: "leaving", canAnswer: false, canWithdraw: false }], start: null });
    await final();
    expect((await P.partnerChangeView("b1", 1, season, DURING))!.items[0]!.text).toBe("Játékos Q játszik helyetted Játékos A1 mellett. A 2. körtől nincs párod ebben a ligában.");
    // The new partner is no longer offered to another pair.
    expect((await P.partnerChangeView("a2", 1, season, DURING))?.start?.candidates.map((c) => c.id)).toEqual(["o", "r"]);
  });
});

describe("a pair that hasn't played yet (#402 req 6)", () => {
  it("becomes the new pair at once, with the old pair's entry and its row in the draft", async () => {
    await world();
    // Pair 5 entered for round 2; the round 2 draft holds it.
    h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('a5', 'a5@x.hu', 'Játékos A5', 'halado', 1), ('b5', 'b5@x.hu', 'Játékos B5', 'halado', 1)`);
    h.raw.exec(`insert into league_members (league_id, user_id, source) values (1, 'a5', 'register'), (1, 'b5', 'register')`);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (5, 1, 'a5', 'b5')`);
    h.raw.prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, 5, 'approved', 2, ?)").run(sec("2026-11-12T10:00:00Z"));
    h.raw.exec(`insert into groups (id, season_id, phase, number, basis) values (50, 1, 2, 1, '1,2,5|3,4')`);
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (50, 5, 1)`);
    await P.startPartnerChange({ id: "b5" }, 1, "q", DURING);
    expect(await final()).toMatchObject({ ok: true });
    const fresh = one("select id, player_a, player_b, status, source from pairs where status = 'active' and (player_a = 'q' or player_b = 'q')");
    expect(fresh).toMatchObject({ player_a: "q", player_b: "b5", source: "change" });
    expect(one("select status from pairs where id = 5").status).toBe("dissolved");
    expect(one("select status, joins_phase from season_entries where pair_id = ?", fresh.id)).toEqual({ status: "approved", joins_phase: 2 });
    expect(one("select status from season_entries where pair_id = 5").status).toBe("withdrawn");
    expect(one("select pair_id from group_pairs where group_id = 50").pair_id).toBe(fresh.id);
    expect(one("select basis from groups where id = 50").basis).toBe(`1,2,${fresh.id}|3,4`);
    expect(change()).toMatchObject({ status: "started", new_pair_id: fresh.id });
    // Nothing for the organizer to undo; the leaving player is told it holds from now.
    expect(await P.undoPartnerChange("o", 1, 1, DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.not_final });
    expect(h.mails.at(-1)).toMatchObject({ toEmail: "a5@x.hu", kind: "final", from: "now" });
  });
});

describe("the organizer's undo (#402 req 8)", () => {
  beforeEach(world);

  it("revokes the marks on matches not played yet, tells all three, and is audited", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await final();
    const [first] = matchesOf(1);
    // One of them was played meanwhile: its mark stays.
    h.raw.prepare("update matches set status = 'final' where id = ?").run(first);
    h.raw.exec("delete from notifications");
    expect(await P.undoPartnerChange("o", 1, 1, DURING)).toMatchObject({ ok: true });
    expect(change().status).toBe("undone");
    expect(marks().map((m) => m.match_id)).toEqual([first]);
    expect(notices("partner_change").map((n) => n.user_id)).toEqual(["a1", "b1", "q"]);
    expect(audits("partner_change.undo")).toEqual([expect.objectContaining({ actor_id: "o", target: "partner_change:1", league_id: 1 })]);
    // Not twice, and not in another league.
    expect(await P.undoPartnerChange("o", 1, 1, DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.not_final });
  });

  it("can't undo a change of another league", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await final();
    expect(await P.undoPartnerChange("o", 2, 1, DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.not_final });
  });

  it("Párok lists the season's changes with their state", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    expect(await P.leaguePartnerChanges(1, DURING)).toEqual([
      expect.objectContaining({ id: 1, status: "open", staying: "Játékos A1", leaving: "Játékos B1", partner: "Játékos Q", canUndo: false }),
    ]);
    await P.acceptPartnerChange({ id: "q" }, 1, DURING);
    expect(await P.leaguePartnerChanges(1, DURING)).toEqual([
      expect.objectContaining({ status: "accepted", canDecide: true, canUndo: false, counts: { staying: 0, partner: 0 } }),
    ]);
    await P.approvePartnerChange("o", 1, 1, DURING);
    expect(await P.leaguePartnerChanges(1, DURING)).toEqual([
      expect.objectContaining({ status: "final", startsPhase: 2, canUndo: true, canDecide: false, counts: { staying: 1, partner: 1 } }),
    ]);
    // How often a pair played with an absent player this season (#416): pair 1's marked matches.
    expect((await P.pairAbsenceCounts(1, DURING)).get(1)).toBe(marks().length);
    expect((await P.pairAbsenceCounts(1, DURING)).get(2)).toBeUndefined();
  });
});

describe("replaceInBasis", () => {
  it("replaces one id and sorts each group again", () => {
    expect(P.replaceInBasis("1,2,5,6|3,4,7,8", 2, 9)).toBe("1,5,6,9|3,4,7,8");
    expect(P.replaceInBasis("1,2|3", 7, 9)).toBe("1,2|3");
  });
});

describe("Élő-pont and account deletion around a final change", () => {
  beforeEach(world);

  it("the leaving player's Élő-pont doesn't change on a match the new partner played; the other three are rated", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await final();
    const [first] = matchesOf(1);
    h.raw
      .prepare("update matches set status = 'final', outcome = ?, revision = revision + 1 where id = ?")
      .run(JSON.stringify({ kind: "played", score: { sets: [[6, 1], [6, 2]] } }), first);
    const { updateElo } = await import("~/lib/elo.server");
    await updateElo(DURING);
    const rated = all("select user_id from elo_changes where match_id = ? order by user_id", first).map((r) => r.user_id);
    expect(rated).not.toContain("b1");
    expect(rated).not.toContain("q");
    expect(rated).toContain("a1");
    expect(rated).toHaveLength(3);
  });

  it("a new partner who deletes their account ends the change: the marks on unplayed matches go", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await final();
    expect(marks().length).toBeGreaterThan(0);
    const D = await import("~/lib/account-deletion.server");
    expect(await D.deleteOwnAccount("q", DURING)).toMatchObject({ ok: true, mode: "remove" });
    expect(marks()).toEqual([]);
    expect(all("select count(*) n from partner_changes")[0].n).toBe(0);
  });

  it("a leaving player whose account is kept anonymized: an open change is withdrawn", async () => {
    // Round 1 over: nobody plays now, so the account can go.
    h.raw.exec("update season_phases set deadline = 1 where number = 1");
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    const D = await import("~/lib/account-deletion.server");
    expect(await D.deleteOwnAccount("b1", DURING)).toMatchObject({ ok: true, mode: "anonymize" });
    expect(change().status).toBe("withdrawn");
  });
});

describe("a committed new partner can't be paired elsewhere (review M1)", () => {
  beforeEach(world);

  it("once final, the new partner is refused by every way of forming a pair and leaves the seekers' list", async () => {
    h.raw.exec(`insert into partner_searches (league_id, user_id, seeking) values (1, 'q', 1)`);
    const { leagueSeekers } = await import("~/lib/partner-search.server");
    const PAIRS = await import("~/lib/pairs.server");
    expect((await leagueSeekers({ id: 1 })).map((s) => s.id)).toContain("q");
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await final();
    expect(one("select seeking from partner_searches where user_id = 'q'").seeking).toBe(0);
    expect((await leagueSeekers({ id: 1 })).map((s) => s.id)).not.toContain("q");
    expect((await PAIRS.pairCandidates({ id: 1 })).map((c) => c.id)).not.toContain("q");
    // "Pár létrehozása" (also Játékosok' "Párba teszem"), a pair link and another change.
    expect(await PAIRS.createPair("o", 1, "q", "r")).toMatchObject({ ok: false });
    const { pairLinkFor, acceptPairLink } = await import("~/lib/pair-links.server");
    const token = await pairLinkFor("r", 1);
    expect(await acceptPairLink({ id: "q", consentAt: new Date(0) }, token)).toMatchObject({ ok: false });
    expect(await P.startPartnerChange({ id: "a2" }, 1, "q", DURING)).toEqual({ ok: false, error: PARTNER_CHANGE_REFUSALS.partner });
    expect(one("select count(*) n from pairs where status = 'active' and 'q' in (player_a, player_b)").n).toBe(0);
    // Once undone, free again.
    await P.undoPartnerChange("o", 1, 1, DURING);
    expect(await PAIRS.createPair("o", 1, "q", "r")).toMatchObject({ ok: true });
  });

  it("a change whose old pair is gone from the draft at its switch ends, and its three players are told", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await final();
    // A round 2 draft without pair 1 (the organizer took it out).
    h.raw.exec(`insert into groups (id, season_id, phase, number) values (60, 1, 2, 1)`);
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (60, 2, 1), (60, 3, 2), (60, 4, 3)`);
    h.raw.exec("delete from notifications");
    expect(await P.startChangesAtPublish(1, 2, "o", DURING)).toBe(0);
    expect(change().status).toBe("undone");
    expect(notices("partner_change").map((n) => n.user_id)).toEqual(["a1", "b1", "q"]);
    expect(notices("partner_change")[0]!.title).toBe("Nem indult el a partnercsere");
    expect(audits("partner_change.undo")).toEqual([expect.objectContaining({ actor_id: "o", detail: "pair:1; could not start" })]);
  });
});

describe("marks and the window (review L2, L3)", () => {
  beforeEach(world);

  it("an undo keeps the mark of a match whose agreed start has passed, even without a result", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await final();
    const [started] = matchesOf(1);
    h.raw.prepare("update matches set status = 'scheduled', scheduled_at = ? where id = ?").run(sec("2026-11-11T18:00:00Z"), started);
    await P.undoPartnerChange("o", 1, 1, at("2026-11-11T20:00:00Z"));
    expect(marks().map((m) => m.match_id)).toEqual([started]);
  });

  it("a match the pair had already marked for the leaving player names the new partner too", async () => {
    const [first] = matchesOf(1);
    h.raw.prepare("insert into match_absences (match_id, pair_id, absent_id, marked_by, marked_at) values (?, 1, 'b1', 'a1', ?)").run(first, sec("2026-11-10T09:00:00Z"));
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await final();
    expect(marks().find((m) => m.match_id === first)).toMatchObject({ absent_id: "b1", marked_by: "a1", partner_change_id: 1 });
    const { absencesOf } = await import("~/lib/substitutes.server");
    expect((await absencesOf([first])).get(first)![0]!.substitute).toBe("Játékos Q");
  });
});

describe("account deletion (review L5)", () => {
  beforeEach(world);

  it("the leaving player's deletion lets a final change go ahead", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await final();
    h.raw.exec("update season_phases set deadline = 1 where number = 1");
    const D = await import("~/lib/account-deletion.server");
    expect(await D.deleteOwnAccount("b1", DURING)).toMatchObject({ ok: true, mode: "anonymize" });
    expect(change().status).toBe("final");
    expect((await P.switchChanges(1, 2)).map((c) => c.oldPairId)).toEqual([1]);
  });

  it("the starter's deletion undoes it and tells the other two in the app", async () => {
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await final();
    h.raw.exec("update season_phases set deadline = 1 where number = 1");
    h.raw.exec("delete from notifications");
    const D = await import("~/lib/account-deletion.server");
    expect(await D.deleteOwnAccount("a1", DURING)).toMatchObject({ ok: true, mode: "anonymize" });
    expect(change().status).toBe("undone");
    expect(notices("partner_change").map((n) => n.user_id)).toEqual(["b1", "q"]);
  });
});

describe("no other email for the new partner (review round 2, M3)", () => {
  beforeEach(world);

  it("accepting sends only the two change emails, and the stuck reminder no longer counts the new partner as without a pair", async () => {
    const { dueReminders } = await import("~/lib/reminders");
    const { reminderInput } = await import("~/lib/reminders.server");
    const later = new Date(DURING.getTime() + 3 * 86_400_000);
    const remindedC = async () =>
      dueReminders(await reminderInput(later), [1])
        .filter((r) => r.situation === "C")
        .flatMap((r) => r.recipients.map((p) => p.userId));
    expect(await remindedC()).toContain("q");
    h.raw.exec(`insert into partner_searches (league_id, user_id, seeking) values (1, 'q', 1)`);
    await P.startPartnerChange({ id: "a1" }, 1, "q", DURING);
    await final();
    // The accept switched "Párt keresek" off (and the listing on Párkereső, D177), which alone would make q due for C.
    expect(one("select seeking, listed from partner_searches where user_id = 'q'")).toEqual({ seeking: 0, listed: 0 });
    expect(await remindedC()).not.toContain("q");
    // Exactly the two emails #402 names: asked (q) and final (b1); nothing else is queued.
    expect(h.mails.map((m) => [m.toEmail, m.kind])).toEqual([
      ["q@x.hu", "asked"],
      ["b1@x.hu", "final"],
    ]);
    expect(one("select count(*) n from email_messages").n).toBe(0);
  });
});
