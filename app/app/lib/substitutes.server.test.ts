// Temporary substitutes (#400, spec 4, D175) on a real SQLite with every
// migration applied (~/test/sqlite): a player marked as not playing before
// the match on the match page or after it on the result form, the notices
// (in the app only here: no VAPID keys, no email), and Elo (spec 11: the
// absent player's doesn't change). Email is stubbed; nothing here sends any.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueSeasonEntered: async () => {},
  queueGroupsPublished: async () => {},
  queueSeasonEntryDecision: async () => {},
  queueMatchEmails: async () => {},
}));

const { migratedDatabase } = await import("~/test/sqlite");
const S = await import("~/lib/substitutes.server");
const M = await import("~/lib/matches.server");
const R = await import("~/lib/results.server");
const { ABSENCE_REFUSALS } = await import("~/lib/substitutes");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (iso: string) => new Date(iso);

const PHASE = "2026-11-08T23:00:00Z";
const DEADLINE = sec(PHASE) + 21 * 86400 - 60;
const NOW = at("2026-11-10T10:00:00Z");
const SLOT = at("2026-11-12T18:00:00Z");
const AFTER = at("2026-11-12T20:00:00Z");
const WIN_A = { sets: [[4, 1], [4, 2]] } as const;

// League 1 (Győr), group 1: pairs 1 (a–b), 2 (c–d), 3 (e–f), 4 (g–h).
// Match 1: pair 1 – pair 2, open; match 2: pair 3 – pair 4. o: the
// Szervező, adm: an Admin (they decide nothing here: no approval, #400).
function freshDb() {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('budapest', 'Budapest', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'budapest', 'bp', 'Padelpárbaj Budapest')`);
  for (const id of ["a", "b", "c", "d", "e", "f", "g", "h", "o", "adm", "q", "s", "t", "w"])
    h.raw
      .prepare("insert into users (id, email, name, phone, level, consent_at, platform_role) values (?, ?, ?, '+36301234567', ?, 1, ?)")
      .run(id, `${id}@x.hu`, `Játékos ${id.toUpperCase()}`, id === "s" ? "kezdo" : "halado", id === "adm" ? "superadmin" : "player");
  h.raw.exec(`insert into users (id, email, name, level) values ('x', 'x@x.hu', 'Játékos X', 'halado')`);
  h.raw.exec(`insert into users (id, email, name, level, consent_at, deleted_at) values ('z', 'z@deleted.invalid', 'Törölt játékos', 'halado', 1, 1)`);
  h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'o'), (2, 'q')`);
  h.raw.exec(`insert into league_members (league_id, user_id, source) values (1, 's', 'chosen'), (1, 't', 'register'), (1, 'o', 'carried'), (1, 'adm', 'carried'), (1, 'q', 'chosen'), (1, 'x', 'register'), (2, 'w', 'chosen')`);
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (1, 1, 'a', 'b'), (2, 1, 'c', 'd'), (3, 1, 'e', 'f'), (4, 1, 'g', 'h')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline, set_games) values (1, 1, ?, ?, 4)").run(sec(PHASE), DEADLINE);
  h.raw.prepare("insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, ?)").run(sec("2026-11-06T10:00:00Z"));
  [1, 2, 3, 4].forEach((p, i) => h.raw.prepare("insert into group_pairs (group_id, pair_id, seed) values (1, ?, ?)").run(p, i + 1));
  h.raw.prepare("insert into matches (id, group_id, pair_a, pair_b, week, deadline) values (1, 1, 1, 2, 1, ?)").run(DEADLINE);
  h.raw.prepare("insert into matches (id, group_id, pair_a, pair_b, week, deadline) values (2, 1, 3, 4, 1, ?)").run(DEADLINE);
}

beforeEach(() => {
  freshDb();
});

const one = (q: string, ...p: unknown[]) => h.raw.prepare(q).get(...p);
const all = (q: string, ...p: unknown[]) => h.raw.prepare(q).all(...p);
const notices = (kind: string) => all("select user_id, title, body, url from notifications where kind = ? order by user_id", kind) as any[];
const marks = () => all("select match_id, pair_id, absent_id, marked_by, after_match from match_absences order by id") as any[];

async function panel(userId: string, now = NOW, canRecord = false) {
  const ctx = (await M.loadMatch(1))!;
  return S.absencePanel(ctx, M.sideOf(ctx, userId)!, now, canRecord);
}

const elo = (id: string) => (one("select elo from users where id = ?", id) as { elo: number | null }).elo;

