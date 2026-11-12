// deadline-projection.server.ts on a real SQLite with every migration
// applied (~/test/sqlite): "Ha most lenne a határidő" (#362) equals what the
// deadline run (deadline.server.ts) then stores for the same data, and
// reading it writes nothing. The fixture is deadline.server.test.ts's; email
// is captured, never sent.
import { budapestTime } from "@padel-liga/rules";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/send.server", () => ({ MAX_BATCH: 100, relayConfigured: () => false, sendEmails: async () => [] }));
vi.mock("~/lib/background.server", () => import("~/test/background"));
vi.mock("~/lib/email/outbox.server", async (original) => ({
  ...(await original<typeof import("~/lib/email/outbox.server")>()),
  queueGroupsPublished: async () => {},
  queueMatchEmails: async () => {},
  queueStrikeWarnings: async () => {},
}));

const { migratedDatabase } = await import("~/test/sqlite");
const G = await import("~/lib/groups.server");
const M = await import("~/lib/matches.server");
const R = await import("~/lib/results.server");
const E = await import("~/lib/season-entries.server");
const S = await import("~/lib/strikes.server");
const { resolveDeadlines } = await import("~/lib/deadline.server");
const { phaseProjection } = await import("~/lib/deadline-projection.server");
const { projectionKind, projectionLine, projectionView } = await import("~/lib/deadline-projection");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (day: string, hour: number, minute = 0) => budapestTime(day, hour, minute);

const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const PUBLISHED = new Date("2026-11-08T08:00:00Z");
const NOW = at("2026-11-10", 11);
const MONDAY_6 = at("2026-11-30", 6);

// Seven pairs, all "halado": group 1 has pairs 1-4, group 2 pairs 5-7.
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
        .prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, 'halado', 1)")
        .run(`p${id}${side}`, `p${id}${side}@x.hu`, `Játékos ${id}${side.toUpperCase()}`);
    h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)").run(id, `p${id}a`, `p${id}b`);
    h.raw
      .prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, 'approved', 1, ?)")
      .run(id, sec("2026-11-06T10:00:00Z") + id);
  }
  expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
  expect(await G.publishGroups(1, "o", PUBLISHED)).toEqual({ ok: true });
  h.raw.exec("delete from notifications");
}

const all = (q: string, ...params: unknown[]) => h.raw.prepare(q).all(...params);
const one = (q: string, ...params: unknown[]) => h.raw.prepare(q).get(...params);
const matchOf = (a: number, b: number) => one("select id from matches where (pair_a = ? and pair_b = ?) or (pair_a = ? and pair_b = ?)", a, b, b, a).id as number;
const playerOf = (id: number, side: "a" | "b") => one(`select p.player_a as p from matches m join pairs p on p.id = m.pair_${side} where m.id = ?`, id).p as string;
const changes = () => one("select total_changes() as n").n as number;
const SLOTS = [at("2026-11-12", 18), at("2026-11-13", 19), at("2026-11-14", 10)];
const hour = (starts: Date[]) => starts.map((s) => ({ start: s, end: new Date(s.getTime() + 3_600_000) }));
const strike = (userId: string) =>
  h.raw.prepare("insert into strikes (season_id, user_id, pair_id, match_id, source, at) values (1, ?, null, null, 'no_show', ?)").run(userId, sec("2026-11-09T10:00:00Z"));

async function propose(pair: number, other: number, slots = SLOTS) {
  const id = matchOf(pair, other);
  expect(await M.matchStep(`p${pair}a`, id, { kind: "propose", ranges: hour(slots), clubId: null }, NOW)).toMatchObject({ ok: true });
  return id;
}

// Every situation of the spec 8 table and what the deadline leaves alone.
async function scenario() {
  const walkover = await propose(1, 3);
  const unplayed = await propose(2, 4);
  await propose(4, 2, [at("2026-11-16", 18), at("2026-11-17", 18), at("2026-11-18", 18)]);
  const both = matchOf(3, 4);
  const waiting = matchOf(1, 4);
  const disputed = matchOf(2, 3);
  const noShow = matchOf(1, 2);
  const win = { sets: [[4, 1], [4, 2]] as [number, number][] };
  for (const id of [waiting, disputed]) expect(await R.resultStep(playerOf(id, "a"), id, { kind: "record", clubId: 1, score: win }, NOW)).toMatchObject({ ok: true });
  expect(await R.resultStep(playerOf(disputed, "b"), disputed, { kind: "dispute", score: { sets: [[1, 4], [2, 4]] }, note: "" }, NOW)).toMatchObject({ ok: true });
  h.raw.prepare("insert into no_show_reports (match_id, pair_id, status, reported_by, reported_at) values (?, 1, 'open', 'p1a', ?)").run(noShow, sec(NOW.toISOString()));
  // Pair 7 withdraws: its matches don't count. 5-6: neither side active.
  expect(await E.withdrawPairMidPhase({ id: "o" }, 1, 7, 1, "Sérülés", NOW)).toEqual({ ok: true });
  // Strikes before: p3a 1 (reaches 3 and pair 3 leaves), p4a 1 (reaches 2: the warning).
  strike("p3a");
  strike("p4a");
  return { walkover, unplayed, both, waiting, disputed, noShow, fiveSix: matchOf(5, 6) };
}

