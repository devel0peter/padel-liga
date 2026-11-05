// Substitutes (#37, spec 4, D109) on a real SQLite with every migration
// applied (~/test/sqlite): asking from the match page, who may stand in, the
// organizer's approval, rejection and revocation (audited, D91), the notices
// (in the app only here: no VAPID keys, no email), and Elo from who actually
// played (spec 11). Email is stubbed; nothing here sends any.
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
const { SUBSTITUTE_REFUSALS } = await import("~/lib/substitutes");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (iso: string) => new Date(iso);

const PHASE = "2026-11-08T23:00:00Z";
const DEADLINE = sec(PHASE) + 21 * 86400 - 60;
const NOW = at("2026-11-10T10:00:00Z");
const SLOT = at("2026-11-12T18:00:00Z");
const AFTER = at("2026-11-12T20:00:00Z");
const WIN_A = { sets: [[4, 1], [4, 2]] } as const;

// League 1 (Győr), group 1: pairs 1 (a–b), 2 (c–d), 3 (e–f), 4 (g–h).
// Match 1: pair 1 – pair 2, open. Outsiders: s (registered, Győr signup,
// kezdő), t (registered, no signup: every league), w (registered, Budapest
// signup only), x (first login not done), z (deleted). o: the Szervező,
// adm: an Admin, q: Szervező of league 2.
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
  h.raw.exec(`insert into interest_signups (mode, name1, email1, city, level, consent_at) values ('solo', 'S', 's@x.hu', 'gyor', 'kezdo', 1)`);
  h.raw.exec(`insert into interest_signups (mode, name1, email1, city, level, consent_at) values ('solo', 'W', 'w@x.hu', 'budapest', 'kezdo', 1)`);
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (1, 1, 'a', 'b'), (2, 1, 'c', 'd'), (3, 1, 'e', 'f'), (4, 1, 'g', 'h')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, ?, ?)").run(sec(PHASE), DEADLINE);
  h.raw.prepare("insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, ?)").run(sec("2026-11-06T10:00:00Z"));
  [1, 2, 3, 4].forEach((p, i) => h.raw.prepare("insert into group_pairs (group_id, pair_id, seed) values (1, ?, ?)").run(p, i + 1));
  h.raw.prepare("insert into matches (id, group_id, pair_a, pair_b, week, deadline) values (1, 1, 1, 2, 1, ?)").run(DEADLINE);
  h.raw.prepare("insert into matches (id, group_id, pair_a, pair_b, week, deadline) values (2, 1, 3, 4, 1, ?)").run(DEADLINE);
}

beforeEach(() => freshDb());

const one = (q: string, ...p: unknown[]) => h.raw.prepare(q).get(...p);
const all = (q: string, ...p: unknown[]) => h.raw.prepare(q).all(...p);
const notices = (kind: string) => all("select user_id, title, body, url from notifications where kind = ? order by user_id", kind) as any[];
const requestId = () => (one("select max(id) id from match_substitutes") as { id: number }).id;

async function panel(userId: string, now = NOW) {
  const ctx = (await M.loadMatch(1))!;
  return S.substitutePanel(ctx, M.sideOf(ctx, userId)!, userId, now);
}

async function asked(absentId = "b", substituteId = "s", by = "a") {
  expect(await S.requestSubstitute(by, 1, { absentId, substituteId }, NOW)).toMatchObject({ ok: true });
  return requestId();
}