describe("marking a player as not playing before the match (#400)", () => {
  it("marks a player of the own pair, no name and no approval; the other three are told", async () => {
    expect(await S.markAbsence("a", 1, "b", NOW)).toEqual({ ok: true, notice: "Rendben, helyettes jön helyette. A többiek is látják." });
    expect(marks()).toEqual([{ match_id: 1, pair_id: 1, absent_id: "b", marked_by: "a", after_match: 0 }]);
    const told = notices("absence_marked");
    expect(told.map((n) => n.user_id)).toEqual(["b", "c", "d"]);
    expect(told[0]).toMatchObject({ body: "Játékos B helyett helyettes játszik a meccseteken.", url: "/matches/1" });
    // Nothing for the organizers: there is nothing to approve.
    expect(all("select * from notifications where user_id in ('o', 'adm')")).toEqual([]);
    expect(all("select * from audit_log")).toEqual([]);
  });

  it("shows every mark to all four players; only the own pair can take it back", async () => {
    await S.markAbsence("a", 1, "b", NOW);
    expect((await panel("c")).marked).toEqual([{ pairId: 1, absentId: "b", name: "Játékos B", afterMatch: false, ours: false, canUnmark: false }]);
    expect((await panel("a")).marked).toEqual([{ pairId: 1, absentId: "b", name: "Játékos B", afterMatch: false, ours: true, canUnmark: true }]);
    expect((await panel("a")).form).toEqual([{ id: "a", name: "Játékos A" }]);
    expect((await panel("c")).form).toEqual([
      { id: "c", name: "Játékos C" },
      { id: "d", name: "Játékos D" },
    ]);
  });

  it("lets both players of a pair be marked, a player mark themself, but not twice", async () => {
    await S.markAbsence("a", 1, "a", NOW);
    expect(await S.markAbsence("b", 1, "a", NOW)).toEqual({ ok: false, error: ABSENCE_REFUSALS.already });
    expect(await S.markAbsence("b", 1, "b", NOW)).toMatchObject({ ok: true });
    expect((await panel("a")).form).toBeNull();
  });

  it("refuses a player of the other pair, and anyone outside the match", async () => {
    expect(await S.markAbsence("a", 1, "c", NOW)).toEqual({ ok: false, error: ABSENCE_REFUSALS.not_own });
    expect(await S.markAbsence("e", 1, "e", NOW)).toMatchObject({ ok: false, notFound: true });
  });

  it("closes at the agreed start, or the deadline without one, and once a result is recorded", async () => {
    h.raw.prepare("update matches set status = 'scheduled', scheduled_at = ? where id = 1").run(sec(SLOT.toISOString()));
    expect(await S.markAbsence("a", 1, "b", SLOT)).toEqual({ ok: false, error: ABSENCE_REFUSALS.closed });
    expect((await panel("a", SLOT)).form).toBeNull();
    h.raw.exec("update matches set status = 'open', scheduled_at = null where id = 1");
    expect(await S.markAbsence("a", 1, "b", new Date(DEADLINE * 1000))).toEqual({ ok: false, error: ABSENCE_REFUSALS.closed });
    expect(await R.resultStep("a", 1, { kind: "record", score: WIN_A } as any, NOW)).toMatchObject({ ok: true });
    expect(await S.markAbsence("a", 1, "b", NOW)).toEqual({ ok: false, error: ABSENCE_REFUSALS.closed });
  });

  it("is closed on a withdrawn pair's match", async () => {
    h.raw.exec(`update group_pairs set withdrawn_at = 1 where pair_id = 2`);
    expect(await S.markAbsence("a", 1, "b", NOW)).toEqual({ ok: false, error: ABSENCE_REFUSALS.closed });
  });

  it("is taken back by either player of the pair before the start, telling the other three", async () => {
    await S.markAbsence("a", 1, "b", NOW);
    expect(await S.unmarkAbsence("c", 1, "b", NOW)).toEqual({ ok: false, error: ABSENCE_REFUSALS.not_own });
    expect(await S.unmarkAbsence("b", 1, "b", NOW)).toMatchObject({ ok: true });
    expect(marks()).toEqual([]);
    expect(notices("absence_marked").find((n) => n.user_id === "c" && /Mégis/.test(n.body)).body).toBe("Mégis Játékos B játszik a meccseteken.");
    expect(await S.unmarkAbsence("a", 1, "b", NOW)).toEqual({ ok: false, error: ABSENCE_REFUSALS.not_marked });
    await S.markAbsence("a", 1, "b", NOW);
    h.raw.prepare("update matches set status = 'scheduled', scheduled_at = ? where id = 1").run(sec(SLOT.toISOString()));
    expect(await S.unmarkAbsence("a", 1, "b", AFTER)).toEqual({ ok: false, error: ABSENCE_REFUSALS.closed });
  });

  it("marks one player on one match on its own (#402 reuses it), once", async () => {
    const { revision } = one("select revision from matches where id = 1") as { revision: number };
    const input = { matchId: 1, revision, pairId: 1, absentId: "b", markedBy: null, afterMatch: false, now: NOW };
    expect(await S.markAbsent(input)).toBe(true);
    expect(await S.markAbsent(input)).toBe(false);
    // Not on a match that moved on since it was read.
    expect(await S.markAbsent({ ...input, absentId: "a", revision: revision + 1 })).toBe(false);
    expect(marks()).toEqual([{ match_id: 1, pair_id: 1, absent_id: "b", marked_by: null, after_match: 0 }]);
  });
});

