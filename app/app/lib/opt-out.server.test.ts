// Default in and "Nem folytatom" (#395, D176) on a real SQLite with every
// migration applied (~/test/sqlite): the opt-out and its undo, their Napló
// entries and the partner's notice, the server's refusals, the round
// switch's draft and Párok. Email is stubbed; nothing here may queue any.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

// No VAPID keys: notifications are stored, not pushed.
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueGroupsPublished: async (messages: any[]) => h.mails.push(...messages),
  queueStrikeWarnings: async (messages: any[]) => h.mails.push(...messages),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const G = await import("~/lib/groups.server");
const R = await import("~/lib/round-switch.server");
const O = await import("~/lib/opt-out.server");
const P = await import("~/lib/pairs.server");
const S = await import("~/lib/seasons.server");
const { OPT_OUT_REFUSALS } = await import("~/lib/opt-out");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

// Phases from Monday 9 Nov 2026 (Budapest, UTC+1), 3 weeks each.
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2026-12-20T23:00:00Z", "2027-01-10T23:00:00Z"];
const BEFORE = new Date("2026-11-07T10:00:00Z");
const DURING = new Date("2026-11-20T10:00:00Z");
// Phase 1's deadline: Sunday 29 Nov 23:59 Budapest.
const DEADLINE = new Date("2026-11-29T22:59:00Z");
const LATE = new Date("2026-11-29T22:59:30Z");
// Monday after phase 1's deadline, 07:00 Budapest.
const AFTER = new Date("2026-11-30T06:00:00Z");

// Average starting Elo by pair id: 1600, 1500, 1400, 1400, 1300, 1200, 1100, 1100.
const LEVELS: [string, string][] = [
  ["versenyzo", "versenyzo"],
  ["versenyzo", "halado"],
  ["halado", "halado"],
  ["halado", "halado"],
  ["halado", "kozephalado"],
  ["kozephalado", "kozephalado"],
  ["kozephalado", "kezdo"],
  ["kozephalado", "kezdo"],
];

