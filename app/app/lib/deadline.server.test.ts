// deadline.server.ts and strikes.server.ts on a real SQLite with every
// migration applied (~/test/sqlite): the deadline resolution of unplayed
// matches (#11) and the strikes it gives (#294). The fixture is the one of
// results.server.test.ts; email is captured, never sent.
import { budapestTime } from "@padel-liga/rules";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[], warnings: [] as any[], race: null as number | null }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
// A step taken while the run works: the match's revision moves on right
// after its log was read.
vi.mock("~/lib/matches.server", async (original) => {
  const real = await original<typeof import("~/lib/matches.server")>();
  return {
    ...real,
    eventsOf: async (ids: number[]) => {
      const out = await real.eventsOf(ids);
      if (h.race !== null) h.raw.prepare("update matches set revision = revision + 1 where id = ?").run(h.race);
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
  queueMatchEmails: async (messages: any[]) => h.mails.push(...messages),
  queueStrikeWarnings: async (messages: any[], sendNow: boolean) => h.warnings.push(...messages.map((m) => ({ ...m, sendNow }))),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const G = await import("~/lib/groups.server");
const M = await import("~/lib/matches.server");
const R = await import("~/lib/results.server");
const D = await import("~/lib/decisions.server");
const E = await import("~/lib/season-entries.server");
const L = await import("~/lib/ladder.server");
const S = await import("~/lib/strikes.server");
const { resolveDeadlines } = await import("~/lib/deadline.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (day: string, hour: number, minute = 0) => budapestTime(day, hour, minute);

const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const PUBLISHED = new Date("2026-11-08T08:00:00Z");
const NOW = at("2026-11-10", 11);
// Monday after phase 1's deadline (Sunday 29 Nov, 23:59).
const MONDAY_6 = at("2026-11-30", 6);

async function freshDb() {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert into clubs (id, slug, city, name, active) values (1, 'ace', 'gyor', 'Ace Padel', 1)`);
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
  h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'o')`);
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
  h.mails = [];
  h.warnings = [];
}

const all = (q: string, ...params: unknown[]) => h.raw.prepare(q).all(...params);
const one = (q: string, ...params: unknown[]) => h.raw.prepare(q).get(...params);
const matchOf = (a: number, b: number) => one("select id, pair_a from matches where (pair_a = ? and pair_b = ?) or (pair_a = ? and pair_b = ?)", a, b, b, a);
const row = (id: number) => one("select status, outcome from matches where id = ?", id);
const strikesOf = (...users: string[]) =>
  all(`select user_id, source, match_id, cancelled_at from strikes where user_id in (${users.map(() => "?").join(",")}) order by id`, ...users);
const SLOTS = [at("2026-11-12", 18), at("2026-11-13", 19, 30), at("2026-11-14", 10)];

// A player of `pair` proposes on the match against `other`.
async function propose(pair: number, other: number, when = NOW, slots = SLOTS) {
  const m = matchOf(pair, other);
  expect(await M.matchStep(`p${pair}a`, m.id, { kind: "propose", slots, clubId: null }, when)).toMatchObject({ ok: true });
  return m.id as number;
}

describe("resolving unplayed matches at the deadline (#11)", () => {
  beforeEach(freshDb);

  it("waits until 06:00 Budapest the Monday after the deadline", async () => {
    await propose(1, 3);
    expect(await resolveDeadlines(at("2026-11-29", 23, 59))).toEqual({ resolved: 0, left: false });
    expect(await resolveDeadlines(at("2026-11-30", 5, 59))).toEqual({ resolved: 0, left: false });
    expect(row(matchOf(1, 3).id).status).toBe("open");
    // Both groups' 9 matches (4 + 3 pairs).
    expect(await resolveDeadlines(MONDAY_6)).toEqual({ resolved: 9, left: false });
  });

  it("one side active: a walkover for it, final, a ruling of the deadline, strikes for the other pair, everyone told", async () => {
    const id = await propose(1, 3);
    await resolveDeadlines(MONDAY_6, undefined, 25);
    const m = matchOf(1, 3);
    const winner = m.pair_a === 1 ? "a" : "b";
    expect(row(id)).toEqual({ status: "final", outcome: JSON.stringify({ kind: "walkover", winner }) });
    expect(all("select kind, user_id, at from match_decisions where match_id = ?", id)).toEqual([
      { kind: "deadline", user_id: null, at: sec(MONDAY_6.toISOString()) },
    ]);
    expect(strikesOf("p1a", "p1b", "p3a", "p3b").filter((s: any) => s.match_id === id)).toEqual([
      { user_id: "p3a", source: "deadline", match_id: id, cancelled_at: null },
      { user_id: "p3b", source: "deadline", match_id: id, cancelled_at: null },
    ]);
    // The match's outcome to all four; the strike with its count to pair 3.
    const told = all("select user_id, kind, title, body, push_due_at from notifications where url = ? and kind in ('match_decided', 'strike') order by id", `/matches/${id}`);
    expect(told.filter((n: any) => n.kind === "match_decided").map((n: any) => n.user_id).sort()).toEqual(["p1a", "p1b", "p3a", "p3b"]);
    expect(told.find((n: any) => n.user_id === "p1a").body).toBe("Játék nélküli győzelem nektek (4:0, 4:0). A részletek a meccs oldalán.");
    expect(told.find((n: any) => n.user_id === "p3a" && n.kind === "match_decided").body).toBe("Játék nélküli vereség (0:4, 0:4). A részletek a meccs oldalán.");
    // Pair 3 lost every match of the phase by doing nothing: its count is per match, in id order.
    expect(told.filter((n: any) => n.kind === "strike").map((n: any) => n.user_id)).toEqual(["p3a", "p3b"]);
    for (const n of told) expect(n.push_due_at).not.toBeNull();
    // The audit entry: the system, no names.
    expect(one("select actor_id, detail, league_id from audit_log where action = 'match.deadline' and target = ?", `match:${id}`)).toEqual({
      actor_id: null,
      detail: `Játék nélküli győzelem: ${winner === "a" ? "A pár" : "B pár"} (4:0, 4:0)`,
      league_id: 1,
    });
    // The match page: final, nothing left to do.
    const page = await M.matchPage(id, "p3a", MONDAY_6);
    expect(page!.result).toMatchObject({ status: "final", how: "deadline" });
    expect(page!.resultActions).toEqual({ record: false, confirm: false, dispute: false });
    expect(page!.log.at(-1)).toMatchObject({ who: "Padelpárbaj", by: "auto", text: "Lejárt a határidő, a meccsnaplóból döntöttünk: Játék nélküli vereség (0:4, 0:4)" });
  });

  it("neither side active: both lose 0-4 0-4, all four players get a strike", async () => {
    const id = matchOf(1, 3).id;
    await resolveDeadlines(MONDAY_6, undefined, 25);
    expect(JSON.parse(row(id).outcome)).toEqual({ kind: "both-inactive" });
    expect(all("select user_id from strikes where match_id = ? order by user_id", id).map((r: any) => r.user_id)).toEqual(["p1a", "p1b", "p3a", "p3b"]);
  });

  it("both active, no agreement: unplayed, no strikes", async () => {
    const id = await propose(1, 3);
    await propose(3, 1, at("2026-11-11", 9), [at("2026-11-16", 18), at("2026-11-17", 18), at("2026-11-18", 18)]);
    await resolveDeadlines(MONDAY_6, undefined, 25);
    expect(JSON.parse(row(id).outcome)).toEqual({ kind: "unplayed" });
    expect(all("select * from strikes where match_id = ?", id)).toEqual([]);
  });

  it("a scheduled slot that passed without a result: both active, unplayed, no strikes (D103)", async () => {
    const id = await propose(1, 3);
    expect(await M.matchStep("p3a", id, { kind: "accept", slot: SLOTS[0]! }, NOW)).toMatchObject({ ok: true });
    await resolveDeadlines(MONDAY_6, undefined, 25);
    expect(row(id)).toEqual({ status: "final", outcome: JSON.stringify({ kind: "unplayed" }) });
    expect(all("select * from strikes where match_id = ?", id)).toEqual([]);
  });

  it("a late canceller who proposed first loses by walkover and gets the strike", async () => {
    const id = await propose(1, 3);
    expect(await M.matchStep("p3a", id, { kind: "accept", slot: SLOTS[0]! }, NOW)).toMatchObject({ ok: true });
    expect(await M.matchStep("p1a", id, { kind: "cancel" }, at("2026-11-12", 9))).toMatchObject({ ok: true });
    await resolveDeadlines(MONDAY_6, undefined, 25);
    const m = matchOf(1, 3);
    expect(JSON.parse(row(id).outcome)).toEqual({ kind: "walkover", winner: m.pair_a === 3 ? "a" : "b" });
    expect(all("select user_id from strikes where match_id = ? order by user_id", id).map((r: any) => r.user_id)).toEqual(["p1a", "p1b"]);
  });

  it("leaves played, confirmed, waiting and disputed results alone", async () => {
    const played = matchOf(1, 3).id;
    const waiting = matchOf(2, 4).id;
    const disputed = matchOf(1, 4).id;
    const win = { sets: [[4, 1], [4, 2]] as [number, number][] };
    for (const id of [played, waiting, disputed]) {
      const a = one("select p.player_a as p from matches m join pairs p on p.id = m.pair_a where m.id = ?", id).p;
      expect(await R.resultStep(a, id, { kind: "record", score: win }, at("2026-11-29", 20))).toMatchObject({ ok: true });
    }
    const other = (id: number) => one("select p.player_a as p from matches m join pairs p on p.id = m.pair_b where m.id = ?", id).p;
    expect(await R.resultStep(other(played), played, { kind: "confirm" }, at("2026-11-29", 21))).toMatchObject({ ok: true });
    expect(await R.resultStep(other(disputed), disputed, { kind: "dispute", score: { sets: [[1, 4], [2, 4]] }, note: "" }, at("2026-11-29", 21))).toMatchObject({
      ok: true,
    });
    await resolveDeadlines(MONDAY_6, undefined, 25);
    expect(row(played).status).toBe("final");
    expect(row(waiting).status).toBe("result_pending");
    expect(row(disputed).status).toBe("disputed");
    expect(all("select * from match_decisions where match_id in (?, ?, ?)", played, waiting, disputed)).toEqual([]);
    expect(all("select * from strikes where match_id in (?, ?, ?)", played, waiting, disputed)).toEqual([]);
  });

  it("a result recorded after the deadline but before 06:00 is left to auto-accept", async () => {
    const id = matchOf(1, 3).id;
    const a = one("select p.player_a as p from matches m join pairs p on p.id = m.pair_a where m.id = ?", id).p;
    expect(await R.resultStep(a, id, { kind: "record", score: { sets: [[4, 1], [4, 2]] } }, at("2026-11-30", 1))).toMatchObject({ ok: true });
    await resolveDeadlines(MONDAY_6, undefined, 25);
    expect(row(id).status).toBe("result_pending");
  });

  it("never resolves a withdrawn pair's matches, and gives no strike for them", async () => {
    expect(await E.withdrawPairMidPhase({ id: "o" }, 1, 7, 1, "Sérülés", NOW)).toEqual({ ok: true });
    await resolveDeadlines(MONDAY_6, undefined, 25);
    expect(all("select status from matches where pair_a = 7 or pair_b = 7").map((r: any) => r.status)).toEqual(["open", "open"]);
    expect(strikesOf("p7a", "p7b")).toEqual([]);
  });

  it("is safe to run again: each match once, each strike once", async () => {
    await resolveDeadlines(MONDAY_6, undefined, 25);
    const counts = () => [one("select count(*) as n from match_decisions").n, one("select count(*) as n from strikes").n, one("select count(*) as n from notifications").n];
    const before = counts();
    expect(before[0]).toBe(9);
    expect(await resolveDeadlines(at("2026-11-30", 6, 10), undefined, 25)).toEqual({ resolved: 0, left: false });
    expect(counts()).toEqual(before);
  });

  it("a step taken meanwhile wins: that match waits for the next run, the others go on", async () => {
    const ids = all("select id from matches order by id").map((r: any) => r.id as number);
    h.race = ids[0]!;
    const r = await resolveDeadlines(MONDAY_6, undefined, 25);
    expect(r.resolved).toBe(8);
    expect(row(ids[0]!).status).toBe("open");
    expect((await resolveDeadlines(at("2026-11-30", 6, 10), undefined, 25)).resolved).toBe(1);
  });

  it("the public table counts the resolved outcomes (walkover 3 points, both losing 0, unplayed nothing)", async () => {
    await propose(1, 3);
    await resolveDeadlines(MONDAY_6, undefined, 25);
    const page: any = await L.ladderPage("gyor", MONDAY_6);
    const group1 = page.bands.flatMap((b: any) => b.groups).find((g: any) => g.number === 1);
    const pair1 = group1.rows.find((r: any) => r.names.includes("Játékos 1A"));
    // 1–3 won by walkover, 1–4 and 1–2 lost by both being inactive.
    expect(pair1).toMatchObject({ points: 3, matches: 3, setDiff: 2 - 4, gameDiff: 8 - 16 });
  });

  it("the organizer can still override a resolved match (D78)", async () => {
    const id = await propose(1, 3);
    await resolveDeadlines(MONDAY_6, undefined, 25);
    expect(await D.decideMatch("o", 1, id, { kind: "unplayed" }, "A klub lemondta a pályát.", at("2026-11-30", 9))).toMatchObject({ ok: true });
    expect(JSON.parse(row(id).outcome)).toEqual({ kind: "unplayed" });
    // The strike stays until the organizer cancels it.
    expect(all("select user_id from strikes where match_id = ? and cancelled_at is null", id)).toHaveLength(2);
  });
});

describe("strikes (#294)", () => {
  beforeEach(freshDb);

  it("the 2nd strike queues the warning email once; the 3rd tells the pair it leaves, and flags the pair for the round switch", async () => {
    // Pair 3 (group 1) does nothing all phase: 3 matches, 3 strikes each.
    await propose(1, 3);
    await propose(2, 3, NOW, [at("2026-11-19", 18), at("2026-11-20", 18), at("2026-11-21", 18)]);
    await propose(4, 3, NOW, [at("2026-11-26", 18), at("2026-11-27", 18), at("2026-11-28", 18)]);
    await resolveDeadlines(MONDAY_6, undefined, 25);
    expect(strikesOf("p3a")).toHaveLength(3);
    const titles = all("select title from notifications where user_id = 'p3a' and kind = 'strike' order by id").map((r: any) => r.title);
    expect(titles).toEqual(["Fekete pontot kaptál", "2. fekete pont: figyelmeztetés", "3. fekete pont: a kör végén kikerültök"]);
    // The warning: one email per player, through the outbox, kept for the run's delivery step.
    const mails = all("select kind, to_email, subject, status from email_messages where kind = 'strike_warning' order by to_email");
    expect(mails.filter((m: any) => m.to_email.startsWith("p3"))).toEqual([
      { kind: "strike_warning", to_email: "p3a@x.hu", subject: "Figyelmeztetés: 2. fekete pont – Padelpárbaj", status: "pending" },
      { kind: "strike_warning", to_email: "p3b@x.hu", subject: "Figyelmeztetés: 2. fekete pont – Padelpárbaj", status: "pending" },
    ]);
    const leaving = await S.pairsLeavingAfterPhase(1, 1);
    expect(leaving.map((p) => p.pairId)).toContain(3);
  });

  it("a cancelled strike lowers the count, takes the pair off the list and leaves an audit entry with the reason", async () => {
    await propose(1, 3);
    await propose(2, 3, NOW, [at("2026-11-19", 18), at("2026-11-20", 18), at("2026-11-21", 18)]);
    await propose(4, 3, NOW, [at("2026-11-26", 18), at("2026-11-27", 18), at("2026-11-28", 18)]);
    await resolveDeadlines(MONDAY_6, undefined, 25);
    const first = one("select id from strikes where user_id = 'p3a' order by id").id;
    expect(await S.cancelStrike("o", 1, first, "  ", at("2026-11-30", 8))).toEqual({ ok: false, error: "Írd meg, miért törlöd a fekete pontot." });
    expect(await S.cancelStrike("o", 2, first, "Beteg volt.", at("2026-11-30", 8))).toMatchObject({ ok: false });
    expect(await S.cancelStrike("o", 1, first, "Beteg volt.", at("2026-11-30", 8))).toEqual({ ok: true, notice: "Töröltük a fekete pontot." });
    expect(await S.cancelStrike("o", 1, first, "Megint.", at("2026-11-30", 8))).toMatchObject({ ok: false });
    expect(one("select actor_id, detail, league_id from audit_log where action = 'strike.cancel'")).toEqual({ actor_id: "o", detail: "Beteg volt.", league_id: 1 });
    // p3b still has 3: the pair leaves, and p3a's card says so too.
    expect(await S.myStrikes("p3a")).toEqual([{ seasonId: 1, count: 2, leaving: true }]);
    expect((await S.myStrikes("p3b"))[0]!.count).toBe(3);
    // p3b still has 3: the pair still leaves. Cancel one of p3b's too.
    const p3b = one("select id from strikes where user_id = 'p3b' order by id").id;
    expect(await S.cancelStrike("o", 1, p3b, "Beteg volt.", at("2026-11-30", 8))).toMatchObject({ ok: true });
    expect((await S.pairsLeavingAfterPhase(1, 1)).map((p) => p.pairId)).not.toContain(3);
    expect(await S.myStrikes("p3a")).toEqual([{ seasonId: 1, count: 2, leaving: false }]);
  });

  it("giveStrikes (for no-shows, #33): both players, their new counts, the notice and the 2nd strike's email at once", async () => {
    const id = matchOf(1, 3).id;
    const grant = { seasonId: 1, pairId: 1, players: ["p1a", "p1b"], matchId: id, source: "no_show" as const, at: NOW };
    expect(await S.giveStrikes(grant)).toEqual(
      new Map([
        ["p1a", 1],
        ["p1b", 1],
      ]),
    );
    // The same match and source again: nothing new.
    expect((await S.giveStrikes(grant)).get("p1a")).toBe(1);
    expect(h.warnings).toEqual([]);
    const second = { ...grant, matchId: matchOf(1, 4).id };
    expect((await S.giveStrikes(second)).get("p1a")).toBe(2);
    // A retried 2nd (the #33 confirmation sent twice): no notice, no email again.
    expect((await S.giveStrikes(second)).get("p1a")).toBe(2);
    expect(h.warnings.map((w) => [w.toEmail, w.sendNow])).toEqual([
      ["p1a@x.hu", true],
      ["p1b@x.hu", true],
    ]);
    expect(all("select count(*) n from notifications where user_id = 'p1a' and kind = 'strike'")[0].n).toBe(2);
    expect(all("select body from notifications where user_id = 'p1a' and kind = 'strike' order by id")[0].body).toMatch(/^Nem jelentetek meg egy lefixált meccsen\. Ebben a szezonban 1 fekete pontod van/);
  });

  it("counts per season: another season's strikes don't count", async () => {
    h.raw.prepare("insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (2, 1, 'Tavasz', 1, 2, '2027-03-01')").run();
    await S.giveStrikes({ seasonId: 2, pairId: 1, players: ["p1a", "p1b"], matchId: null, source: "no_show", at: NOW });
    await S.giveStrikes({ seasonId: 1, pairId: 1, players: ["p1a", "p1b"], matchId: matchOf(1, 3).id, source: "no_show", at: NOW });
    expect(await S.myStrikes("p1a")).toEqual([
      { seasonId: 2, count: 1, leaving: false },
      { seasonId: 1, count: 1, leaving: false },
    ]);
  });

  // A partner change (spec 8): p3a has 2 strikes from an earlier pair, p3b none.
  const earlier = (user: string, n: number) => {
    for (let i = 0; i < n; i++)
      h.raw.prepare("insert into strikes (season_id, user_id, pair_id, match_id, source, at) values (1, ?, 3, null, 'no_show', ?)").run(user, sec("2026-11-09T10:00:00Z") + i);
  };

  it("the partner's 3rd strike: both players hear that the pair leaves, and no warning email goes out", async () => {
    earlier("p3a", 2);
    expect(await S.myStrikes("p3b")).toEqual([]);
    expect(await S.giveStrikes({ seasonId: 1, pairId: 3, players: ["p3a", "p3b"], matchId: matchOf(1, 3).id, source: "no_show", at: NOW })).toEqual(
      new Map([
        ["p3a", 3],
        ["p3b", 1],
      ]),
    );
    const told = (u: string) => one("select title, body from notifications where user_id = ? and kind = 'strike'", u);
    expect(told("p3a").title).toBe("3. fekete pont: a kör végén kikerültök");
    expect(told("p3b")).toEqual({
      title: "Fekete pontot kaptál: a kör végén kikerültök",
      body: expect.stringMatching(/Ebben a szezonban 1 fekete pontod van, a párodnak már 3\. A párod és te a kör végén kikerültök/),
    });
    expect(h.warnings).toEqual([]);
    expect(await S.myStrikes("p3b")).toEqual([{ seasonId: 1, count: 1, leaving: true }]);
    expect((await S.pairsLeavingAfterPhase(1, 1)).map((p) => p.pairId)).toEqual([3]);
  });

  it("the deadline step tells the partner below 3 that the pair leaves, too", async () => {
    earlier("p3a", 2);
    await propose(1, 3);
    await resolveDeadlines(MONDAY_6, undefined, 25);
    const titles = (u: string) => all("select title from notifications where user_id = ? and kind = 'strike' order by id", u).map((x: any) => x.title);
    expect(titles("p3a")[0]).toBe("3. fekete pont: a kör végén kikerültök");
    expect(titles("p3b")[0]).toBe("Fekete pontot kaptál: a kör végén kikerültök");
    expect(titles("p3b").every((t: string) => t.endsWith("a kör végén kikerültök"))).toBe(true);
    const mails = all("select to_email from email_messages where kind = 'strike_warning'").map((x: any) => x.to_email);
    expect(mails.filter((m: string) => m.startsWith("p3"))).toEqual([]);
  });

  it("the Kezdőlap card shows that the pair leaves when only the partner has strikes", async () => {
    earlier("p3a", 3);
    expect(await S.myStrikes("p3b")).toEqual([{ seasonId: 1, count: 0, leaving: true }]);
    // Another league's or pair's player: not affected.
    expect(await S.myStrikes("p1a")).toEqual([]);
  });

  it("anonymizing a player clears the reasons of their cancelled strikes, in the rows and the audit log", async () => {
    await S.giveStrikes({ seasonId: 1, pairId: 1, players: ["p1a", "p1b"], matchId: matchOf(1, 3).id, source: "no_show", at: NOW });
    const id = one("select id from strikes where user_id = 'p1a'").id;
    expect(await S.cancelStrike("o", 1, id, "Beteg volt.", NOW)).toMatchObject({ ok: true });
    h.raw.exec("update users set deleted_at = 1 where id = 'p1a'");
    await h.raw.prepare("select 1").get();
    const { db } = await import("~/db/client.server");
    const { sql } = await import("drizzle-orm");
    await db.batch(S.clearStrikeReasons("p1a", sql`1`) as any);
    expect(one("select cancel_reason from strikes where id = ?", id).cancel_reason).toBeNull();
    expect(one("select detail from audit_log where action = 'strike.cancel'").detail).toBeNull();
  });
});
