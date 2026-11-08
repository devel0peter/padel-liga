// season-entries.server.ts (and the dissolve's withdrawal, D19) on a real
// SQLite with every migration applied (~/test/sqlite). Email is stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

// No VAPID keys: notifications are stored, not pushed.
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({ listedCities: async () => [{ slug: "gyor" }] }));
vi.mock("~/lib/email/outbox.server", () => ({
  queueSeasonEntered: async (to: string, input: any) => h.mails.push({ kind: "entered", toEmail: to, ...input }),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const E = await import("~/lib/season-entries.server");
const P = await import("~/lib/pairs.server");
const S = await import("~/lib/seasons.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (iso: string) => new Date(iso);

// The first season: registration 2–5 Nov, phases from 9 Nov (Budapest, UTC+1).
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const DURING_REGISTRATION = at("2026-11-03T12:00:00Z");
const IN_PHASE_1 = at("2026-11-10T12:00:00Z");
const IN_PHASE_4 = at("2027-01-26T12:00:00Z");

function freshDb() {
  h.raw = migratedDatabase();
  h.mails = [];
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('deb', 'Debrecen', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'deb', 'deb', 'Padelpárbaj Debrecen')`);
  for (const [id, name, level] of [
    ["a", "Anna", "halado"],
    ["b", "Béla", "kezdo"],
    ["c", "Cecil", "kozephalado"],
    ["d", "Dóra", null],
    ["o", "Org", "versenyzo"],
  ])
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, ?, 1)").run(id, `${id}@x.hu`, name, level);
  // Pair 1: Anna + Béla in Győr. Pair 2: Cecil + Dóra (no level) in Győr.
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (1, 1, 'a', 'b'), (2, 1, 'c', 'd')`);
  addSeason(1, 1, "2026/27 tél");
}

function addSeason(id: number, leagueId: number, name: string) {
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (?, ?, ?, ?, ?, '2026-11-09')",
    )
    .run(id, leagueId, name, sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  PHASES.forEach((start, i) =>
    h.raw
      .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (?, ?, ?, ?)")
      .run(id, i + 1, sec(start), sec(start) + 21 * 86400 - 60),
  );
}

const user = (id: string, level: string | null = "halado") => ({ id, email: `${id}@x.hu`, name: id.toUpperCase(), level }) as any;
const one = (q: string) => h.raw.prepare(q).get();
const all = (q: string) => h.raw.prepare(q).all();
const entry = () => one("select id, status, note, joins_phase, decided_by from season_entries");

describe("season entries on real SQLite", () => {
  beforeEach(freshDb);

  it("#153: Nevezünk enters the pair at once for phase 1; both players get the notice and the email", async () => {
    expect(await E.applyToSeason(user("a"), 1, DURING_REGISTRATION)).toEqual({ ok: true, joins: { phase: 1, startsAt: at(PHASES[0]) } });
    expect(entry()).toMatchObject({ status: "approved", joins_phase: 1, note: null, decided_by: null });
    // Both see it.
    const season = (await S.getSeason(1))!;
    for (const id of ["a", "b"])
      expect((await E.entryViews(user(id), [season], DURING_REGISTRATION)).get(1)).toMatchObject({
        kind: "status",
        status: "approved",
        text: "Beneveztetek: az 1. körtől játszotok.",
      });
    expect(h.mails).toEqual([
      expect.objectContaining({ kind: "entered", toEmail: "a@x.hu", to: "Anna", partnerName: "Béla" }),
      expect.objectContaining({ kind: "entered", toEmail: "b@x.hu", to: "Béla", partnerName: "Anna" }),
    ]);
    expect(h.mails[0]).toMatchObject({ league: "Padelpárbaj Győr", season: "2026/27 tél", joins: { phase: 1, startsAt: at(PHASES[0]) } });
    // And both see it on Értesítések (#115).
    expect(all("select user_id, kind, title, url from notifications order by user_id")).toEqual([
      { user_id: "a", kind: "season_entry_decision", title: "Beneveztetek", url: "/profile#parod" },
      { user_id: "b", kind: "season_entry_decision", title: "Beneveztetek", url: "/profile#parod" },
    ]);
    // It counts for the group draft straight away.
    expect(await E.listSeasonEntries(1)).toHaveLength(1);
  });

  it("#153: entered after phase 1 started: joins phase 2", async () => {
    expect(await E.applyToSeason(user("a"), 1, IN_PHASE_1)).toEqual({ ok: true, joins: { phase: 2, startsAt: at(PHASES[1]) } });
    expect(entry()).toMatchObject({ status: "approved", joins_phase: 2 });
    expect(h.mails[0].joins).toEqual({ phase: 2, startsAt: at(PHASES[1]) });
  });

  it("#153: entered once phase 1's groups are published, before it starts: joins phase 2", async () => {
    h.raw.exec(`insert into groups (season_id, phase, number, published_at) values (1, 1, 1, ${sec("2026-11-03T10:00:00Z")})`);
    expect(await E.applyToSeason(user("a"), 1, DURING_REGISTRATION)).toMatchObject({ ok: true, joins: { phase: 2 } });
    expect(entry()).toMatchObject({ status: "approved", joins_phase: 2 });
  });

  it("#35: entered once a later phase's groups are published, before it starts (a break): joins the phase after it", async () => {
    // Phase 3 starts on 4 Jan after the holiday break; its groups went out on 21 Dec.
    h.raw.exec(`insert into groups (season_id, phase, number, published_at) values (1, 3, 1, ${sec("2026-12-21T08:00:00Z")})`);
    expect(await E.applyToSeason(user("a"), 1, new Date("2026-12-28T10:00:00Z"))).toEqual({ ok: true, joins: { phase: 4, startsAt: at(PHASES[3]) } });
    expect(entry()).toMatchObject({ status: "approved", joins_phase: 4 });
  });

  it("a pair can't enter twice, from either player; no second notice", async () => {
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    expect(await E.applyToSeason(user("a"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false, error: expect.stringContaining("már neveztetek") });
    expect(await E.applyToSeason(user("b"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(all("select * from season_entries")).toHaveLength(1);
    expect(h.mails).toHaveLength(2);
  });

  it("two submits at once make one entry", async () => {
    const results = await Promise.all([E.applyToSeason(user("a"), 1, DURING_REGISTRATION), E.applyToSeason(user("b"), 1, DURING_REGISTRATION)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(all("select * from season_entries")).toHaveLength(1);
  });

  it("a pair rejected before #153 can't enter again", async () => {
    h.raw.exec(`insert into season_entries (season_id, pair_id, status, note) values (1, 1, 'rejected', 'Nem.')`);
    expect(await E.applyToSeason(user("a"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(entry()).toMatchObject({ status: "rejected" });
    const season = (await S.getSeason(1))!;
    expect((await E.entryViews(user("a"), [season], DURING_REGISTRATION)).get(1)).toMatchObject({ kind: "status", status: "rejected", note: "Nem." });
  });

  it("can't enter before registration opens or once the last phase started; can enter late", async () => {
    expect(await E.applyToSeason(user("a"), 1, at("2026-10-30T12:00:00Z"))).toMatchObject({ ok: false, error: expect.stringContaining("most nem lehet") });
    expect(await E.applyToSeason(user("a"), 1, at(PHASES[3]))).toMatchObject({ ok: false });
    expect(await E.applyToSeason(user("a"), 1, IN_PHASE_4)).toMatchObject({ ok: false });
    expect(await E.applyToSeason(user("a"), 1, IN_PHASE_1)).toMatchObject({ ok: true });
  });

  it("needs both players' level", async () => {
    expect(await E.applyToSeason(user("c"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false, error: expect.stringContaining("párodnak") });
    expect(await E.applyToSeason(user("d"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false, error: expect.stringContaining("add meg a szinted") });
    expect(all("select * from season_entries")).toHaveLength(0);
    expect(h.mails).toHaveLength(0);
  });

  it("needs an active pair in the season's league", async () => {
    addSeason(2, 2, "Debreceni tél");
    expect(await E.applyToSeason(user("a"), 2, DURING_REGISTRATION)).toMatchObject({ ok: false, error: expect.stringContaining("párban") });
    expect(await E.applyToSeason(user("o"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(await E.applyToSeason(user("a"), 99, DURING_REGISTRATION)).toMatchObject({ ok: false });
  });

  it("D19: dissolving withdraws entries for seasons not started", async () => {
    // withdrawEntries compares with the clock: keep it before phase 1.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(DURING_REGISTRATION);
    try {
      addSeason(2, 1, "Tavasz");
      await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
      await E.applyToSeason(user("a"), 2, DURING_REGISTRATION);
      expect(await P.dissolvePair("o", 1, 1)).toEqual({ ok: true });
      expect(all("select status from season_entries order by season_id")).toEqual([{ status: "withdrawn" }, { status: "withdrawn" }]);
      expect(await E.listSeasonEntries(1)).toHaveLength(0);
      expect(await S.seasonState(1)).toMatchObject({ entries: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("dissolving and re-forming the pair doesn't get round a rejection", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(DURING_REGISTRATION);
    try {
      h.raw.exec(`insert into season_entries (season_id, pair_id, status, note) values (1, 1, 'rejected', 'Nem.')`);
      await P.dissolvePair("o", 1, 1);
      h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (3, 1, 'b', 'a')`);
      expect(await E.applyToSeason(user("b"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false, error: expect.stringContaining("már neveztetek") });
      expect(all("select * from season_entries")).toHaveLength(1);
      // With someone else it's a new pair: it may enter.
      h.raw.exec(`update pairs set status = 'dissolved' where id = 3`);
      h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (4, 1, 'a', 'o')`);
      expect(await E.applyToSeason(user("a"), 1, DURING_REGISTRATION)).toMatchObject({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a season with an entry can't be deleted; with only withdrawn ones it can", async () => {
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    expect(await S.deleteSeason(1, "o")).toBe(false);
    expect(one("select count(*) as n from seasons").n).toBe(1);
    h.raw.exec(`update season_entries set status = 'withdrawn'`);
    expect(await S.deleteSeason(1, "o")).toBe(true);
    expect(one("select count(*) as n from season_entries").n).toBe(0);
  });

  it("D19: an entry the pair already plays in stays; a rejected one stays rejected", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      addSeason(2, 1, "Tavasz");
      vi.setSystemTime(DURING_REGISTRATION);
      await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
      h.raw.exec(`insert into season_entries (season_id, pair_id, status) values (2, 1, 'rejected')`);
      // Between phase 1 and 2 (the pair isn't in a running group: no groups yet).
      vi.setSystemTime(at("2026-11-30T12:00:00Z"));
      expect(await P.dissolvePair("o", 1, 1)).toEqual({ ok: true });
      expect(all("select status from season_entries order by season_id")).toEqual([{ status: "approved" }, { status: "rejected" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("D19: entered in phase 1 to join phase 2, dissolved before phase 2: withdrawn", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(IN_PHASE_1);
      await E.applyToSeason(user("a"), 1, IN_PHASE_1);
      await P.dissolvePair("o", 1, 1);
      expect(entry()).toMatchObject({ status: "withdrawn" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("the organizer's list: entered pairs with names, levels and the average starting Elo, no contact details; and the counts", async () => {
    h.raw.exec("update users set level = 'kezdo' where id = 'd'");
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    await E.applyToSeason(user("c"), 1, at("2026-11-04T12:00:00Z"));
    const rows = await E.listSeasonEntries(1);
    expect(rows.map((r) => [r.players.map((p) => p.name), r.averageElo, r.joinsPhase])).toEqual([
      [["Anna", "Béla"], 1200, 1],
      [["Cecil", "Dóra"], 1100, 1],
    ]);
    expect(JSON.stringify(rows)).not.toContain("@");
    // Withdrawn and rejected ones are not in the list or the count.
    h.raw.exec(`update season_entries set status = 'withdrawn' where pair_id = 2`);
    expect(await E.listSeasonEntries(1)).toHaveLength(1);
    expect((await E.entryCounts([1, 5])).get(1)).toBe(1);
    expect((await E.entryCounts([1, 5])).get(5)).toBe(0);
  });

  it("shows Nevezünk to a pair that can enter, and why not to one that can't", async () => {
    const season = (await S.getSeason(1))!;
    expect((await E.entryViews(user("a"), [season], DURING_REGISTRATION)).get(1)).toEqual({ kind: "apply", late: false });
    expect((await E.entryViews(user("c"), [season], DURING_REGISTRATION)).get(1)).toMatchObject({ kind: "blocked", reason: "partner_no_level" });
    expect((await E.entryViews(user("o"), [season], DURING_REGISTRATION)).get(1)).toMatchObject({ kind: "blocked", reason: "no_pair" });
    expect((await E.entryViews(user("a"), [season], at("2026-10-01T12:00:00Z"))).has(1)).toBe(false);
  });
});

describe("#154: the organizer enters a pair or takes it out, from Párok", () => {
  beforeEach(freshDb);
  const org = { id: "o" };

  it("enters a pair without an entry, like Nevezünk: entered for round 1, in the draft, notice in the app, no email", async () => {
    expect(await E.enterPairByOrganizer(org, 1, 1, 1, DURING_REGISTRATION)).toEqual({ ok: true, joins: { phase: 1, startsAt: at(PHASES[0]) } });
    expect(entry()).toMatchObject({ status: "approved", joins_phase: 1, decided_by: "o" });
    expect(await E.listSeasonEntries(1)).toHaveLength(1);
    expect(h.mails).toEqual([]);
    expect(all("select user_id, kind, title from notifications order by user_id")).toEqual([
      { user_id: "a", kind: "season_entry_decision", title: "A szervező benevezett titeket" },
      { user_id: "b", kind: "season_entry_decision", title: "A szervező benevezett titeket" },
    ]);
    expect(one("select actor_id, action, target, detail from audit_log")).toEqual({
      actor_id: "o",
      action: "season_entry.enter",
      target: `season_entry:${entry().id}`,
      detail: "pair:1",
    });
    // The players see it in Párod too.
    const season = (await S.getSeason(1))!;
    expect((await E.entryViews(user("a"), [season], DURING_REGISTRATION)).get(1)).toMatchObject({ kind: "status", status: "approved" });
  });

  it("uses the same joining rules: after phase 1 started, round 2", async () => {
    expect(await E.enterPairByOrganizer(org, 1, 1, 1, IN_PHASE_1)).toMatchObject({ ok: true, joins: { phase: 2 } });
    expect(entry()).toMatchObject({ joins_phase: 2 });
  });

  it("refuses a pair where a player has no level, naming them, in Hungarian", async () => {
    expect(await E.enterPairByOrganizer(org, 1, 2, 1, DURING_REGISTRATION)).toEqual({
      ok: false,
      error: "Dóra még nem adta meg a szintjét a profiljában, ezért a pár nem nevezhető.",
    });
    expect(all("select * from season_entries")).toHaveLength(0);
    expect(all("select * from notifications")).toHaveLength(0);
  });

  it("refuses a pair already entered, a closed season, a dissolved pair, another league's pair or season", async () => {
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    expect(await E.enterPairByOrganizer(org, 1, 1, 1, DURING_REGISTRATION)).toMatchObject({ ok: false, error: expect.stringContaining("már nevezett") });
    h.raw.exec("update users set level = 'kezdo' where id = 'd'");
    expect(await E.enterPairByOrganizer(org, 1, 2, 1, at(PHASES[3]))).toMatchObject({ ok: false, error: expect.stringContaining("most nem lehet") });
    addSeason(2, 2, "Debreceni tél");
    // Pair 2 is in Győr (league 1): not through Debrecen, and not into Debrecen's season.
    expect(await E.enterPairByOrganizer(org, 2, 2, 2, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(await E.enterPairByOrganizer(org, 1, 2, 2, DURING_REGISTRATION)).toMatchObject({ ok: false, error: "Nincs ilyen szezon." });
    h.raw.exec("update pairs set status = 'dissolved' where id = 2");
    expect(await E.enterPairByOrganizer(org, 1, 2, 1, DURING_REGISTRATION)).toMatchObject({ ok: false, error: expect.stringContaining("nem aktív") });
    expect(all("select pair_id from season_entries")).toEqual([{ pair_id: 1 }]);
  });

  it("takes an entered pair out before round 1's groups: out of the list and the draft, notice in the app, no email; the pair stays", async () => {
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    h.mails = [];
    h.raw.exec("delete from notifications");
    expect(await E.removePairFromSeason(org, 1, 1, 1, DURING_REGISTRATION)).toEqual({ ok: true });
    expect(entry()).toMatchObject({ status: "withdrawn", decided_by: "o" });
    expect(await E.listSeasonEntries(1)).toHaveLength(0);
    expect(one("select status from pairs where id = 1")).toEqual({ status: "active" });
    expect(h.mails).toEqual([]);
    expect(all("select user_id, title from notifications order by user_id")).toEqual([
      { user_id: "a", title: "A szervező kivett titeket a szezonból" },
      { user_id: "b", title: "A szervező kivett titeket a szezonból" },
    ]);
    expect(one("select action, detail from audit_log where action = 'season_entry.remove'")).toEqual({ action: "season_entry.remove", detail: "pair:1" });
    // Twice: nothing left to take out.
    expect(await E.removePairFromSeason(org, 1, 1, 1, DURING_REGISTRATION)).toMatchObject({ ok: false });
  });

  it("can enter a removed pair again, with the joining phase worked out then", async () => {
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    await E.removePairFromSeason(org, 1, 1, 1, DURING_REGISTRATION);
    expect(await E.enterPairByOrganizer(org, 1, 1, 1, IN_PHASE_1)).toMatchObject({ ok: true, joins: { phase: 2 } });
    expect(all("select status, joins_phase from season_entries")).toEqual([{ status: "approved", joins_phase: 2 }]);
  });

  it("refuses to take out a pair that plays in a running phase, with the reason; between phases it may", async () => {
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    h.raw.exec(`insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, ${sec("2026-11-07T10:00:00Z")})`);
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1)`);
    expect(await E.removePairFromSeason(org, 1, 1, 1, IN_PHASE_1)).toEqual({
      ok: false,
      error: expect.stringContaining("már kihirdetett csoportja van"),
    });
    expect(entry()).toMatchObject({ status: "approved" });
    // After phase 1's deadline: between phases.
    expect(await E.removePairFromSeason(org, 1, 1, 1, at("2026-11-30T12:00:00Z"))).toEqual({ ok: true });
  });

  it("D88: before the phase starts, a pair in a published group can't be taken out, but can be withdrawn", async () => {
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    h.raw.exec(`insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, ${sec("2026-11-07T10:00:00Z")})`);
    h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1)`);
    // Published on 7 Nov, round 1 starts on 9 Nov (PHASES[0] is 23:00 UTC on 8 Nov).
    const BEFORE_START = at("2026-11-08T12:00:00Z");
    expect(BEFORE_START.getTime()).toBeLessThan(at(PHASES[0]).getTime());
    expect(await E.removePairFromSeason(org, 1, 1, 1, BEFORE_START)).toEqual({
      ok: false,
      error: expect.stringContaining("már kihirdetett csoportja van"),
    });
    expect(entry()).toMatchObject({ status: "approved" });
    expect(await E.withdrawPairMidPhase(org, 1, 1, 1, "Sérülés", BEFORE_START)).toEqual({ ok: true });
    expect(entry()).toMatchObject({ status: "withdrawn" });
    expect(one("select withdrawal_reason from group_pairs where pair_id = 1")).toEqual({ withdrawal_reason: "Sérülés" });
  });

  it("refuses another league's season or pair", async () => {
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    addSeason(2, 2, "Debreceni tél");
    expect(await E.removePairFromSeason(org, 2, 1, 1, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(await E.removePairFromSeason(org, 2, 1, 2, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(entry()).toMatchObject({ status: "approved" });
  });
});
