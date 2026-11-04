// results.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): recording a result, confirming or disputing it, and the
// 48-hour auto-accept (#28). The fixture is the one of matches.server.test.ts;
// email is stubbed.
import { budapestTime } from "@padel-liga/rules";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

// No VAPID keys: notifications are stored, not pushed.
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueGroupsPublished: async () => {},
  queueSeasonEntryDecision: async () => {},
  queueMatchEmails: async (messages: any[]) => h.mails.push(...messages),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { MANY, addManyMatches, recordOn } = await import("~/test/many-matches");
const G = await import("~/lib/groups.server");
const M = await import("~/lib/matches.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (day: string, hour: number, minute = 0) => budapestTime(day, hour, minute);

// The first season: phase 1 runs Mon 9 – Sun 29 Nov 2026 (Budapest, UTC+1).
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const DEADLINE = new Date((sec(PHASES[0]!) + 21 * 86400 - 60) * 1000);
const PUBLISHED = new Date("2026-11-08T08:00:00Z");
const NOW = at("2026-11-10", 11);

// 7 pairs, 4 + 3. Group 1 by seed: pairs 1, 2, 4, 3 (pair 4 approved first);
// its matches: week 1 1–3 and 2–4, week 2 1–4 and 2–3, week 3 1–2 and 4–3.
// Group 2: pairs 5, 6, 7; week 1 6–7 (5 rests), week 2 5–7, week 3 5–6.
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
  h.raw.exec(`insert into clubs (id, slug, city, name, active) values (1, 'ace', 'gyor', 'Ace Padel', 1), (2, 'old', 'gyor', 'Régi Klub', 0), (3, 'pecsi', 'pecs', 'Pécsi Padel', 1)`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
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
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('x', 'x@x.hu', 'Kívülálló', 'halado', 1)`);
  expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
  expect(await G.publishGroups(1, "o", PUBLISHED)).toEqual({ ok: true });
  h.raw.exec("delete from notifications");
  h.mails = [];
}

const all = (q: string, ...params: unknown[]) => h.raw.prepare(q).all(...params);
const matchOf = (a: number, b: number): number =>
  all("select id from matches where (pair_a = ? and pair_b = ?) or (pair_a = ? and pair_b = ?)", a, b, b, a)[0].id;
const inbox = () => all("select n.kind, n.url, u.id as user from notifications n join users u on u.id = n.user_id order by n.id");
const events = (matchId: number) => all("select kind, pair_id, user_id, slots, slot, club_id from match_events where match_id = ? order by id", matchId);

const R = await import("~/lib/results.server");
const SLOTS = [at("2026-11-12", 18), at("2026-11-13", 19, 30), at("2026-11-14", 10)];

const WIN: [number, number][] = [
  [4, 1],
  [4, 2],
];
// A score from the a/b order, as stored.
type Score = { sets: [number, number][]; superTieBreak?: [number, number] };
const score = (sets: [number, number][], superTieBreak?: [number, number]): Score => ({ sets, ...(superTieBreak ? { superTieBreak } : {}) });
const flip = (s: Score): Score => ({
  sets: s.sets.map(([x, y]) => [y, x]),
  ...(s.superTieBreak ? { superTieBreak: [s.superTieBreak[1], s.superTieBreak[0]] as [number, number] } : {}),
});

const PLAYED = at("2026-11-12", 20);
const HOUR = 3600_000;
const matchRow = (id: number) => all("select status, outcome, revision, pair_a from matches where id = ?", id)[0];
const resultEvents = (id: number) => all("select kind, pair_id, user_id, score, note from match_events where match_id = ? order by id", id);
const decisions = (id: number) => all("select kind, user_id, outcome, reason from match_decisions where match_id = ? order by id", id);

// Match 1–3, with "rec" a player of pair_a and "opp" one of pair_b.
function setup() {
  const id = matchOf(1, 3);
  const a = matchRow(id).pair_a as number;
  const b = a === 1 ? 3 : 1;
  return { id, a, b, rec: `p${a}a`, recPartner: `p${a}b`, opp: `p${b}a`, oppPartner: `p${b}b` };
}

describe("recording a result (#28)", () => {
  beforeEach(freshDb);

  it("an invalid score is refused with the engine's Hungarian message, nothing written", async () => {
    const { id, rec } = setup();
    expect(await R.resultStep(rec, id, { kind: "record", score: score([[4, 3], [4, 0]]) }, PLAYED)).toEqual({
      ok: false,
      error: "1. szett: 4:3 nem lehet. Lehet 4:0, 4:1, 4:2, 5:3 vagy (tie-break után) 5:4.",
    });
    expect(await R.resultStep(rec, id, { kind: "record", score: score([[4, 1], [2, 4]]) }, PLAYED)).toEqual({
      ok: false,
      error: "1:1-es szettállásnál add meg a szuper tie-break eredményét.",
    });
    expect(await R.resultStep(rec, id, { kind: "record", score: score([[4, Number.NaN], [4, 0]]) }, PLAYED)).toEqual({
      ok: false,
      error: "1. szett: a játékok száma 0 vagy pozitív egész szám.",
    });
    expect(resultEvents(id)).toEqual([]);
    expect(matchRow(id).status).toBe("open");
    expect(h.mails).toEqual([]);
  });

  it("a valid score is logged and waits; the other pair gets an instant email and an app notice", async () => {
    const { id, a, b, rec, opp, oppPartner } = setup();
    const s = score([[4, 1], [2, 4]], [10, 8]);
    expect(await R.resultStep(rec, id, { kind: "record", score: s }, PLAYED)).toEqual({ ok: true, notice: "Rögzítettük. A másik pár megerősíti." });
    expect(resultEvents(id)).toEqual([{ kind: "result_recorded", pair_id: a, user_id: rec, score: JSON.stringify(s), note: null }]);
    expect(matchRow(id)).toMatchObject({ status: "result_pending", outcome: null, revision: 1 });

    expect(h.mails.map((m) => [m.kind, m.toEmail])).toEqual([
      ["match_result", `${opp}@x.hu`],
      ["match_result", `${oppPartner}@x.hu`],
    ]);
    // The score from the recipients' side, and the 48-hour time.
    expect(h.mails[0].input).toMatchObject({ score: "1:4, 4:2, szuper tie-break 8:10", matchId: id, autoAcceptAt: new Date(PLAYED.getTime() + 48 * HOUR) });
    expect(inbox()).toEqual([
      { kind: "match_result", url: `/matches/${id}`, user: opp },
      { kind: "match_result", url: `/matches/${id}`, user: oppPartner },
    ]);
    void b;

    // The recorder waits; the other pair has a Teendő-worthy state and the buttons.
    const mine = (await M.matchPage(id, rec, PLAYED))!;
    expect(mine.result).toMatchObject({ status: "recorded", by: "a" });
    expect(mine.resultActions).toEqual({ record: true, confirm: false, dispute: false });
    expect(mine.autoAcceptAt).toEqual(new Date(PLAYED.getTime() + 48 * HOUR));
    const theirs = (await M.matchPage(id, opp, PLAYED))!;
    expect(theirs.resultActions).toEqual({ record: false, confirm: true, dispute: true });
    expect(theirs.log.map((l) => l.text)).toEqual(["Rögzítette az eredményt: 1:4, 4:2, szuper tie-break 8:10"]);
  });

  it("scheduling stops once a result is recorded", async () => {
    const { id, rec, opp } = setup();
    await R.resultStep(rec, id, { kind: "record", score: score(WIN) }, PLAYED);
    const page = (await M.matchPage(id, opp, PLAYED))!;
    expect(page.actions).toEqual({ propose: false, recordAgreed: false, accept: [], confirm: false, decline: false, venue: false, cancel: false });
    expect(await M.matchStep(opp, id, { kind: "propose", slots: SLOTS, clubId: null }, NOW)).toEqual({
      ok: false,
      error: "A meccs eredménye már rögzítve van, itt már nem lehet egyeztetni.",
    });
  });

  it("the recorder can correct while it waits; the other pair can't record over it", async () => {
    const { id, rec, recPartner, opp } = setup();
    await R.resultStep(rec, id, { kind: "record", score: score(WIN) }, PLAYED);
    expect(await R.resultStep(opp, id, { kind: "record", score: score([[1, 4], [1, 4]]) }, PLAYED)).toEqual({
      ok: false,
      error: "Ezt most nem lehet. Frissítsd az oldalt.",
    });
    const fixed = score([[4, 1], [5, 3]]);
    expect(await R.resultStep(recPartner, id, { kind: "record", score: fixed }, new Date(PLAYED.getTime() + HOUR))).toEqual({
      ok: true,
      notice: "Javítottuk. A másik pár megerősíti.",
    });
    const page = (await M.matchPage(id, opp, PLAYED))!;
    expect(page.result).toMatchObject({ status: "recorded", score: fixed });
    expect(page.autoAcceptAt).toEqual(new Date(PLAYED.getTime() + 49 * HOUR));
  });

  it("nobody outside the two pairs can record, confirm or dispute", async () => {
    const { id, rec } = setup();
    for (const user of ["x", "p2a", "o"])
      expect(await R.resultStep(user, id, { kind: "record", score: score(WIN) }, PLAYED)).toEqual({ ok: false, error: "Nincs ilyen meccs." });
    await R.resultStep(rec, id, { kind: "record", score: score(WIN) }, PLAYED);
    expect(await R.resultStep("p2a", id, { kind: "confirm" }, PLAYED)).toEqual({ ok: false, error: "Nincs ilyen meccs." });
    expect(await R.resultStep(rec, 9999, { kind: "confirm" }, PLAYED)).toEqual({ ok: false, error: "Nincs ilyen meccs." });
  });
});

describe("confirming a result (#28)", () => {
  beforeEach(freshDb);

  it("the other pair confirms: final for both, both pairs told (digest kind)", async () => {
    const { id, a, b, rec, recPartner, opp, oppPartner } = setup();
    const s = score(WIN);
    await R.resultStep(rec, id, { kind: "record", score: s }, PLAYED);
    h.raw.exec("delete from notifications");
    expect(await R.resultStep(rec, id, { kind: "confirm" }, PLAYED)).toEqual({ ok: false, error: "Ezt most nem lehet. Frissítsd az oldalt." });
    expect(await R.resultStep(oppPartner, id, { kind: "confirm" }, PLAYED)).toEqual({ ok: true, notice: "Megerősítetted, az eredmény végleges." });

    expect(matchRow(id)).toMatchObject({ status: "final", outcome: JSON.stringify({ kind: "played", score: s }) });
    expect(resultEvents(id).map((e: any) => [e.kind, e.pair_id, e.user_id])).toEqual([
      ["result_recorded", a, rec],
      ["result_confirmed", b, oppPartner],
    ]);
    expect(
      inbox()
        .map((n: any) => [n.kind, n.user])
        .sort(),
    ).toEqual([rec, recPartner, opp, oppPartner].map((u) => ["match_result_confirmed", u]).sort());
    // Played for both pairs, on the page and on Kezdőlap.
    for (const u of [rec, opp]) {
      const page = (await M.matchPage(id, u, PLAYED))!;
      expect(page.result).toMatchObject({ status: "final", how: "confirmed" });
      expect(page.resultActions).toEqual({ record: false, confirm: false, dispute: false });
      const home = (await M.currentGroups(u, PLAYED)).flatMap((g) => g.matches).find((m) => m.id === id)!;
      expect(home.result).toMatchObject({ status: "final", outcome: { kind: "played", score: s } });
    }
    // No instant email for the confirmation.
    expect(h.mails.filter((m) => m.kind !== "match_result")).toEqual([]);
  });
});

describe("disputing a result (#28)", () => {
  beforeEach(freshDb);

  it("the other pair disputes with its own version: it doesn't count, the organizer decides", async () => {
    const { id, b, rec, opp } = setup();
    await R.resultStep(rec, id, { kind: "record", score: score(WIN) }, PLAYED);
    h.raw.exec("delete from notifications");
    h.mails = [];
    // The same score is a confirmation, not a dispute; an invalid one is refused.
    expect(await R.resultStep(opp, id, { kind: "dispute", score: score(WIN), note: "" }, PLAYED)).toEqual({
      ok: false,
      error: "Ez ugyanaz az eredmény, amit rögzítettek: erősítsd meg inkább.",
    });
    expect(await R.resultStep(opp, id, { kind: "dispute", score: score([[3, 4], [4, 0]]), note: "" }, PLAYED)).toMatchObject({ ok: false });
    expect(await R.resultStep(opp, id, { kind: "dispute", score: score([[1, 4], [1, 4]]), note: "x".repeat(301) }, PLAYED)).toEqual({
      ok: false,
      error: "A megjegyzés legfeljebb 300 karakter legyen.",
    });

    const theirs = score([[1, 4], [1, 4]]);
    expect(await R.resultStep(opp, id, { kind: "dispute", score: theirs, note: "  Fordítva volt.  " }, PLAYED)).toEqual({
      ok: true,
      notice: "Jeleztük a szervezőnek, ő dönt.",
    });
    expect(matchRow(id)).toMatchObject({ status: "disputed", outcome: null });
    expect(resultEvents(id)[1]).toEqual({ kind: "result_disputed", pair_id: b, user_id: opp, score: JSON.stringify(theirs), note: "Fordítva volt." });
    const page = (await M.matchPage(id, rec, PLAYED))!;
    expect(page.result).toMatchObject({ status: "disputed", counter: theirs });
    expect(page.resultActions).toEqual({ record: false, confirm: false, dispute: false });
    expect(page.log.at(-1)!.text).toBe("Vitatta az eredményt, ezt írta be helyette: 1:4, 1:4. Megjegyzés: Fordítva volt.");
    // Told at once (#178): the recording pair and the organizers, app only, no mail.
    expect(h.mails).toEqual([]);
    expect(await R.autoAcceptResults(new Date(PLAYED.getTime() + 100 * HOUR))).toBe(0);
    expect(matchRow(id).status).toBe("disputed");
  });

  it("tells the recording pair and the organizers at once, never by email (#178)", async () => {
    const { id, rec, recPartner, opp, oppPartner } = setup();
    // Szervező 'o', a second one who switched the kind off, an Admin who is
    // also a Szervező (once), another Admin, a deleted Szervező, and the
    // Szervező of another league (nothing).
    h.raw.exec(`insert into users (id, email, name, level, consent_at, platform_role) values
      ('adm', 'adm@x.hu', 'Admin', 'halado', 1, 'superadmin'), ('adm2', 'adm2@x.hu', 'Admin 2', 'halado', 1, 'superadmin'),
      ('o2', 'o2@x.hu', 'Org 2', 'halado', 1, 'player'), ('o3', 'o3@x.hu', 'Org 3', 'halado', 1, 'player'), ('o4', 'o4@x.hu', 'Org 4', 'halado', 1, 'player')`);
    h.raw.exec(`update users set deleted_at = 1 where id = 'o3'`);
    h.raw.exec(`insert into leagues (id, city, slug, name) values (2, 'pecs', 'pecs', 'Padelpárbaj Pécs')`);
    h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'o'), (1, 'o2'), (1, 'adm'), (1, 'o3'), (2, 'o4')`);
    h.raw.exec(`insert into notification_opt_outs (user_id, kind) values ('o2', 'result_disputed')`);
    await R.resultStep(rec, id, { kind: "record", score: score(WIN) }, PLAYED);
    h.raw.exec("delete from notifications");
    h.mails = [];

    await R.resultStep(opp, id, { kind: "dispute", score: score([[1, 4], [1, 4]]), note: "" }, PLAYED);

    const decide = `/admin/leagues/gyor/matches/${id}/decide`;
    const rows = all("select user_id, kind, title, body, url from notifications order by kind, user_id");
    expect(rows.map((r: any) => [r.user_id, r.kind, r.url])).toEqual([
      [rec, "match_result_disputed", `/matches/${id}`],
      [recPartner, "match_result_disputed", `/matches/${id}`],
      ["adm", "result_disputed", decide],
      ["adm2", "result_disputed", decide],
      ["o", "result_disputed", decide],
    ]);
    // The disputing pair gets nothing; no names, contacts or scores in any text.
    expect(rows.some((r: any) => r.user_id === opp || r.user_id === oppPartner)).toBe(false);
    expect(JSON.stringify(rows)).not.toMatch(/Játékos|@|\+36|[0-9]:[0-9]/);
    expect(h.mails).toEqual([]);
    expect(all("select 1 from email_messages")).toEqual([]);
  });

  it("a Szervező or Admin who disputes gets no notice about their own dispute; the other organizers do (#221)", async () => {
    const { id, rec, opp } = setup();
    // The disputing player is a Szervező of the league and an Admin; 'o' is
    // another Szervező, 'adm' another Admin.
    h.raw.exec(`insert into users (id, email, name, level, consent_at, platform_role) values ('adm', 'adm@x.hu', 'Admin', 'halado', 1, 'superadmin')`);
    h.raw.exec(`update users set platform_role = 'superadmin' where id = '${opp}'`);
    h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'o'), (1, '${opp}')`);
    await R.resultStep(rec, id, { kind: "record", score: score(WIN) }, PLAYED);
    h.raw.exec("delete from notifications");

    await R.resultStep(opp, id, { kind: "dispute", score: score([[1, 4], [1, 4]]), note: "" }, PLAYED);

    const told = all("select user_id from notifications where kind = 'result_disputed' order by user_id").map((r: any) => r.user_id);
    expect(told).toEqual(["adm", "o"]);
  });

  it("a failed notice never undoes the dispute", async () => {
    const { id, rec, opp } = setup();
    h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'o')`);
    await R.resultStep(rec, id, { kind: "record", score: score(WIN) }, PLAYED);
    h.raw.exec("delete from notifications");
    h.raw.exec("drop table notification_opt_outs");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await R.resultStep(opp, id, { kind: "dispute", score: score([[1, 4], [1, 4]]), note: "" }, PLAYED)).toMatchObject({ ok: true });
    spy.mockRestore();
    expect(matchRow(id).status).toBe("disputed");
  });
});

