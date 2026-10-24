// season-entries.server.ts (and the dissolve's withdrawal, D19) on a real
// SQLite with every migration applied (~/test/sqlite). Email is stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({ listedCities: async () => [{ slug: "gyor" }] }));
vi.mock("~/lib/email/outbox.server", () => ({
  queuePairInvite: async () => {},
  queuePairAnswer: async () => {},
  queuePairDissolved: async (to: string, input: any) => h.mails.push({ kind: "dissolved", toEmail: to, ...input }),
  queueSeasonEntryDecision: async (to: string, input: any) => h.mails.push({ kind: "decision", toEmail: to, ...input }),
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
const org = { id: "o" };
const one = (q: string) => h.raw.prepare(q).get();
const all = (q: string) => h.raw.prepare(q).all();
const entry = () => one("select id, status, note, joins_phase, decided_by from season_entries");

describe("season entries on real SQLite", () => {
  beforeEach(freshDb);

  it("a pair applies, the organizer approves, both players get an email", async () => {
    expect(await E.applyToSeason(user("a"), 1, DURING_REGISTRATION)).toEqual({ ok: true });
    expect(entry()).toMatchObject({ status: "pending", joins_phase: null });
    // Both see the status.
    const season = (await S.getSeason(1))!;
    for (const id of ["a", "b"])
      expect((await E.entryViews(user(id), [season], DURING_REGISTRATION)).get(1)).toMatchObject({ kind: "status", status: "pending" });

    expect(await E.decideEntry(org, 1, entry().id, "approve", "Jó játékot!", DURING_REGISTRATION)).toEqual({ ok: true });
    expect(entry()).toMatchObject({ status: "approved", joins_phase: 1, note: "Jó játékot!", decided_by: "o" });
    expect(h.mails).toEqual([
      expect.objectContaining({ kind: "decision", toEmail: "a@x.hu", to: "Anna", partnerName: "Béla", approved: true, note: "Jó játékot!" }),
      expect.objectContaining({ kind: "decision", toEmail: "b@x.hu", to: "Béla", partnerName: "Anna", approved: true }),
    ]);
    expect(h.mails[0]).toMatchObject({ league: "Padelpárbaj Győr", season: "2026/27 tél", joins: { phase: 1, startsAt: at(PHASES[0]) } });
    expect((await E.entryViews(user("b"), [season], DURING_REGISTRATION)).get(1)).toMatchObject({ kind: "status", status: "approved" });
    expect(one("select action, target from audit_log")).toEqual({ action: "season_entry.approve", target: `season_entry:${entry().id}` });
  });

  it("a pair can't apply twice to the same season, from either player", async () => {
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    expect(await E.applyToSeason(user("a"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false, error: expect.stringContaining("már neveztetek") });
    expect(await E.applyToSeason(user("b"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(all("select * from season_entries")).toHaveLength(1);
  });

  it("two submits at once make one entry", async () => {
    const results = await Promise.all([E.applyToSeason(user("a"), 1, DURING_REGISTRATION), E.applyToSeason(user("b"), 1, DURING_REGISTRATION)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(all("select * from season_entries")).toHaveLength(1);
  });

  it("a rejected pair can't apply again", async () => {
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    await E.decideEntry(org, 1, entry().id, "reject", null, DURING_REGISTRATION);
    expect(await E.applyToSeason(user("a"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(entry()).toMatchObject({ status: "rejected" });
  });

  it("can't apply before registration opens or once the last phase started; can apply late", async () => {
    expect(await E.applyToSeason(user("a"), 1, at("2026-10-30T12:00:00Z"))).toMatchObject({ ok: false, error: expect.stringContaining("most nem lehet") });
    expect(await E.applyToSeason(user("a"), 1, at(PHASES[3]))).toMatchObject({ ok: false });
    expect(await E.applyToSeason(user("a"), 1, IN_PHASE_1)).toEqual({ ok: true });
  });

  it("needs both players' level", async () => {
    expect(await E.applyToSeason(user("c"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false, error: expect.stringContaining("párodnak") });
    expect(await E.applyToSeason(user("d"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false, error: expect.stringContaining("add meg a szinted") });
    expect(all("select * from season_entries")).toHaveLength(0);
  });

  it("needs an active pair in the season's league", async () => {
    addSeason(2, 2, "Debreceni tél");
    expect(await E.applyToSeason(user("a"), 2, DURING_REGISTRATION)).toMatchObject({ ok: false, error: expect.stringContaining("párban") });
    expect(await E.applyToSeason(user("o"), 1, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(await E.applyToSeason(user("a"), 99, DURING_REGISTRATION)).toMatchObject({ ok: false });
  });

  it("approved after phase 1 started: joins the next phase; in the last phase: the next season", async () => {
    await E.applyToSeason(user("a"), 1, IN_PHASE_1);
    await E.decideEntry(org, 1, entry().id, "approve", null, IN_PHASE_1);
    expect(entry()).toMatchObject({ joins_phase: 2 });
    expect(h.mails[0].joins).toEqual({ phase: 2, startsAt: at(PHASES[1]) });
    await E.decideEntry(org, 1, entry().id, "reject", null, IN_PHASE_4);
    await E.decideEntry(org, 1, entry().id, "approve", null, IN_PHASE_4);
    expect(entry()).toMatchObject({ status: "approved", joins_phase: null });
    expect(h.mails.at(-1).joins).toBeNull();
  });

  it("the organizer can flip a decision; each one emails both players; the same one twice is refused", async () => {
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    const id = entry().id;
    expect(await E.decideEntry(org, 1, id, "approve", null, DURING_REGISTRATION)).toEqual({ ok: true });
    expect(await E.decideEntry(org, 1, id, "approve", null, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(await E.decideEntry(org, 1, id, "reject", "Mégsem.", DURING_REGISTRATION)).toEqual({ ok: true });
    expect(entry()).toMatchObject({ status: "rejected", joins_phase: null, note: "Mégsem." });
    expect(await E.decideEntry(org, 1, id, "approve", null, DURING_REGISTRATION)).toEqual({ ok: true });
    expect(entry()).toMatchObject({ status: "approved", note: null });
    expect(h.mails.map((m) => [m.toEmail, m.approved])).toEqual([
      ["a@x.hu", true],
      ["b@x.hu", true],
      ["a@x.hu", false],
      ["b@x.hu", false],
      ["a@x.hu", true],
      ["b@x.hu", true],
    ]);
  });

  it("an entry is only decided on its own season's page", async () => {
    addSeason(2, 1, "Tavasz");
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    expect(await E.decideEntry(org, 2, entry().id, "approve", null, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(entry()).toMatchObject({ status: "pending" });
  });

  it("D19: dissolving withdraws entries for seasons not started, and no one can approve them", async () => {
    addSeason(2, 1, "Tavasz");
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    await E.applyToSeason(user("a"), 2, DURING_REGISTRATION);
    const [s1, s2] = all("select id from season_entries order by season_id").map((r: any) => r.id);
    await E.decideEntry(org, 1, s1, "approve", null, DURING_REGISTRATION);
    expect(await P.dissolvePair(user("b"), 1)).toEqual({ ok: true });
    expect(all("select status from season_entries order by season_id")).toEqual([{ status: "withdrawn" }, { status: "withdrawn" }]);
    expect(await E.decideEntry(org, 1, s1, "approve", null, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(await E.decideEntry(org, 2, s2, "reject", null, DURING_REGISTRATION)).toMatchObject({ ok: false });
    expect(await S.seasonState(1)).toMatchObject({ entries: 0 });
  });

  it("D19: an entry the pair already plays in stays; a rejected one stays rejected", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      addSeason(2, 1, "Tavasz");
      vi.setSystemTime(DURING_REGISTRATION);
      await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
      await E.applyToSeason(user("a"), 2, DURING_REGISTRATION);
      const [s1, s2] = all("select id from season_entries order by season_id").map((r: any) => r.id);
      await E.decideEntry(org, 1, s1, "approve", null, DURING_REGISTRATION);
      await E.decideEntry(org, 2, s2, "reject", null, DURING_REGISTRATION);
      // Between phase 1 and 2 (the pair isn't in a running group: no groups yet).
      vi.setSystemTime(at("2026-11-30T12:00:00Z"));
      expect(await P.dissolvePair(user("a"), 1)).toEqual({ ok: true });
      expect(all("select status from season_entries order by season_id")).toEqual([{ status: "approved" }, { status: "rejected" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("D19: approved in phase 1 to join phase 2, dissolved before phase 2: withdrawn", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(IN_PHASE_1);
      await E.applyToSeason(user("a"), 1, IN_PHASE_1);
      await E.decideEntry(org, 1, entry().id, "approve", null, IN_PHASE_1);
      await P.dissolvePair(user("a"), 1);
      expect(entry()).toMatchObject({ status: "withdrawn" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a pending entry of a pair dissolved in the meantime can be rejected, not approved", async () => {
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    // Dissolved outside the app's dissolve (e.g. a race): the pending entry is left.
    h.raw.exec("update pairs set status = 'dissolved' where id = 1");
    expect(await E.decideEntry(org, 1, entry().id, "approve", null, DURING_REGISTRATION)).toMatchObject({ ok: false, error: expect.stringContaining("megszűnt") });
    expect(await E.decideEntry(org, 1, entry().id, "reject", null, DURING_REGISTRATION)).toEqual({ ok: true });
  });

  it("the organizer's list: names, levels and the average starting Elo, no contact details; and the counts", async () => {
    h.raw.exec("update users set level = 'kezdo' where id = 'd'");
    await E.applyToSeason(user("a"), 1, DURING_REGISTRATION);
    await E.applyToSeason(user("c"), 1, at("2026-11-04T12:00:00Z"));
    const rows = await E.listSeasonEntries(1, "pending");
    expect(rows.map((r) => [r.players.map((p) => p.name), r.averageElo])).toEqual([
      [["Anna", "Béla"], 1200],
      [["Cecil", "Dóra"], 1100],
    ]);
    expect(JSON.stringify(rows)).not.toContain("@");
    await E.decideEntry(org, 1, rows[1].id, "reject", null, DURING_REGISTRATION);
    expect(await E.listSeasonEntries(1, "rejected")).toHaveLength(1);
    expect((await E.entryCounts([1])).get(1)).toEqual({ pending: 1, approved: 0, rejected: 1 });
    expect(await S.seasonState(1)).toMatchObject({ entries: 2 });
  });

  it("shows Nevezünk to a pair that can apply, and why not to one that can't", async () => {
    const season = (await S.getSeason(1))!;
    expect((await E.entryViews(user("a"), [season], DURING_REGISTRATION)).get(1)).toEqual({ kind: "apply", late: false });
    expect((await E.entryViews(user("c"), [season], DURING_REGISTRATION)).get(1)).toMatchObject({ kind: "blocked", reason: "partner_no_level" });
    expect((await E.entryViews(user("o"), [season], DURING_REGISTRATION)).get(1)).toMatchObject({ kind: "blocked", reason: "no_pair" });
    expect((await E.entryViews(user("a"), [season], at("2026-10-01T12:00:00Z"))).has(1)).toBe(false);
  });
});
