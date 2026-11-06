// A league's first season starts by itself at the minimum entries (D124,
// #335), on a real SQLite with every migration applied (~/test/sqlite).
// Email is stubbed; in-app notices are stored as in the app.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

// No VAPID keys: notifications are stored, not pushed.
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueSeasonEntered: async (to: string, input: any) => h.mails.push({ kind: "entered", toEmail: to, ...input }),
  queueSeasonStart: async (messages: any[]) => {
    for (const m of messages) h.mails.push({ kind: "season_start", toEmail: m.toEmail, ...m.input });
  },
}));

const { applyMigrations, migratedDatabase } = await import("~/test/sqlite");
const E = await import("~/lib/season-entries.server");
const P = await import("~/lib/pairs.server");
const S = await import("~/lib/seasons.server");
const ST = await import("~/lib/season-start.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
// Monday 16 Nov 2026, 12:00 Budapest; Tuesday 17 Nov the same time.
const MONDAY = new Date("2026-11-16T11:00:00Z");
const TUESDAY = new Date("2026-11-17T11:00:00Z");
const OPENED = new Date("2026-11-10T09:00:00Z");

const org = { id: "o" };
const user = (id: string) => ({ id, email: `${id}@x.hu`, name: id.toUpperCase(), level: "halado" }) as any;
const one = (q: string) => h.raw.prepare(q).get();
const all = (q: string) => h.raw.prepare(q).all();
const season = () => one("select first_phase_start, registration_closes_at, start_fixed_at from seasons where id = 1");
const phases = () => all("select number, starts_at, deadline from season_phases where season_id = 1 order by number");
const mails = (kind: string) => h.mails.filter((m) => m.kind === kind);

// Four pairs in a new league (minimum 3 here, to keep it short): pair n is
// players n1 and n2.
async function freshDb() {
  h.raw = migratedDatabase();
  h.mails = [];
  h.raw.exec(`insert into cities (slug, name, listed) values ('uj', 'Újváros', 1)`);
  h.raw.exec(`insert into leagues (id, city, slug, name, min_entries) values (1, 'uj', 'uj', 'Padelpárbaj Újváros', 3)`);
  const add = h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, 'halado', 1)");
  add.run("o", "o@x.hu", "Org");
  for (const n of [1, 2, 3, 4]) {
    add.run(`p${n}a`, `p${n}a@x.hu`, `Játékos ${n}A`);
    add.run(`p${n}b`, `p${n}b@x.hu`, `Játékos ${n}B`);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (${n}, 1, 'p${n}a', 'p${n}b')`);
  }
  expect(await S.createWaitingSeason(1, { name: "Első szezon", breaks: [] }, "o", OPENED)).toBe(true);
}

describe("a first season waiting for its minimum entries (D124, #335)", () => {
  beforeEach(freshDb);

  it("opens with no deadline, start or phases, and takes entries for round 1 at once", async () => {
    const s = (await S.getSeason(1))!;
    expect(s).toMatchObject({ firstPhaseStart: null, registrationClosesAt: null, phases: [], startsAtMinimum: true, startFixedAt: null });
    expect(s.registrationOpensAt).toEqual(OPENED);
    expect(await E.applyToSeason(user("p1a"), 1, MONDAY)).toEqual({ ok: true, joins: { phase: 1, startsAt: null } });
    expect(one("select joins_phase, status from season_entries")).toEqual({ joins_phase: 1, status: "approved" });
    // The pair's own notice says the start comes later.
    expect(mails("entered")).toHaveLength(2);
    expect(mails("entered")[0].joins).toEqual({ phase: 1, startsAt: null });
    expect(one("select body from notifications where user_id = 'p1a'").body).toContain("akkor indul, ha elég pár nevezett");
  });

  it("one entry below the minimum: no start date, no start notice", async () => {
    await E.applyToSeason(user("p1a"), 1, MONDAY);
    await E.applyToSeason(user("p2a"), 1, MONDAY);
    expect(season()).toMatchObject({ first_phase_start: "", start_fixed_at: null });
    expect(phases()).toEqual([]);
    expect(mails("season_start")).toEqual([]);
    expect(all("select * from notifications where kind = 'season_start'")).toEqual([]);
  });

  it("the entry that reaches it on a Monday fixes the start a week later; every entered player gets one email and one notice", async () => {
    await E.applyToSeason(user("p1a"), 1, MONDAY);
    await E.applyToSeason(user("p2b"), 1, MONDAY);
    h.mails = [];
    const third = await E.applyToSeason(user("p3a"), 1, MONDAY);
    // Monday 23 Nov, 00:00 Budapest.
    expect(third).toEqual({ ok: true, joins: { phase: 1, startsAt: new Date("2026-11-22T23:00:00Z") } });
    expect(season()).toEqual({
      first_phase_start: "2026-11-23",
      // The night before round 1, 23:59 Budapest.
      registration_closes_at: sec("2026-11-22T22:59:00Z"),
      start_fixed_at: sec(MONDAY.toISOString()),
    });
    expect(phases().map((p: any) => p.number)).toEqual([1, 2, 3, 4]);
    expect(phases()[0]).toEqual({ number: 1, starts_at: sec("2026-11-22T23:00:00Z"), deadline: sec("2026-12-13T22:59:00Z") });
    const s = (await S.getSeason(1))!;
    expect(s.firstPhaseStart).toBe("2026-11-23");
    expect(s.startFixedAt).toEqual(MONDAY);

    // Exactly one email and one in-app notice per entered player, the third
    // pair included (no separate entry notice for it).
    const players = ["p1a", "p1b", "p2a", "p2b", "p3a", "p3b"];
    expect(h.mails.map((m) => [m.kind, m.toEmail]).sort()).toEqual(players.map((p) => ["season_start", `${p}@x.hu`]));
    expect(h.mails[0]).toMatchObject({ league: "Padelpárbaj Újváros", season: "Első szezon", start: new Date("2026-11-22T23:00:00Z") });
    const notices = all("select user_id, kind, title from notifications where kind = 'season_start' order by user_id");
    expect(notices).toEqual(players.map((p) => ({ user_id: p, kind: "season_start", title: "Indul a szezon" })));
    expect(all("select * from notifications where user_id like 'p3%' and kind <> 'season_start'")).toEqual([]);
  });

  it("reached on a Tuesday: the Monday 13 days later", async () => {
    for (const p of ["p1a", "p2a", "p3a"]) await E.applyToSeason(user(p), 1, TUESDAY);
    expect(season()).toMatchObject({ first_phase_start: "2026-11-30" });
  });

  it("a break covering that Monday moves the start after it", async () => {
    h.raw.exec(`update seasons set breaks = '[{"start":"2026-11-23","end":"2026-11-29"}]' where id = 1`);
    for (const p of ["p1a", "p2a", "p3a"]) await E.applyToSeason(user(p), 1, MONDAY);
    expect(season()).toMatchObject({ first_phase_start: "2026-11-30" });
  });

  it("once fixed, the date stays when entries drop below the minimum, and later entries just join round 1", async () => {
    for (const p of ["p1a", "p2a", "p3a"]) await E.applyToSeason(user(p), 1, MONDAY);
    const fixed = season();
    // A pair taken out and another dissolved: 1 entry left.
    expect(await E.removePairFromSeason(org, 1, 1, 1, TUESDAY)).toEqual({ ok: true });
    expect(await P.dissolvePair("o", 1, 2, TUESDAY)).toEqual({ ok: true });
    expect(one("select count(*) n from season_entries where status = 'approved'").n).toBe(1);
    expect(season()).toEqual(fixed);
    // A new entry: round 1 with the fixed date, its own notice, no second start notice.
    h.mails = [];
    expect(await E.applyToSeason(user("p4a"), 1, TUESDAY)).toEqual({ ok: true, joins: { phase: 1, startsAt: new Date("2026-11-22T23:00:00Z") } });
    expect(mails("season_start")).toEqual([]);
    expect(mails("entered")).toHaveLength(2);
    expect(season()).toEqual(fixed);
  });

  it("dissolving a pair withdraws its entry in a waiting season", async () => {
    await E.applyToSeason(user("p1a"), 1, MONDAY);
    expect(await P.dissolvePair("o", 1, 1, MONDAY)).toEqual({ ok: true });
    expect(one("select status from season_entries")).toEqual({ status: "withdrawn" });
  });

  it("the organizer's Benevezés that reaches the minimum fixes the start too", async () => {
    await E.applyToSeason(user("p1a"), 1, MONDAY);
    await E.applyToSeason(user("p2a"), 1, MONDAY);
    expect(await E.enterPairByOrganizer(org, 1, 3, 1, MONDAY)).toMatchObject({ ok: true, joins: { phase: 1 } });
    expect(season()).toMatchObject({ first_phase_start: "2026-11-23" });
    expect(all("select count(*) n from notifications where kind = 'season_start'")[0].n).toBe(6);
  });

  it("two entries at once both counted: the start is fixed once", async () => {
    await E.applyToSeason(user("p1a"), 1, MONDAY);
    h.mails = [];
    await Promise.all([E.applyToSeason(user("p2a"), 1, MONDAY), E.applyToSeason(user("p3a"), 1, MONDAY)]);
    expect(season()).toMatchObject({ first_phase_start: "2026-11-23" });
    expect(phases()).toHaveLength(4);
    expect(mails("season_start")).toHaveLength(6);
    expect(all("select count(*) n from notifications where kind = 'season_start'")[0].n).toBe(6);
  });

  it("the minimum: changed while waiting (audited), a minimum already reached starts it, locked afterwards", async () => {
    await E.applyToSeason(user("p1a"), 1, MONDAY);
    await E.applyToSeason(user("p2a"), 1, MONDAY);
    expect(await ST.setMinEntries(org, 1, 5, MONDAY)).toEqual({ ok: true, started: false });
    expect(one("select min_entries from leagues").min_entries).toBe(5);
    expect(all("select action, target, detail, league_id from audit_log where action = 'league.min_entries'")).toEqual([
      { action: "league.min_entries", target: "league:1", detail: "5", league_id: 1 },
    ]);
    await E.applyToSeason(user("p3a"), 1, MONDAY);
    expect(season()).toMatchObject({ start_fixed_at: null });
    // Lowered to the 3 entries there are: the start is fixed now.
    expect(await ST.setMinEntries(org, 1, 3, TUESDAY)).toEqual({ ok: true, started: true });
    expect(season()).toMatchObject({ first_phase_start: "2026-11-30" });
    expect(mails("season_start")).toHaveLength(6);
    expect(await ST.setMinEntries(org, 1, 10, TUESDAY)).toEqual({ ok: false, error: ST.MIN_ENTRIES_LOCKED });
    expect(one("select min_entries from leagues").min_entries).toBe(3);
  });

  it("only a league's first season can wait, and its name and breaks are editable only while it waits", async () => {
    expect(await S.createWaitingSeason(1, { name: "Második", breaks: [] }, "o")).toBe(false);
    expect(all("select id from seasons")).toHaveLength(1);
    expect(await S.updateWaitingSeason(1, { name: "Átnevezve", breaks: [] }, "o")).toBe(true);
    for (const p of ["p1a", "p2a", "p3a"]) await E.applyToSeason(user(p), 1, MONDAY);
    expect(await S.updateWaitingSeason(1, { name: "Késő", breaks: [] }, "o")).toBe(false);
    expect(one("select name from seasons").name).toBe("Átnevezve");
  });
});

describe("migration 0054 on live data", () => {
  it("leaves an existing league and its running season exactly as they were", async () => {
    h.raw = migratedDatabase("0054");
    h.raw.exec(`insert or ignore into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
    h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
    h.raw.exec(
      `insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start, breaks)
       values (1, 1, '2026/27 tél', ${sec("2026-10-28T23:00:00Z")}, ${sec("2026-11-06T22:59:00Z")}, '2026-11-09', '[{"start":"2026-12-21","end":"2027-01-03"}]')`,
    );
    h.raw.exec(`insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, ${sec("2026-11-08T23:00:00Z")}, ${sec("2026-11-29T22:59:00Z")})`);
    const before = one("select * from seasons");
    applyMigrations(h.raw, (f) => f >= "0054");
    expect(one("select min_entries from leagues")).toEqual({ min_entries: 12 });
    expect(one("select * from seasons")).toEqual({ ...before, starts_at_minimum: 0, start_fixed_at: null });
    const s = (await S.getSeason(1))!;
    expect(s).toMatchObject({ firstPhaseStart: "2026-11-09", startsAtMinimum: false, startFixedAt: null });
    expect(s.registrationClosesAt).toEqual(new Date("2026-11-06T22:59:00Z"));
    expect(s.phases).toHaveLength(1);
  });
});
