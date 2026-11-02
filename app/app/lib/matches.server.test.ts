// matches.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the player's group and matches (#25) and scheduling them
// (#26). The groups are published with groups.server.ts; email is stubbed.
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

const SLOTS = [at("2026-11-12", 18), at("2026-11-13", 19, 30), at("2026-11-14", 10)];

describe("currentGroups (#25)", () => {
  beforeEach(freshDb);

  it("a player in a group of 4 sees the group, the division line data and 3 matches, one a week", async () => {
    const [g, ...rest] = await M.currentGroups("p1a", NOW);
    expect(rest).toEqual([]);
    expect(g).toMatchObject({ league: "Padelpárbaj Győr", season: "2026/27 tél", phase: 1, number: 1, groupCount: 2, deadline: DEADLINE });
    expect(g!.pairs.map((p) => [p.pairId, p.mine])).toEqual([
      [1, true],
      [2, false],
      [4, false],
      [3, false],
    ]);
    expect(g!.matches.map((m) => [m.week, m.opponents])).toEqual([
      [1, "Játékos 3A – Játékos 3B"],
      [2, "Játékos 4A – Játékos 4B"],
      [3, "Játékos 2A – Játékos 2B"],
    ]);
    expect(g!.matches.every((m) => m.state.status === "to_schedule")).toBe(true);
  });

  it("a player in a group of 3 sees 2 matches; the week off has none", async () => {
    const [g] = await M.currentGroups("p5b", NOW);
    expect(g!.number).toBe(2);
    expect(g!.matches.map((m) => m.week)).toEqual([2, 3]);
  });

  it("shows the opponents' phone numbers, never an email address", async () => {
    const [g] = await M.currentGroups("p1a", NOW);
    expect(g!.matches[0]!.contacts).toEqual([
      { name: "Játékos 3A", phone: "+36 30 300 0001" },
      { name: "Játékos 3B", phone: "+36 30 300 0002" },
    ]);
    expect(JSON.stringify(g)).not.toContain("@");
    // The player's own partner's phone isn't there either.
    expect(JSON.stringify(g)).not.toContain("+36 30 100");
  });

  it("is empty before the groups are published and after the phase deadline", async () => {
    expect(await M.currentGroups("p1a", new Date(DEADLINE.getTime() + 60_000))).toEqual([]);
    h.raw.exec("update groups set published_at = null");
    expect(await M.currentGroups("p1a", NOW)).toEqual([]);
  });

  it("someone not in a group gets nothing", async () => {
    expect(await M.currentGroups("x", NOW)).toEqual([]);
  });

  it("each status shows on the home view", async () => {
    const id = matchOf(1, 3);
    await M.matchStep("p1a", id, { kind: "propose", slots: SLOTS, clubId: null }, NOW);
    let [g] = await M.currentGroups("p1a", NOW);
    expect(g!.matches[0]!.state).toMatchObject({ status: "proposed", by: "a" });
    expect(g!.matches[0]!.side).toBe("a");
    [g] = await M.currentGroups("p3a", NOW);
    expect(g!.matches.find((m) => m.id === id)!.side).toBe("b");
    await M.matchStep("p3b", id, { kind: "accept", slot: SLOTS[1]! }, NOW);
    [g] = await M.currentGroups("p1b", NOW);
    expect(g!.matches[0]!.state).toEqual({ status: "scheduled", slot: SLOTS[1], clubId: null });
  });
});

describe("matchPage (#25, #26)", () => {
  beforeEach(freshDb);

  it("only the two pairs' players see a match", async () => {
    const id = matchOf(1, 3);
    for (const u of ["p1a", "p1b", "p3a", "p3b"]) expect(await M.matchPage(id, u, NOW)).not.toBeNull();
    for (const u of ["p2a", "p5a", "x", "o"]) expect(await M.matchPage(id, u, NOW)).toBeNull();
    expect(await M.matchPage(99999, "p1a", NOW)).toBeNull();
  });

  it("shows the opponents, their phones while the phase runs, and the active clubs of the city", async () => {
    const page = (await M.matchPage(matchOf(1, 3), "p1a", NOW))!;
    expect(page).toMatchObject({ week: 1, us: "Játékos 1A – Játékos 1B", opponents: "Játékos 3A – Játékos 3B", groupNumber: 1, groupCount: 2, side: "a" });
    expect(page.contacts.map((c) => c.name)).toEqual(["Játékos 3A", "Játékos 3B"]);
    expect(page.clubs).toEqual([{ id: 1, name: "Ace Padel" }]);
    expect(page.actions).toMatchObject({ propose: true, recordAgreed: true });
    expect(JSON.stringify(page)).not.toContain("@");
  });

  it("after the deadline: no phones and no actions", async () => {
    const page = (await M.matchPage(matchOf(1, 3), "p1a", new Date(DEADLINE.getTime() + 60_000)))!;
    expect(page.contacts).toEqual([]);
    expect(page.actions).toEqual({ propose: false, recordAgreed: false, accept: [], confirm: false, decline: false });
  });
});