async function freshDb() {
  h.raw = migratedDatabase();
  h.mails = [];
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  h.raw.exec(`update leagues set fast_switches = 0`);
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('o', 'o@x.hu', 'Org', 'versenyzo', 1)`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, 'Ősz', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  PHASES.forEach((start, i) =>
    h.raw
      .prepare("insert into season_phases (season_id, number, starts_at, deadline, set_games) values (1, ?, ?, ?, 4)")
      .run(i + 1, sec(start), sec(start) + 21 * 86400 - 60),
  );
  LEVELS.forEach(([a, b], i) => {
    const id = i + 1;
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, ?, 1)").run(`p${id}a`, `p${id}a@x.hu`, `Játékos ${id}A`, a);
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, ?, 1)").run(`p${id}b`, `p${id}b@x.hu`, `Játékos ${id}B`, b);
    h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)").run(id, `p${id}a`, `p${id}b`);
    h.raw
      .prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, 'approved', 1, ?)")
      .run(id, sec("2026-11-06T10:00:00Z") + id);
  });
  expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
  expect(await G.publishGroups(1, "o", BEFORE)).toEqual({ ok: true });
  h.mails = [];
  // Not counted below: the publish's own entries and notices.
  h.raw.exec("delete from audit_log");
  h.raw.exec("delete from notifications");
}

const all = (q: string, ...params: unknown[]) => h.raw.prepare(q).all(...params);
const won = (a: number, b: number) => JSON.stringify({ kind: "played", score: { sets: a < b ? [[4, 1], [4, 1]] : [[1, 4], [1, 4]] } });
// Every phase-1 match final, the pair with the lower id winning.
function finishAll() {
  for (const m of all("select id, pair_a, pair_b from matches"))
    h.raw.prepare("update matches set status = 'final', outcome = ? where id = ?").run(won(m.pair_a, m.pair_b), m.id);
}
const ids = (draft: { pairId: number }[][]) => draft.map((g) => g.map((p) => p.pairId));
const season = async () => (await S.getSeason(1))!;
const optOut = (user: string, now = DURING) => O.optOut({ id: user }, 1, 1, now);
const undo = (user: string, now = DURING) => O.undoOptOut({ id: user }, 1, 1, now);

describe("default in (#395)", () => {
  beforeEach(freshDb);

  it("drafts a pair that does nothing into the next round", async () => {
    finishAll();
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.leaving).toEqual([]);
    // Groups 1–4 and 5–8, 1 swaps: 5 up, 4 down.
    expect(ids(s.draft)).toEqual([
      [1, 2, 3, 5],
      [4, 6, 7, 8],
    ]);
  });

  it("shows the card's line during the round and nothing after the deadline", async () => {
    expect((await O.optOutCard("p1a", 1, await season(), DURING))?.kind).toBe("in");
    expect(await O.optOutCard("p1a", 1, await season(), AFTER)).toBeNull();
  });
});

describe("Nem folytatom (#395)", () => {
  beforeEach(freshDb);

  it("leaves the pair out of the draft as 'nem folytatja'; its matches still count, and the pairs below move up", async () => {
    expect(await optOut("p2a")).toEqual({ ok: true });
    expect(all("select opt_out_phase, opted_out_by from season_entries where pair_id = 2")).toEqual([{ opt_out_phase: 1, opted_out_by: "p2a" }]);
    finishAll();
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    // Pair 2 is still in group 1's final table, 2nd: its matches count.
    expect(s.tables[0]!.rows.map((r) => [r.pair.pairId, r.place])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    expect(s.leaving.map((l) => [l.pair.pairId, l.reason])).toEqual([[2, "opted_out"]]);
    expect(ids(s.draft).flat()).not.toContain(2);
    expect(ids(s.draft)).toEqual([[1, 3, 4, 5], [6, 7, 8]]);
  });

  it("leaves out two pairs of one group that opt out", async () => {
    expect(await optOut("p6a")).toEqual({ ok: true });
    expect(await optOut("p7b")).toEqual({ ok: true });
    finishAll();
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.leaving.map((l) => [l.pair.pairId, l.reason]).sort()).toEqual([
      [6, "opted_out"],
      [7, "opted_out"],
    ]);
    // 6 pairs left: 3+3, re-cut top-down after promotion (5 up, 4 down).
    expect(ids(s.draft)).toEqual([
      [1, 2, 3],
      [4, 5, 8],
    ]);
  });

  it("writes one Napló entry with the player as actor and tells the partner only, in the app, with no email", async () => {
    expect(await optOut("p2a")).toEqual({ ok: true });
    expect(all("select actor_id, action, target, detail, league_id from audit_log")).toEqual([
      { actor_id: "p2a", action: "season_entry.opt_out", target: "pair:2", detail: "season:1 round:1", league_id: 1 },
    ]);
    const sent = all("select user_id, kind, title, body, url from notifications");
    expect(sent).toEqual([
      {
        user_id: "p2b",
        kind: "pair_opt_out",
        title: "A párod nem folytatja",
        body: "A párod nem folytatja a 2. körben, így a párotok kimarad belőle. Ősz, Padelpárbaj Győr.",
        url: "/leagues",
      },
    ]);
    expect(h.mails).toEqual([]);
    expect(all("select count(*) as n from email_messages")[0].n).toBe(0);
  });

  it("refuses a second opt-out of the pair, and a request after the deadline, in Hungarian", async () => {
    expect(await optOut("p2a")).toEqual({ ok: true });
    expect(await optOut("p2b")).toEqual({ ok: false, error: OPT_OUT_REFUSALS.already });
    expect(await optOut("p3a", DEADLINE)).toEqual({ ok: true });
    expect(await optOut("p4a", LATE)).toEqual({ ok: false, error: OPT_OUT_REFUSALS.deadline });
    expect(await optOut("p4a", AFTER)).toEqual({ ok: false, error: OPT_OUT_REFUSALS.deadline });
    expect(all("select pair_id from season_entries where opt_out_phase is not null order by pair_id")).toEqual([{ pair_id: 2 }, { pair_id: 3 }]);
  });

  it("refuses before the round starts, in the season's last round, a withdrawn pair and a player without a pair", async () => {
    expect(await optOut("p2a", BEFORE)).toEqual({ ok: false, error: OPT_OUT_REFUSALS.no_round });
    h.raw.exec("update groups set phase = 4");
    expect(await optOut("p2a", new Date("2027-01-20T10:00:00Z"))).toEqual({ ok: false, error: OPT_OUT_REFUSALS.last_round });
    h.raw.exec("update groups set phase = 1");
    h.raw.exec("update group_pairs set withdrawn_at = 1, withdrawal_reason = 'x' where pair_id = 3");
    expect(await optOut("p3a")).toEqual({ ok: false, error: OPT_OUT_REFUSALS.no_round });
    expect(await optOut("o")).toEqual({ ok: false, error: OPT_OUT_REFUSALS.no_pair });
    expect(all("select count(*) as n from audit_log")[0].n).toBe(0);
    expect(all("select count(*) as n from notifications")[0].n).toBe(0);
  });

  it("shows both players the opt-out on the card; Párok shows 'Kilép a kör végén', then that it left", async () => {
    await optOut("p2a");
    expect(await O.optOutCard("p2a", 1, await season(), DURING)).toMatchObject({ kind: "out", mine: true });
    expect(await O.optOutCard("p2b", 1, await season(), DURING)).toMatchObject({ kind: "out", mine: false });
    expect(await O.optOutCard("p2b", 1, await season(), AFTER)).toEqual({ kind: "left", round: 1 });
    const row = async (now: Date) => (await P.leaguePairs(1, now)).find((r) => r.id === 2)!.optOut;
    expect(await row(DURING)).toEqual({ round: 1, ended: false });
    expect(await row(AFTER)).toEqual({ round: 1, ended: true });
    expect((await P.leaguePairs(1, DURING)).find((r) => r.id === 1)!.optOut).toBeNull();
  });
});

describe("Mégis folytatom (#395)", () => {
  beforeEach(freshDb);

  it("puts the pair back into the draft, with its own Napló entry and notice", async () => {
    await optOut("p2a");
    expect(await undo("p2a")).toEqual({ ok: true });
    expect(all("select opt_out_phase, opted_out_by, opted_out_at from season_entries where pair_id = 2")).toEqual([
      { opt_out_phase: null, opted_out_by: null, opted_out_at: null },
    ]);
    expect(all("select actor_id, action from audit_log order by id")).toEqual([
      { actor_id: "p2a", action: "season_entry.opt_out" },
      { actor_id: "p2a", action: "season_entry.opt_out_undo" },
    ]);
    expect(all("select user_id, title from notifications order by id")).toEqual([
      { user_id: "p2b", title: "A párod nem folytatja" },
      { user_id: "p2b", title: "A párod mégis folytatja" },
    ]);
    finishAll();
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.leaving).toEqual([]);
    expect(ids(s.draft).flat()).toContain(2);
  });

  it("is only for the player who opted out, and only until the deadline", async () => {
    await optOut("p2a");
    expect(await undo("p2b")).toEqual({ ok: false, error: OPT_OUT_REFUSALS.not_mine });
    expect(await undo("p2a", LATE)).toEqual({ ok: false, error: OPT_OUT_REFUSALS.deadline });
    expect(await undo("p3a")).toEqual({ ok: false, error: OPT_OUT_REFUSALS.not_out });
    expect(all("select opt_out_phase from season_entries where pair_id = 2")).toEqual([{ opt_out_phase: 1 }]);
    expect(all("select count(*) as n from audit_log")[0].n).toBe(1);
  });
});

describe("after the deadline (#395 requirement 7)", () => {
  beforeEach(freshDb);

  it("still leaves as 'nem folytatja' once the pair is dissolved to form new pairs", async () => {
    await optOut("p2a");
    finishAll();
    expect(await P.dissolvePair("o", 1, 2, AFTER)).toEqual({ ok: true });
    const s = (await R.roundSwitch(1, 2, AFTER))!;
    expect(s.leaving.map((l) => [l.pair.pairId, l.reason])).toEqual([[2, "opted_out"]]);
  });
});
