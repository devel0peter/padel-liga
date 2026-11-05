// No-shows (#33, spec 8, D108) on a real SQLite with every migration applied
// (~/test/sqlite): reporting from the match page after the slot's start, one
// waiting report per match and its withdrawal, the organizer's confirmation
// (a 4-0 4-0 walkover the tables count, strikes for the absent pair's two
// players, audited) and rejection, the notices (in the app only here), and
// the deadline resolution leaving a waiting report to the organizer. The
// fixture is the one of deadline.server.test.ts; email is captured, never sent.
import { budapestTime } from "@padel-liga/rules";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, warnings: [] as any[], race: null as { id: number; sql: string } | null }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
// A step taken while a request works: `race.sql` runs right after the match was read.
vi.mock("~/lib/matches.server", async (original) => {
  const real = await original<typeof import("~/lib/matches.server")>();
  return {
    ...real,
    loadMatch: async (id: number) => {
      const out = await real.loadMatch(id);
      if (h.race) h.raw.prepare(h.race.sql).run(h.race.id);
      h.race = null;
      return out;
    },
  };
});
vi.mock("~/lib/email/send.server", () => ({ MAX_BATCH: 100, relayConfigured: () => false, sendEmails: async () => [] }));
vi.mock("~/lib/background.server", () => import("~/test/background"));
vi.mock("~/lib/email/outbox.server", async (original) => ({
  ...(await original<typeof import("~/lib/email/outbox.server")>()),
  queueGroupsPublished: async () => {},
  queueMatchEmails: async () => {},
  queueStrikeWarnings: async (messages: any[]) => h.warnings.push(...messages),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const G = await import("~/lib/groups.server");
const M = await import("~/lib/matches.server");
const R = await import("~/lib/results.server");
const L = await import("~/lib/ladder.server");
const N = await import("~/lib/no-shows.server");
const { NO_SHOW_REFUSALS, NO_SHOW_CHANGED } = await import("~/lib/no-shows");
const { resolveDeadlines } = await import("~/lib/deadline.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (day: string, hour: number, minute = 0) => budapestTime(day, hour, minute);

const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z"];
const PUBLISHED = new Date("2026-11-08T08:00:00Z");
const NOW = at("2026-11-10", 11);
const SLOT = at("2026-11-12", 18);
const AFTER = at("2026-11-12", 19);
const MONDAY_6 = at("2026-11-30", 6);

// League 1 (Győr): pairs 1–7 (p<n>a, p<n>b) in two published groups; o is the
// Szervező, adm an Admin, q the Szervező of league 2.
async function freshDb() {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('budapest', 'Budapest', 1)`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'budapest', 'bp', 'Padelpárbaj Budapest')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  PHASES.forEach((start, i) =>
    h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, ?, ?, ?)").run(i + 1, sec(start), sec(start) + 21 * 86400 - 60),
  );
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('o', 'o@x.hu', 'Org', 'versenyzo', 1)`);
  h.raw.exec(`insert into users (id, email, name, level, consent_at, platform_role) values ('adm', 'adm@x.hu', 'Admin', 'versenyzo', 1, 'superadmin')`);
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('q', 'q@x.hu', 'Bp Org', 'versenyzo', 1)`);
  h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'o'), (2, 'q')`);
  for (let id = 1; id <= 7; id++) {
    for (const side of ["a", "b"] as const)
      h.raw
        .prepare("insert into users (id, email, name, level, phone, consent_at) values (?, ?, ?, 'halado', ?, 1)")
        .run(`p${id}${side}`, `p${id}${side}@x.hu`, `Játékos ${id}${side.toUpperCase()}`, `+3630${id}00000${side === "a" ? 1 : 2}`);
    h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)").run(id, `p${id}a`, `p${id}b`);
    h.raw
      .prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, 'approved', 1, ?)")
      .run(id, sec("2026-11-06T10:00:00Z") + id);
  }
  expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
  expect(await G.publishGroups(1, "o", PUBLISHED)).toEqual({ ok: true });
  h.raw.exec("delete from notifications");
  h.warnings = [];
}

beforeEach(freshDb);

const all = (q: string, ...params: unknown[]) => h.raw.prepare(q).all(...params);
const one = (q: string, ...params: unknown[]) => h.raw.prepare(q).get(...params);
const matchOf = (a: number, b: number) => one("select id, pair_a from matches where (pair_a = ? and pair_b = ?) or (pair_a = ? and pair_b = ?)", a, b, b, a);
const notices = (kind: string) => all("select user_id, title, body, url from notifications where kind = ? order by user_id", kind) as any[];
const lastReport = () => (one("select max(id) id from no_show_reports") as { id: number }).id;