describe("matchStep (#26)", () => {
  beforeEach(freshDb);

  it("a proposal breaking a slot rule is refused with its Hungarian message, nothing written", async () => {
    const id = matchOf(1, 3);
    const result = await M.matchStep("p1a", id, { kind: "propose", slots: [at("2026-11-11", 18), at("2026-11-12", 6)], clubId: null }, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Legalább 3 különböző időpontot ajánlj.");
    expect(result.error).toContain("Az időpont 7:00 és 22:00 között kezdődjön.");
    expect(result.error).toContain("Az időpont legalább 48 órával későbbi legyen, mint most.");
    expect(result.slotErrors).toContainEqual({ code: "outside_window", slot: 1 });
    expect(events(id)).toEqual([]);
    expect(h.mails).toEqual([]);
  });

  it("propose → counter-propose → accept by the proposer's partner: scheduled for both pairs, every step logged", async () => {
    const id = matchOf(1, 3);
    expect(await M.matchStep("p1a", id, { kind: "propose", slots: SLOTS, clubId: 1 }, NOW)).toEqual({
      ok: true,
      notice: "Elküldtük az időpontokat a másik párnak.",
    });
    // Instant to the other pair: email and the app.
    expect(h.mails.map((m) => [m.kind, m.toEmail])).toEqual([
      ["match_proposal", "p3a@x.hu"],
      ["match_proposal", "p3b@x.hu"],
    ]);
    expect(h.mails[0].input).toMatchObject({ to: "Játékos 3A", opponents: "Játékos 1A és Játékos 1B", matchId: id, week: 1, counter: false, venue: "Ace Padel", slots: SLOTS });
    expect(inbox()).toEqual([
      { kind: "match_proposal", url: `/matches/${id}`, user: "p3a" },
      { kind: "match_proposal", url: `/matches/${id}`, user: "p3b" },
    ]);

    const counter = [at("2026-11-17", 18), at("2026-11-18", 18), at("2026-11-19", 18)];
    h.mails = [];
    expect((await M.matchStep("p3b", id, { kind: "propose", slots: counter, clubId: null }, NOW)).ok).toBe(true);
    expect(h.mails.map((m) => [m.kind, m.toEmail, m.input.counter])).toEqual([
      ["match_proposal", "p1a@x.hu", true],
      ["match_proposal", "p1b@x.hu", true],
    ]);

    // The first proposal's slots are gone; the other player of pair 1 answers.
    expect((await M.matchStep("p1b", id, { kind: "accept", slot: SLOTS[0]! }, NOW)).ok).toBe(false);
    h.mails = [];
    expect(await M.matchStep("p1b", id, { kind: "accept", slot: counter[1]! }, NOW)).toEqual({ ok: true, notice: "Lefixáltátok a meccset." });
    expect(all("select status, scheduled_at, club_id, revision from matches where id = ?", id)).toEqual([
      { status: "scheduled", scheduled_at: sec(counter[1]!.toISOString()), club_id: null, revision: 3 },
    ]);
    // A digest item: the app (and push), no email.
    expect(h.mails).toEqual([]);
    expect(inbox().slice(-2)).toEqual([
      { kind: "match_scheduled", url: `/matches/${id}`, user: "p3a" },
      { kind: "match_scheduled", url: `/matches/${id}`, user: "p3b" },
    ]);

    expect(events(id).map((e: any) => [e.kind, e.pair_id, e.user_id])).toEqual([
      ["proposal", 1, "p1a"],
      ["counter_proposal", 3, "p3b"],
      ["accepted", 1, "p1b"],
    ]);
    expect(JSON.parse(events(id)[0].slots)).toEqual(SLOTS.map((s) => sec(s.toISOString())));

    // Both pairs see it scheduled; nothing more to do here.
    for (const u of ["p1a", "p3a"]) {
      const page = (await M.matchPage(id, u, NOW))!;
      expect(page.state).toEqual({ status: "scheduled", slot: counter[1], clubId: null });
      expect(page.actions.propose).toBe(false);
      expect(page.log.map((l) => [l.text.split(":")[0], l.who])).toEqual([
        ["Időpontokat ajánlott", "Játékos 1A"],
        ["Új időpontokat ajánlott", "Játékos 3B"],
        ["Elfogadta", "Játékos 1B"],
      ]);
    }
    const closed = await M.matchStep("p3a", id, { kind: "propose", slots: counter, clubId: null }, NOW);
    expect(closed).toEqual({ ok: false, error: "A meccs időpontja már le van fixálva." });
  });

  it("an agreed time 1 hour ahead at 23:00 is recorded, then confirmed: scheduled", async () => {
    const id = matchOf(2, 4);
    const late = at("2026-11-10", 23);
    const now = at("2026-11-10", 22);
    expect(await M.matchStep("p4a", id, { kind: "agreed", slot: late, clubId: 1 }, now)).toEqual({ ok: true, notice: "Rögzítettük. A másik pár megerősíti." });
    expect(h.mails.map((m) => [m.kind, m.toEmail])).toEqual([
      ["match_agreed_time", "p2a@x.hu"],
      ["match_agreed_time", "p2b@x.hu"],
    ]);
    expect(inbox().map((n: any) => [n.kind, n.user])).toEqual([
      ["match_agreed_time", "p2a"],
      ["match_agreed_time", "p2b"],
    ]);
    // The recording pair can't confirm its own.
    expect((await M.matchStep("p4b", id, { kind: "confirm" }, now)).ok).toBe(false);
    expect((await M.matchStep("p2b", id, { kind: "confirm" }, now)).ok).toBe(true);
    expect(all("select status, scheduled_at, club_id from matches where id = ?", id)).toEqual([
      { status: "scheduled", scheduled_at: sec(late.toISOString()), club_id: 1 },
    ]);
    expect(inbox().slice(-2).map((n: any) => [n.kind, n.user])).toEqual([
      ["match_scheduled", "p4a"],
      ["match_scheduled", "p4b"],
    ]);
    expect(events(id).map((e: any) => [e.kind, e.user_id])).toEqual([
      ["agreed_time", "p4a"],
      ["agreed_confirmed", "p2b"],
    ]);
    const page = (await M.matchPage(id, "p2a", now))!;
    expect(page.venue).toBe("Ace Padel");
  });

  it("a declined agreed time sends the match back to scheduling and tells the recording pair", async () => {
    const id = matchOf(2, 4);
    await M.matchStep("p2a", id, { kind: "agreed", slot: at("2026-11-12", 18), clubId: null }, NOW);
    h.mails = [];
    expect(await M.matchStep("p4a", id, { kind: "decline" }, NOW)).toEqual({ ok: true, notice: "Jeleztük a másik párnak. Egyeztessetek újra." });
    expect(all("select status, scheduled_at from matches where id = ?", id)).toEqual([{ status: "open", scheduled_at: null }]);
    expect((await M.matchPage(id, "p2a", NOW))!.state).toEqual({ status: "to_schedule" });
    expect(h.mails).toEqual([]);
    expect(inbox().slice(-2).map((n: any) => [n.kind, n.user])).toEqual([
      ["match_declined", "p2a"],
      ["match_declined", "p2b"],
    ]);
    expect(events(id).map((e: any) => e.kind)).toEqual(["agreed_time", "agreed_declined"]);
  });

  it("an agreed time in the past or after the deadline is refused", async () => {
    const id = matchOf(2, 4);
    expect(await M.matchStep("p2a", id, { kind: "agreed", slot: at("2026-11-10", 9), clubId: null }, NOW)).toMatchObject({
      ok: false,
      error: "Ez az időpont már elmúlt.",
    });
    expect(await M.matchStep("p2a", id, { kind: "agreed", slot: at("2026-11-30", 18), clubId: null }, NOW)).toMatchObject({
      ok: false,
      error: "Az időpont a kör határideje előtt legyen.",
    });
    expect(events(id)).toEqual([]);
  });

  it("nobody outside the two pairs can act on the match", async () => {
    const id = matchOf(1, 3);
    for (const u of ["p2a", "p5a", "x", "o"])
      expect(await M.matchStep(u, id, { kind: "propose", slots: SLOTS, clubId: null }, NOW)).toEqual({ ok: false, error: M.NOT_FOUND });
    await M.matchStep("p1a", id, { kind: "propose", slots: SLOTS, clubId: null }, NOW);
    expect(await M.matchStep("p2a", id, { kind: "accept", slot: SLOTS[0]! }, NOW)).toEqual({ ok: false, error: M.NOT_FOUND });
    expect(events(id)).toHaveLength(1);
  });

  it("a venue must be an active club of the league's city", async () => {
    const id = matchOf(1, 3);
    for (const clubId of [2, 3, 99])
      expect(await M.matchStep("p1a", id, { kind: "propose", slots: SLOTS, clubId }, NOW)).toEqual({
        ok: false,
        error: "Válassz a listából helyszínt, vagy hagyd üresen.",
      });
    expect(events(id)).toEqual([]);
  });

  it("nothing can be done after the deadline", async () => {
    const id = matchOf(1, 3);
    const after = new Date(DEADLINE.getTime() + 1000);
    expect(await M.matchStep("p1a", id, { kind: "agreed", slot: new Date(after.getTime() + 3600_000), clubId: null }, after)).toEqual({
      ok: false,
      error: "Lejárt a kör határideje, itt már nem lehet egyeztetni.",
    });
  });

  it("two answers at the same moment: only one wins", async () => {
    const id = matchOf(1, 3);
    await M.matchStep("p1a", id, { kind: "propose", slots: SLOTS, clubId: null }, NOW);
    const results = await Promise.all([
      M.matchStep("p3a", id, { kind: "accept", slot: SLOTS[0]! }, NOW),
      M.matchStep("p3b", id, { kind: "accept", slot: SLOTS[2]! }, NOW),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false });
    expect(events(id).map((e: any) => e.kind)).toEqual(["proposal", "accepted"]);
    expect(all("select revision from matches where id = ?", id)).toEqual([{ revision: 2 }]);
  });
});