describe("marked on the result form after the match (#400: a sudden injury)", () => {
  const record = (absent: string[] | undefined, by = "a") => R.resultStep(by, 1, { kind: "record", score: WIN_A, absent } as any, AFTER);
  const status = () => (one("select status from matches where id = 1") as { status: string }).status;

  it("offers the recording pair its two players as ticks, ticked if marked", async () => {
    await S.markAbsence("a", 1, "b", NOW);
    expect((await panel("a", AFTER, true)).resultForm).toEqual([
      { id: "a", name: "Játékos A", marked: false },
      { id: "b", name: "Játékos B", marked: true },
    ]);
    expect((await panel("a", AFTER, false)).resultForm).toBeNull();
  });

  it("goes in with the result; the opponents see it and confirm it with the result", async () => {
    expect(await record(["b"])).toMatchObject({ ok: true });
    expect(marks()).toEqual([{ match_id: 1, pair_id: 1, absent_id: "b", marked_by: "a", after_match: 1 }]);
    const told = notices("absence_marked");
    expect(told.map((n) => n.user_id)).toEqual(["b", "c", "d"]);
    expect(told[1].body).toBe("Játékos B helyett helyettes játszott a meccseteken. Az eredménnyel együtt ezt is megerősítitek.");
    expect((await panel("c", AFTER)).marked).toEqual([expect.objectContaining({ name: "Játékos B", afterMatch: true, ours: false })]);
    expect(await R.resultStep("c", 1, { kind: "confirm" }, AFTER)).toMatchObject({ ok: true });
    expect(status()).toBe("final");
  });

  it("leaves the absent player's Élő-pont alone; the other three are rated as usual", async () => {
    await record(["b"]);
    await R.resultStep("c", 1, { kind: "confirm" }, AFTER);
    expect(elo("b")).toBeNull();
    expect(elo("a")).toBeGreaterThan(1400);
    expect(elo("c")).toBeLessThan(1400);
    expect(all("select user_id from elo_changes order by user_id")).toEqual(["a", "c", "d"].map((user_id) => ({ user_id })));
  });

  it("does the same for a mark from before the match, also once auto-accepted after 48 hours", async () => {
    await S.markAbsence("c", 1, "d", NOW);
    await record(undefined);
    expect(await R.autoAcceptResults(new Date(AFTER.getTime() + 49 * 3600_000))).toBe(1);
    expect(elo("d")).toBeNull();
    expect(all("select user_id from elo_changes order by user_id")).toEqual(["a", "b", "c"].map((user_id) => ({ user_id })));
  });

  it("is set exactly by a correction: added, changed, or dropped; a form without ticks leaves it", async () => {
    await record(["b"]);
    await record(["a"]);
    expect(marks().map((m) => m.absent_id)).toEqual(["a"]);
    await record([]);
    expect(marks()).toEqual([]);
    await record(["b"]);
    await record(undefined);
    expect(marks().map((m) => m.absent_id)).toEqual(["b"]);
  });

  it("can drop a mark from before the match when the player played after all", async () => {
    await S.markAbsence("a", 1, "b", NOW);
    await record([]);
    expect(marks()).toEqual([]);
  });

  it("only touches the recording pair's own players", async () => {
    await S.markAbsence("c", 1, "d", NOW);
    await record(["c", "b"]);
    expect(marks().map((m) => [m.pair_id, m.absent_id])).toEqual([
      [2, "d"],
      [1, "b"],
    ]);
  });
});