// Pairs 1 and 3 agree on SLOT; returns the match id.
async function scheduled(): Promise<number> {
  const id = matchOf(1, 3).id as number;
  expect(await M.matchStep("p1a", id, { kind: "propose", slots: [SLOT, at("2026-11-13", 19), at("2026-11-14", 10)], clubId: null }, NOW)).toMatchObject({ ok: true });
  expect(await M.matchStep("p3a", id, { kind: "accept", slot: SLOT }, NOW)).toMatchObject({ ok: true });
  return id;
}

// p1a (pair 1) reports that pair 3 didn't come.
async function reported(when = AFTER): Promise<{ id: number; report: number }> {
  const id = await scheduled();
  expect(await N.reportNoShow("p1a", id, when)).toEqual({ ok: true, notice: "Elküldtük a szervezőnek. Szólunk, ha döntött." });
  return { id, report: lastReport() };
}

async function panel(id: number, userId: string, now = AFTER) {
  const ctx = (await M.loadMatch(id))!;
  return N.noShowPanel(ctx, M.sideOf(ctx, userId)!, userId, now);
}

describe("reporting a no-show (#33 requirement 1)", () => {
  it("is refused before the agreed slot's start", async () => {
    const id = await scheduled();
    expect(await N.reportNoShow("p1a", id, new Date(SLOT.getTime() - 60_000))).toEqual({ ok: false, error: NO_SHOW_REFUSALS.too_early });
    expect((await panel(id, "p1a", new Date(SLOT.getTime() - 60_000))).canReport).toBe(false);
    expect(all("select * from no_show_reports")).toEqual([]);
  });

  it("is refused without an agreed slot", async () => {
    const id = matchOf(1, 3).id;
    expect(await N.reportNoShow("p1a", id, AFTER)).toEqual({ ok: false, error: NO_SHOW_REFUSALS.not_scheduled });
  });

  it("is refused once the deadline resolution's time came", async () => {
    const id = await scheduled();
    expect(await N.reportNoShow("p1a", id, MONDAY_6)).toEqual({ ok: false, error: NO_SHOW_REFUSALS.too_late });
    // Still open on Monday 05:59.
    expect(await N.reportNoShow("p1a", id, at("2026-11-30", 5, 59))).toMatchObject({ ok: true });
  });

  it("is 404 for anyone but the match's players", async () => {
    const id = await scheduled();
    expect(await N.reportNoShow("p2a", id, AFTER)).toMatchObject({ ok: false, notFound: true });
    expect(await N.reportNoShow("o", id, AFTER)).toMatchObject({ ok: false, notFound: true });
  });

  it("saves the report and tells the league's Szervező and the Admins, without names, never the reporter", async () => {
    const { id } = await reported();
    expect(one("select match_id, pair_id, status, reported_by from no_show_reports")).toEqual({ match_id: id, pair_id: 1, status: "open", reported_by: "p1a" });
    expect(notices("no_show_reported").map((n) => n.user_id)).toEqual(["adm", "o"]);
    expect(notices("no_show_reported")[0]).toMatchObject({ url: `/admin/leagues/gyor/matches/${id}/decide`, title: "Nem jöttek el · Padelpárbaj Győr" });
    expect(JSON.stringify(notices("no_show_reported"))).not.toMatch(/Játékos/);
  });

  it("leaves out a Szervező who reports for their own pair, and skips those who switched the kind off", async () => {
    h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'p1a')`);
    h.raw.exec(`insert into notification_opt_outs (user_id, kind) values ('adm', 'no_show_reported')`);
    await reported();
    expect(notices("no_show_reported").map((n) => n.user_id)).toEqual(["o"]);
  });

  it("allows one waiting report per match: the other pair can't counter-report", async () => {
    const { id } = await reported();
    expect(await N.reportNoShow("p3a", id, AFTER)).toEqual({ ok: false, error: NO_SHOW_REFUSALS.already });
    expect(await N.reportNoShow("p1b", id, AFTER)).toEqual({ ok: false, error: NO_SHOW_REFUSALS.already });
  });

  it("shows the waiting report to both pairs; only the reporter can withdraw it", async () => {
    const { id, report } = await reported();
    expect(await panel(id, "p1a")).toMatchObject({ canReport: false, open: { id: report, ours: true, canWithdraw: true }, decided: [] });
    expect(await panel(id, "p1b")).toMatchObject({ open: { ours: true, canWithdraw: false } });
    expect(await panel(id, "p3a")).toMatchObject({ open: { ours: false, canWithdraw: false } });
    expect(await N.withdrawNoShow("p1b", id, report)).toEqual({ ok: false, error: NO_SHOW_REFUSALS.not_reporter });
    expect(await N.withdrawNoShow("p1a", id, report)).toEqual({ ok: true, notice: "Visszavontad a bejelentést." });
    expect(one("select status from no_show_reports").status).toBe("withdrawn");
    expect(await N.withdrawNoShow("p1a", id, report)).toEqual({ ok: false, error: NO_SHOW_REFUSALS.not_open });
    // After a withdrawal a new report can be made.
    expect((await panel(id, "p1a")).canReport).toBe(true);
  });

  it("the partial unique index refuses a second waiting report on the same match", async () => {
    const { id } = await reported();
    expect(() => h.raw.prepare("insert into no_show_reports (match_id, pair_id, status, reported_at) values (?, 3, 'open', 1)").run(id)).toThrow(/UNIQUE/);
    // A decided or withdrawn one doesn't count.
    h.raw.prepare("insert into no_show_reports (match_id, pair_id, status, reported_at) values (?, 3, 'rejected', 1)").run(id);
  });
});

describe("the organizer's decision (#33 requirement 2)", () => {
  it("lists the league's waiting reports with both pairs by name", async () => {
    const { id, report } = await reported();
    const list = await N.leagueNoShows(1);
    expect(list).toEqual([
      expect.objectContaining({ id: report, matchId: id, reporting: "Játékos 1A – Játékos 1B", absent: "Játékos 3A – Játékos 3B", slot: SLOT, reportedAt: AFTER }),
    ]);
    expect(await N.leagueNoShows(2)).toEqual([]);
    expect(await N.leagueNoShows(1, id)).toHaveLength(1);
  });

  it("confirming records a 4-0 4-0 walkover for the reporting pair as the organizer's ruling, audited", async () => {
    const { id, report } = await reported();
    const pairA = matchOf(1, 3).pair_a as number;
    const winner = pairA === 1 ? "a" : "b";
    expect(await N.decideNoShow("o", 1, report, "confirm", "", at("2026-11-13", 9))).toMatchObject({ ok: true });
    expect(one("select status, outcome from matches where id = ?", id)).toEqual({ status: "final", outcome: JSON.stringify({ kind: "walkover", winner }) });
    expect(all("select kind, user_id, reason from match_decisions where match_id = ?", id)).toEqual([
      { kind: "organizer", user_id: "o", reason: "Nem jöttek el: a szervező jóváhagyta a bejelentést." },
    ]);
    expect(one("select status, decided_by, reason from no_show_reports where id = ?", report)).toEqual({ status: "confirmed", decided_by: "o", reason: null });
    expect(one("select actor_id, detail, league_id from audit_log where action = 'match.no_show_confirm' and target = ?", `match:${id}`)).toEqual({
      actor_id: "o",
      detail: `${winner === "a" ? "A pár" : "B pár"} jelentette: Játék nélküli győzelem: ${winner === "a" ? "A pár" : "B pár"} (4:0, 4:0)`,
      league_id: 1,
    });
    // The players' match page: final, the organizer's ruling.
    const page = await M.matchPage(id, "p3a", at("2026-11-13", 9));
    expect(page!.result).toMatchObject({ status: "final", how: "organizer" });
  });

  it("confirming gives the absent pair's two players a strike with source no_show, never a substitute", async () => {
    const { id, report } = await reported();
    // An approved substitute stood in for p3b.
    h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('s', 's@x.hu', 'Helyettes', 'halado', 1)`);
    h.raw
      .prepare("insert into match_substitutes (match_id, pair_id, absent_id, substitute_id, status, requested_at) values (?, 3, 'p3b', 's', 'approved', ?)")
      .run(id, sec(NOW.toISOString()));
    await N.decideNoShow("o", 1, report, "confirm", "Az ellenfél is megerősítette.", at("2026-11-13", 9));
    expect(all("select user_id, pair_id, source, match_id, season_id from strikes order by user_id")).toEqual([
      { user_id: "p3a", pair_id: 3, source: "no_show", match_id: id, season_id: 1 },
      { user_id: "p3b", pair_id: 3, source: "no_show", match_id: id, season_id: 1 },
    ]);
    expect(notices("strike").map((n) => n.user_id)).toEqual(["p3a", "p3b"]);
    expect(notices("strike")[0].body).toMatch(/^Nem jelentetek meg egy lefixált meccsen\./);
    expect(one("select reason from no_show_reports").reason).toBe("Az ellenfél is megerősítette.");
    expect(one("select reason from match_decisions").reason).toBe("Nem jöttek el: a szervező jóváhagyta a bejelentést. Az ellenfél is megerősítette.");
  });

  it("tells both pairs from their own side, in the app and by push only", async () => {
    const { id, report } = await reported();
    await N.decideNoShow("o", 1, report, "confirm", "", at("2026-11-13", 9));
    const told = notices("no_show_confirmed");
    expect(told.map((n) => n.user_id)).toEqual(["p1a", "p1b", "p3a", "p3b"]);
    expect(told[0]).toMatchObject({ title: "Jóváhagyta a szervező: nem jöttek el", url: `/matches/${id}` });
    expect(told[2]).toMatchObject({ title: "A szervező szerint nem jöttetek el" });
    expect(all("select * from email_messages")).toEqual([]);
  });

  it("the confirmed no-show counts as a walkover in the public table", async () => {
    const { report } = await reported();
    await N.decideNoShow("o", 1, report, "confirm", "", at("2026-11-13", 9));
    const page: any = await L.ladderPage("gyor", at("2026-11-13", 10));
    const group = page.bands.flatMap((b: any) => b.groups).find((g: any) => g.rows.some((r: any) => r.names.includes("Játékos 1A")));
    expect(group.rows.find((r: any) => r.names.includes("Játékos 1A"))).toMatchObject({ points: 3, matches: 1, setDiff: 2, gameDiff: 8 });
    expect(group.rows.find((r: any) => r.names.includes("Játékos 3A"))).toMatchObject({ points: 0, matches: 1, setDiff: -2, gameDiff: -8 });
  });

  it("rejecting leaves the match as it was, keeps the reason, tells both pairs, audited", async () => {
    const { id, report } = await reported();
    expect(await N.decideNoShow("o", 1, report, "reject", "Az ellenfél szerint ott voltak.", at("2026-11-13", 9))).toMatchObject({ ok: true });
    expect(one("select status, outcome from matches where id = ?", id)).toEqual({ status: "scheduled", outcome: null });
    expect(all("select * from match_decisions")).toEqual([]);
    expect(all("select * from strikes")).toEqual([]);
    expect(one("select status, reason from no_show_reports")).toEqual({ status: "rejected", reason: "Az ellenfél szerint ott voltak." });
    expect(notices("no_show_rejected").map((n) => n.user_id)).toEqual(["p1a", "p1b", "p3a", "p3b"]);
    expect(one("select actor_id, league_id from audit_log where action = 'match.no_show_reject'")).toEqual({ actor_id: "o", league_id: 1 });
    // Both pairs see the decision and its reason; a new report can be made.
    expect(await panel(id, "p3a", at("2026-11-13", 10))).toMatchObject({
      canReport: true,
      open: null,
      decided: [{ id: report, ours: false, confirmed: false, reason: "Az ellenfél szerint ott voltak." }],
    });
  });

  it("decides a waiting report only once; a withdrawn one can't be decided", async () => {
    const { id, report } = await reported();
    expect(await N.decideNoShow("o", 1, report, "reject", "", AFTER)).toMatchObject({ ok: true });
    expect(await N.decideNoShow("o", 1, report, "confirm", "", AFTER)).toEqual({ ok: false, error: NO_SHOW_REFUSALS.not_open });
    expect(await N.reportNoShow("p1a", id, AFTER)).toMatchObject({ ok: true });
    const again = lastReport();
    expect(await N.withdrawNoShow("p1a", id, again)).toMatchObject({ ok: true });
    expect(await N.decideNoShow("o", 1, again, "reject", "", AFTER)).toEqual({ ok: false, error: NO_SHOW_REFUSALS.not_open });
  });

  it("can't confirm on a final match, but can still reject", async () => {
    const { id, report } = await reported();
    h.raw.prepare("update matches set status = 'final', outcome = ? where id = ?").run(JSON.stringify({ kind: "unplayed" }), id);
    expect(await N.decideNoShow("o", 1, report, "confirm", "", AFTER)).toEqual({ ok: false, error: NO_SHOW_REFUSALS.final });
    expect(await N.decideNoShow("o", 1, report, "reject", "", AFTER)).toMatchObject({ ok: true });
  });

  it("a match made final meanwhile (auto-accept, an override) leaves its waiting report off Viták and the match page", async () => {
    const { id } = await reported();
    h.raw.prepare("update matches set status = 'final', outcome = ? where id = ?").run(JSON.stringify({ kind: "unplayed" }), id);
    expect(await N.leagueNoShows(1)).toEqual([]);
    expect(await panel(id, "p1a")).toMatchObject({ canReport: false, open: null });
  });

  it("confirms the walkover over a result recorded after the report, without any Elo change", async () => {
    const { id, report } = await reported();
    const elo = () => all("select id, elo from users where id like 'p%' order by id");
    const before = elo();
    expect(await R.resultStep("p3a", id, { kind: "record", score: { sets: [[4, 1], [4, 2]] } }, AFTER)).toMatchObject({ ok: true });
    expect(await N.decideNoShow("o", 1, report, "confirm", "", at("2026-11-13", 9))).toMatchObject({ ok: true });
    expect(one("select status from matches where id = ?", id).status).toBe("final");
    // A walkover is not rated (spec 11): no Elo row and nobody's rating moved.
    expect(all("select * from elo_changes")).toEqual([]);
    expect(elo()).toEqual(before);
  });

  it("is 404 for another league's organizer", async () => {
    const { report } = await reported();
    expect(await N.decideNoShow("q", 2, report, "confirm", "", AFTER)).toMatchObject({ ok: false, notFound: true });
    expect(one("select status from no_show_reports").status).toBe("open");
  });

  it("refuses a reason over 300 characters", async () => {
    const { report } = await reported();
    expect(await N.decideNoShow("o", 1, report, "reject", "x".repeat(301), AFTER)).toEqual({ ok: false, error: "Az indoklás legfeljebb 300 karakter lehet." });
  });

  it("a withdrawn pair's match: no report, and a waiting one leaves the list", async () => {
    const { report } = await reported();
    h.raw.prepare("update group_pairs set withdrawn_at = ? where pair_id = 3").run(sec(AFTER.toISOString()));
    expect(await N.leagueNoShows(1)).toEqual([]);
    expect(await N.decideNoShow("o", 1, report, "confirm", "", AFTER)).toEqual({ ok: false, error: NO_SHOW_REFUSALS.voided });
  });

  it("refuses the confirmation when the match or the report changed meanwhile, changing nothing", async () => {
    const { id, report } = await reported();
    h.race = { id, sql: "update matches set revision = revision + 1 where id = ?" };
    expect(await N.decideNoShow("o", 1, report, "confirm", "", AFTER)).toEqual({ ok: false, error: NO_SHOW_CHANGED });
    // Withdrawn after the organizer's request read it: the batch's guard on the report catches it.
    h.race = { id: report, sql: "update no_show_reports set status = 'withdrawn' where id = ?" };
    expect(await N.decideNoShow("o", 1, report, "confirm", "", AFTER)).toEqual({ ok: false, error: NO_SHOW_CHANGED });
    expect(one("select status from no_show_reports where id = ?", report).status).toBe("withdrawn");
    expect(one("select status, outcome from matches where id = ?", id)).toEqual({ status: "scheduled", outcome: null });
    expect(all("select * from match_decisions")).toEqual([]);
    expect(all("select * from strikes")).toEqual([]);
    expect(all("select * from audit_log where action like 'match.no_show%'")).toEqual([]);
  });

  it("refuses a report when the match took a step meanwhile", async () => {
    const id = await scheduled();
    h.race = { id, sql: "update matches set revision = revision + 1 where id = ?" };
    expect(await N.reportNoShow("p1a", id, AFTER)).toEqual({ ok: false, error: NO_SHOW_CHANGED });
    expect(all("select * from no_show_reports")).toEqual([]);
  });
});