describe("phaseProjection (#362)", () => {
  beforeEach(freshDb);

  it("projects each counting match by the spec 8 rules, and the strikes per player", async () => {
    const ids = await scenario();
    const p = (await phaseProjection(1, 1))!;
    const kind = new Map(p.matches.map((m) => [m.id, projectionKind(m.decision)]));
    expect(kind.get(ids.walkover)).toBe("walkover");
    expect(kind.get(ids.unplayed)).toBe("unplayed");
    expect(kind.get(ids.both)).toBe("both_lose");
    expect(kind.get(ids.fiveSix)).toBe("both_lose");
    for (const id of [ids.waiting, ids.disputed, ids.noShow]) expect(kind.get(id)).toBe("left");
    // Pair 7's two matches are not projected.
    expect(p.matches).toHaveLength(9 - 2);
    expect(p.matches.find((m) => m.id === matchOf(5, 7))).toBeUndefined();
    const reasons = (id: number) => p.matches.find((m) => m.id === id)!.decision;
    expect(reasons(ids.waiting)).toEqual({ kind: "leave", reason: "result_pending" });
    expect(reasons(ids.disputed)).toEqual({ kind: "leave", reason: "disputed" });
    expect(reasons(ids.noShow)).toEqual({ kind: "leave", reason: "no_show" });
    expect(projectionLine(reasons(ids.noShow), { a: "A", b: "B" })).toBe("Nem dönt róla a határidő: meg nem jelenés bejelentése vár a döntésedre");

    // p3a: 1 now, +1 (1-3 walkover) +1 (3-4 both lose) = 3; p3b 0 -> 2; p4a 1 -> 2; p4b 0 -> 1.
    expect(p.strikes.get("p3a")).toEqual({ now: 1, after: 3 });
    expect(p.strikes.get("p3b")).toEqual({ now: 0, after: 2 });
    expect(p.strikes.get("p4a")).toEqual({ now: 1, after: 2 });
    expect(p.strikes.get("p1a")).toEqual({ now: 0, after: 0 });
    expect(p.strikes.has("p7a")).toBe(false);
    expect(p.leaving).toEqual([3]);
    // The page's lists: p4a reaches the 2nd strike; pair 3 would leave (and isn't listed twice).
    const view = projectionView(p);
    expect(view.warned.map((w) => w.player)).toEqual([{ id: "p4a", name: "Játékos 4A", now: 1, after: 2 }]);
    expect(view.leaving).toEqual([
      {
        pairId: 3,
        pair: [
          { id: "p3a", name: "Játékos 3A" },
          { id: "p3b", name: "Játékos 3B" },
        ],
        players: [
          { id: "p3a", name: "Játékos 3A", now: 1, after: 3 },
          { id: "p3b", name: "Játékos 3B", now: 0, after: 2 },
        ],
      },
    ]);
    expect(Object.fromEntries(view.totals.map((t) => [t.kind, t.count]))).toEqual({ walkover: 1, both_lose: 2, unplayed: 1, left: 3, final: 0 });
    // 1-3: pair 3 (2); 3-4 and 5-6: all four players (4 + 4).
    expect(view.newStrikes).toBe(2 + 4 + 4);
  });

  it("equals what the deadline run then stores: outcomes, strikes, warning emails and leavers", async () => {
    const ids = await scenario();
    const p = (await phaseProjection(1, 1))!;
    await resolveDeadlines(MONDAY_6, undefined, 25);
    for (const m of p.matches) {
      const stored = one("select status, outcome from matches where id = ?", m.id);
      if (m.decision.kind === "resolve") expect({ status: stored.status, outcome: JSON.parse(stored.outcome) }).toEqual({ status: "final", outcome: m.decision.resolution.outcome });
      else expect(all("select * from match_decisions where match_id = ? and kind = 'deadline'", m.id)).toEqual([]);
    }
    expect(one("select status from matches where id = ?", ids.noShow).status).not.toBe("final");
    const live = await S.liveCounts([...p.strikes.keys()], [1]);
    for (const [id, s] of p.strikes) expect([id, live.get(`1:${id}`) ?? 0]).toEqual([id, s.after]);
    const mailed = all("select to_email from email_messages where kind = 'strike_warning' order by id").map((r: any) => r.to_email);
    expect(mailed).toEqual(p.warned.map((w) => `${w.userId}@x.hu`));
    expect((await S.pairsLeavingAfterPhase(1, 1)).map((x) => x.pairId)).toEqual(p.leaving);
  });

  it("reads only: nothing is stored, sent or audited", async () => {
    await scenario();
    const before = changes();
    const counts = () => ["notifications", "email_messages", "audit_log", "strikes", "match_decisions", "match_events"].map((t) => one(`select count(*) n from ${t}`).n);
    const rows = counts();
    expect(await phaseProjection(1, 1)).not.toBeNull();
    expect(changes()).toBe(before);
    expect(counts()).toEqual(rows);
  });

  it("is null for a phase without published groups", async () => {
    expect(await phaseProjection(1, 2)).toBeNull();
  });
});