describe("asking for a substitute (#37 requirement 1)", () => {
  it("saves the request and tells the league's Szervező and the Admins, never the asker", async () => {
    await asked();
    expect(one("select pair_id, absent_id, substitute_id, status, requested_by from match_substitutes")).toEqual({
      pair_id: 1,
      absent_id: "b",
      substitute_id: "s",
      status: "requested",
      requested_by: "a",
    });
    expect(notices("substitute_requested").map((n) => n.user_id)).toEqual(["adm", "o"]);
    expect(notices("substitute_requested")[0]).toMatchObject({ url: "/admin/leagues/gyor/substitutes" });
    // No names in the organizers' notice.
    expect(JSON.stringify(notices("substitute_requested"))).not.toMatch(/Játékos/);
  });

  it("leaves out a Szervező who asks for their own pair", async () => {
    h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'a')`);
    await asked();
    expect(notices("substitute_requested").map((n) => n.user_id)).toEqual(["adm", "o"]);
  });

  it("offers the league's registered players, minus the group's players, by name only", async () => {
    const p = await panel("a");
    expect(p.open).toBe(true);
    expect(p.form!.absent.map((x) => x.id)).toEqual(["a", "b"]);
    const ids = p.form!.candidates.map((c) => c.id);
    // s (Győr signup) and t (no signup) and the staff; never the group's
    // players, w (Budapest only), x (not registered) or z (deleted).
    expect(ids).toEqual(expect.arrayContaining(["s", "t", "o", "adm", "q"]));
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h", "w", "x", "z"]) expect(ids).not.toContain(id);
    expect(Object.keys(p.form!.candidates[0]!).sort()).toEqual(["id", "name"]);
  });

  it("offers a player of a pair withdrawn from the group", async () => {
    h.raw.exec(`update group_pairs set withdrawn_at = 1 where pair_id = 3`);
    expect((await panel("a")).form!.candidates.map((c) => c.id)).toEqual(expect.arrayContaining(["e", "f"]));
    await asked("b", "e");
  });

  it("refuses a player of the same group (#37 acceptance)", async () => {
    expect(await S.requestSubstitute("a", 1, { absentId: "b", substituteId: "e" }, NOW)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.group_player });
  });

  it("refuses one of the four players", async () => {
    expect(await S.requestSubstitute("a", 1, { absentId: "b", substituteId: "c" }, NOW)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.match_player });
  });

  it("refuses an account that isn't a registered player of the league", async () => {
    for (const id of ["x", "z", "w", "nobody"])
      expect(await S.requestSubstitute("a", 1, { absentId: "b", substituteId: id }, NOW)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.not_registered });
  });

  it("refuses an absent player of the other pair", async () => {
    expect(await S.requestSubstitute("a", 1, { absentId: "c", substituteId: "s" }, NOW)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.not_absent });
  });

  it("allows one live substitute per absent player, and the same substitute once a match", async () => {
    await asked("b", "s");
    expect(await S.requestSubstitute("b", 1, { absentId: "b", substituteId: "t" }, NOW)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.already });
    expect(await S.requestSubstitute("c", 1, { absentId: "d", substituteId: "s" }, NOW)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.taken });
    // Both players of a pair may be replaced.
    await asked("a", "t", "a");
    expect((await panel("a")).form).toBeNull();
  });

  it("closes at the agreed start, or at the deadline without one", async () => {
    h.raw.prepare("update matches set status = 'scheduled', scheduled_at = ? where id = 1").run(sec(SLOT.toISOString()));
    expect(await S.requestSubstitute("a", 1, { absentId: "b", substituteId: "s" }, SLOT)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.closed });
    expect((await panel("a", SLOT)).form).toBeNull();
    h.raw.exec("update matches set status = 'open', scheduled_at = null where id = 1");
    expect(await S.requestSubstitute("a", 1, { absentId: "b", substituteId: "s" }, new Date(DEADLINE * 1000))).toMatchObject({ ok: false });
    await asked();
  });

  it("closes once a result is recorded", async () => {
    expect(await R.resultStep("a", 1, { kind: "record", score: WIN_A } as any, NOW)).toMatchObject({ ok: true });
    expect(await S.requestSubstitute("a", 1, { absentId: "b", substituteId: "s" }, NOW)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.closed });
  });

  it("is closed on a withdrawn pair's match", async () => {
    h.raw.exec(`update group_pairs set withdrawn_at = 1 where pair_id = 2`);
    expect(await S.requestSubstitute("a", 1, { absentId: "b", substituteId: "s" }, NOW)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.closed });
  });

  it("answers anyone else with not found", async () => {
    expect(await S.requestSubstitute("e", 1, { absentId: "e", substituteId: "s" }, NOW)).toMatchObject({ ok: false, notFound: true });
  });

  it("lets only the asker withdraw it, while it waits", async () => {
    const id = await asked();
    expect(await S.withdrawSubstitute("b", 1, id)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.not_requester });
    expect((await panel("b")).ours[0]!.canWithdraw).toBe(false);
    expect((await panel("a")).ours[0]!.canWithdraw).toBe(true);
    expect(await S.withdrawSubstitute("a", 1, id)).toMatchObject({ ok: true });
    expect(one("select status from match_substitutes")).toEqual({ status: "withdrawn" });
    // The player can be asked for again.
    await asked();
  });
});

describe("the organizer's list (#37 requirement 2)", () => {
  it("shows waiting requests with both players' current Elo side by side", async () => {
    h.raw.exec("update users set elo = 1450.25 where id = 'b'");
    await asked();
    const { waiting, approved } = await S.leagueSubstitutes(1, NOW);
    expect(approved).toEqual([]);
    expect(waiting).toEqual([
      expect.objectContaining({
        matchId: 1,
        pair: "Játékos A – Játékos B",
        opponents: "Játékos C – Játékos D",
        absent: { name: "Játékos B", elo: 1450.25 },
        substitute: { name: "Játékos S", elo: 1000 },
        week: 1,
        groupNumber: 1,
      }),
    ]);
    expect(JSON.stringify(waiting)).not.toMatch(/@/);
    expect((await S.leagueSubstitutes(2, NOW)).waiting).toEqual([]);
  });

  it("leaves out lapsed requests and a withdrawn pair's matches", async () => {
    await asked();
    expect((await S.leagueSubstitutes(1, new Date(DEADLINE * 1000 + 1000))).waiting).toEqual([]);
    h.raw.exec(`update group_pairs set withdrawn_at = 1 where pair_id = 2`);
    expect((await S.leagueSubstitutes(1, NOW)).waiting).toEqual([]);
  });
});

describe("approving, rejecting and revoking (#37 requirement 2, D91)", () => {
  it("approves: audited, the pair and the opponents told, every player of the match sees it", async () => {
    const id = await asked();
    expect(await S.decideSubstitute("o", 1, id, "approve", "", NOW)).toMatchObject({ ok: true });
    expect(one("select status, decided_by from match_substitutes")).toEqual({ status: "approved", decided_by: "o" });
    expect(all("select actor_id, action, target, detail, league_id from audit_log")).toEqual([
      { actor_id: "o", action: "substitute.approve", target: "match:1", detail: "user:b -> user:s", league_id: 1 },
    ]);
    const told = notices("substitute_approved");
    expect(told.map((n) => n.user_id)).toEqual(["a", "b", "c", "d"]);
    expect(told.find((n) => n.user_id === "a").title).toBe("Jóváhagyták a helyettest");
    expect(told.find((n) => n.user_id === "c").body).toBe("Játékos B helyett Játékos S játszik a meccseteken.");
    // The substitute gets nothing (D109).
    expect(all("select * from notifications where user_id = 's'")).toEqual([]);
    expect((await panel("c")).approved).toEqual([{ ours: false, absent: "Játékos B", substitute: "Játékos S" }]);
    expect((await panel("a")).approved).toEqual([{ ours: true, absent: "Játékos B", substitute: "Játékos S" }]);
    // The opponents don't see the other pair's requests themselves.
    expect((await panel("c")).ours).toEqual([]);
    expect((await S.leagueSubstitutes(1, NOW)).approved).toHaveLength(1);
  });

  it("checks the substitute again at approval", async () => {
    const id = await asked();
    h.raw.exec("update users set deleted_at = 1 where id = 's'");
    expect(await S.decideSubstitute("o", 1, id, "approve", "", NOW)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.not_registered });
    expect(all("select * from audit_log")).toEqual([]);
  });

  it("refuses to approve after the start", async () => {
    const id = await asked();
    h.raw.prepare("update matches set status = 'scheduled', scheduled_at = ? where id = 1").run(sec(SLOT.toISOString()));
    expect(await S.decideSubstitute("o", 1, id, "approve", "", SLOT)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.closed });
  });

  it("rejects with a reason: only the asking pair is told; the reason is on their match page", async () => {
    const id = await asked();
    expect(await S.decideSubstitute("o", 1, id, "reject", "  Túl erős helyettes.  ", NOW)).toMatchObject({ ok: true });
    expect(one("select status, reason from match_substitutes")).toEqual({ status: "rejected", reason: "Túl erős helyettes." });
    expect(notices("substitute_rejected").map((n) => n.user_id)).toEqual(["a", "b"]);
    expect(JSON.stringify(notices("substitute_rejected"))).not.toMatch(/Túl erős/);
    expect((await panel("b")).ours[0]).toMatchObject({ status: "rejected", reason: "Túl erős helyettes.", label: "Elutasítva" });
    expect(all("select action from audit_log")).toEqual([{ action: "substitute.reject" }]);
    // A new request for the same player is possible.
    await asked("b", "t");
  });

  it("refuses a reason over 300 characters", async () => {
    const id = await asked();
    expect(await S.decideSubstitute("o", 1, id, "reject", "x".repeat(301), NOW)).toMatchObject({ ok: false });
  });

  it("revokes an approval before the start, telling both pairs; not after", async () => {
    const id = await asked();
    await S.decideSubstitute("o", 1, id, "approve", "", NOW);
    expect(await S.decideSubstitute("o", 1, id, "revoke", "", NOW)).toMatchObject({ ok: true });
    expect(notices("substitute_revoked").map((n) => n.user_id)).toEqual(["a", "b", "c", "d"]);
    expect(all("select action from audit_log order by id")).toEqual([{ action: "substitute.approve" }, { action: "substitute.revoke" }]);
    expect((await panel("c")).approved).toEqual([]);

    await asked("b", "t");
    const again = requestId();
    await S.decideSubstitute("o", 1, again, "approve", "", NOW);
    h.raw.prepare("update matches set status = 'scheduled', scheduled_at = ? where id = 1").run(sec(SLOT.toISOString()));
    expect(await S.decideSubstitute("o", 1, again, "revoke", "", AFTER)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.closed });
  });

  it("finds nothing for another league's organizer route", async () => {
    const id = await asked();
    expect(await S.decideSubstitute("q", 2, id, "approve", "", NOW)).toMatchObject({ ok: false, notFound: true });
    expect(one("select status from match_substitutes")).toEqual({ status: "requested" });
  });

  it("won't decide twice", async () => {
    const id = await asked();
    await S.decideSubstitute("o", 1, id, "reject", "", NOW);
    expect(await S.decideSubstitute("o", 1, id, "approve", "", NOW)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.not_requested });
    expect(await S.decideSubstitute("o", 1, id, "revoke", "", NOW)).toEqual({ ok: false, error: SUBSTITUTE_REFUSALS.not_approved });
  });
});

describe("Elo from who actually played (#37 requirement 4, spec 11)", () => {
  const elo = (id: string) => (one("select elo from users where id = ?", id) as { elo: number | null }).elo;

  async function play() {
    expect(await R.resultStep("a", 1, { kind: "record", score: WIN_A } as any, AFTER)).toMatchObject({ ok: true });
    expect(await R.resultStep("c", 1, { kind: "confirm" }, AFTER)).toMatchObject({ ok: true });
  }

  it("changes the approved substitute's rating; the absent player's doesn't (#37 acceptance)", async () => {
    const id = await asked();
    await S.decideSubstitute("o", 1, id, "approve", "", NOW);
    await play();
    expect(elo("b")).toBeNull();
    expect(elo("s")).toBeGreaterThan(1000);
    expect(elo("a")).toBeGreaterThan(1400);
    expect(all("select user_id from elo_changes order by user_id")).toEqual(["a", "c", "d", "s"].map((user_id) => ({ user_id })));
  });

  it("ignores a request that was never approved, rejected or revoked", async () => {
    await asked("b", "s");
    const rejected = await asked("a", "t");
    await S.decideSubstitute("o", 1, rejected, "reject", "", NOW);
    await play();
    expect(all("select user_id from elo_changes order by user_id")).toEqual(["a", "b", "c", "d"].map((user_id) => ({ user_id })));
    expect(elo("s")).toBeNull();
  });
});