describe("auto-accept after 48 hours (#28)", () => {
  beforeEach(freshDb);

  it("not before 48 hours, then on the next run; both pairs told; only once", async () => {
    const { id, rec, recPartner, opp, oppPartner } = setup();
    const s = score([[5, 4], [4, 2]]);
    await R.resultStep(rec, id, { kind: "record", score: s }, PLAYED);
    h.raw.exec("delete from notifications");

    expect(await R.autoAcceptResults(new Date(PLAYED.getTime() + 48 * HOUR - 60_000))).toBe(0);
    expect(matchRow(id).status).toBe("result_pending");

    const run = new Date(PLAYED.getTime() + 48 * HOUR + 15 * 60_000);
    expect(await R.autoAcceptResults(run)).toBe(1);
    expect(matchRow(id)).toMatchObject({ status: "final", outcome: JSON.stringify({ kind: "played", score: s }) });
    expect(decisions(id)).toEqual([{ kind: "auto_accepted", user_id: null, outcome: JSON.stringify({ kind: "played", score: s }), reason: null }]);
    expect(
      inbox()
        .map((n: any) => [n.kind, n.user])
        .sort(),
    ).toEqual([rec, recPartner, opp, oppPartner].map((u) => ["match_result_confirmed", u]).sort());
    const page = (await M.matchPage(id, opp, run))!;
    expect(page.result).toMatchObject({ status: "final", how: "auto_accepted" });
    expect(page.log.at(-1)).toMatchObject({ who: "Padelpárbaj", by: "auto", text: "48 óra után magától elfogadtuk az eredményt" });

    expect(await R.autoAcceptResults(new Date(run.getTime() + HOUR))).toBe(0);
    expect(decisions(id)).toHaveLength(1);
  });

  it("the in-app items carry the run's scheduled time, not the database clock (#222, #188)", async () => {
    const { id, rec } = setup();
    await R.resultStep(rec, id, { kind: "record", score: score([[5, 4], [4, 2]]) }, PLAYED);
    h.raw.exec("delete from notifications");
    const run = new Date(PLAYED.getTime() + 49 * HOUR);
    expect(await R.autoAcceptResults(run)).toBe(1);
    const rows = h.raw.prepare("select created_at as at, push_due_at as due from notifications").all();
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r).toEqual({ at: run.getTime() / 1000, due: run.getTime() / 1000 });
    // So do its decision and its audit entry (#225).
    expect(h.raw.prepare("select at from match_decisions where match_id = ?").all(id)).toEqual([{ at: run.getTime() / 1000 }]);
    expect(h.raw.prepare("select at from audit_log where action = 'result.auto_accept'").all()).toEqual([{ at: run.getTime() / 1000 }]);
  });

  it("a confirmed result is never auto-accepted again; several due results go in one run", async () => {
    const first = setup();
    const second = matchOf(2, 4);
    const secondRec = `p${matchRow(second).pair_a}a`;
    await R.resultStep(first.rec, first.id, { kind: "record", score: score(WIN) }, PLAYED);
    await R.resultStep(first.opp, first.id, { kind: "confirm" }, PLAYED);
    await R.resultStep(secondRec, second, { kind: "record", score: score(WIN) }, PLAYED);
    const third = matchOf(1, 4);
    await R.resultStep(`p${matchRow(third).pair_a}a`, third, { kind: "record", score: score(WIN) }, PLAYED);
    expect(await R.autoAcceptResults(new Date(PLAYED.getTime() + 49 * HOUR))).toBe(2);
    expect(decisions(first.id)).toEqual([]);
    expect([matchRow(second).status, matchRow(third).status]).toEqual(["final", "final"]);
  });

  it("more waiting results than one D1 statement can bind: the due ones are accepted", async () => {
    const ids = addManyMatches(h.raw, DEADLINE);
    for (const id of ids) recordOn(h.raw, id, score(WIN), PLAYED);
    const late = new Date(PLAYED.getTime() + 50 * HOUR);
    expect(await R.autoAcceptResults(late, MANY)).toBe(MANY);
    expect(all("select count(*) as n from matches where status = 'final'")[0].n).toBe(MANY);
  });

  it("at most the batch size per run; the rest on the next", async () => {
    const ids = [matchOf(1, 3), matchOf(2, 4), matchOf(1, 4)];
    for (const id of ids) await R.resultStep(`p${matchRow(id).pair_a}a`, id, { kind: "record", score: score(WIN) }, PLAYED);
    const late = new Date(PLAYED.getTime() + 50 * HOUR);
    expect(await R.autoAcceptResults(late, 2)).toBe(2);
    expect(await R.autoAcceptResults(late, 2)).toBe(1);
  });
});

void flip;