describe("the deadline resolution and a waiting report (#33, #11)", () => {
  it("leaves a match with a waiting report to the organizer, and resolves it after a rejection", async () => {
    const { id, report } = await reported(at("2026-11-29", 20));
    await resolveDeadlines(MONDAY_6, undefined, 25);
    expect(one("select status from matches where id = ?", id).status).toBe("scheduled");
    expect(all("select * from match_decisions where match_id = ?", id)).toEqual([]);
    expect(await N.decideNoShow("o", 1, report, "reject", "", at("2026-11-30", 9))).toMatchObject({ ok: true });
    await resolveDeadlines(at("2026-11-30", 9, 10), undefined, 25);
    // An agreed slot: both active, unplayed (D103).
    expect(one("select status, outcome from matches where id = ?", id)).toEqual({ status: "final", outcome: JSON.stringify({ kind: "unplayed" }) });
  });

  it("the organizer can confirm after the deadline, before or without the cron", async () => {
    const { id, report } = await reported(at("2026-11-29", 20));
    await resolveDeadlines(MONDAY_6, undefined, 25);
    expect(await N.decideNoShow("o", 1, report, "confirm", "", at("2026-11-30", 9))).toMatchObject({ ok: true });
    expect(JSON.parse(one("select outcome from matches where id = ?", id).outcome)).toMatchObject({ kind: "walkover" });
  });
});
