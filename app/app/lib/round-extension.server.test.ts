// round-extension.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the organizer extends the running round (#356, D151). The
// fixture is deadline.server.test.ts's (7 pairs, round 1 published); email is
// captured, never sent.
import { budapestTime } from "@padel-liga/rules";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, extended: [] as any[], race: null as string | null }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
// Another organizer's extension lands right after the season was read.
vi.mock("~/lib/seasons.server", async (original) => {
  const real = await original<typeof import("~/lib/seasons.server")>();
  return {
    ...real,
    getSeason: async (id: number) => {
      const out = await real.getSeason(id);
      if (h.race) h.raw.exec(h.race);
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
  queueRoundExtended: async (messages: any[]) => h.extended.push(...messages),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const G = await import("~/lib/groups.server");
const E = await import("~/lib/season-entries.server");
const X = await import("~/lib/round-extension.server");
const { CHANGED, NOT_EXTENDABLE, NOT_LATER } = await import("~/lib/round-extension");
const { resolveDeadlines } = await import("~/lib/deadline.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (day: string, hour: number, minute = 0) => budapestTime(day, hour, minute);
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

// Round 1: 9–29 Nov 2026, then 2–4 back to back (no break).
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2026-12-20T23:00:00Z", "2027-01-10T23:00:00Z"];
const PUBLISHED = new Date("2026-11-08T08:00:00Z");
const NOW = at("2026-11-20", 11);
const ORG = { id: "o" };

async function freshDb(publish = true) {
  h.raw = migratedDatabase();
  h.extended = [];
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
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
  if (publish) expect(await G.publishGroups(1, "o", PUBLISHED)).toEqual({ ok: true });
  h.raw.exec("delete from notifications");
  h.raw.exec("delete from email_messages");
}

const all = (q: string, ...params: unknown[]) => h.raw.prepare(q).all(...params);
const one = (q: string, ...params: unknown[]) => h.raw.prepare(q).get(...params);
const phases = () => all("select number, starts_at, deadline from season_phases where season_id = 1 order by number");
const audits = () => all("select actor_id, action, target, detail, league_id from audit_log where action = 'phase.extend'");
const NEW_DEADLINE = unix(at("2026-12-06", 23, 59));

describe("extending the running round (#356)", () => {
  beforeEach(() => freshDb());

  it("moves the round's and its matches' deadline, shifts rounds 2–4 a week, one audit entry", async () => {
    const before = phases();
    expect(await X.extendRunningRound(ORG, 1, 1, "2026-12-06", NOW)).toEqual({ ok: true });

    const after = phases();
    expect(after[0]).toEqual({ number: 1, starts_at: before[0].starts_at, deadline: NEW_DEADLINE });
    for (const n of [1, 2, 3]) {
      expect(after[n].starts_at - before[n].starts_at, `round ${n + 1}`).toBe(7 * 86400);
      expect(after[n].deadline - before[n].deadline, `round ${n + 1}`).toBe(7 * 86400);
    }
    expect(after[1].starts_at).toBe(unix(at("2026-12-07", 0)));
    // Every match of the round, and nothing else about them.
    const matches = all("select deadline, status, revision from matches");
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) expect(m).toEqual({ deadline: NEW_DEADLINE, status: "open", revision: 0 });
    expect(audits()).toEqual([{ actor_id: "o", action: "phase.extend", target: "season:1", detail: "phase 1: 2026-11-29 → 2026-12-06", league_id: 1 }]);
  });

  it("one notice (pushed later) and one email per player of the round, with the new deadline", async () => {
    await X.extendRunningRound(ORG, 1, 1, "2026-12-06", NOW);
    const notices = all("select user_id, kind, title, body, push_due_at from notifications order by user_id");
    expect(notices).toHaveLength(14);
    expect(new Set(notices.map((n: any) => n.user_id)).size).toBe(14);
    expect(notices[0]).toMatchObject({
      kind: "round_extended",
      title: "Meghosszabbítottuk a kört",
      body: "Meghosszabbítottuk az 1. kört: új határidő dec. 6., vasárnap 23:59. 2026/27 tél, Padelpárbaj Győr.",
    });
    expect(notices.every((n: any) => n.push_due_at !== null)).toBe(true);
    expect(h.extended).toHaveLength(14);
    expect(h.extended[0].input).toMatchObject({ league: "Padelpárbaj Győr", season: "2026/27 tél", phase: 1, nextStart: at("2026-12-07", 0) });
    expect(h.extended[0].input.deadline).toEqual(new Date(NEW_DEADLINE * 1000));
  });

  it("a pair withdrawn mid-phase and a deleted account hear nothing", async () => {
    expect(await E.withdrawPairMidPhase(ORG, 1, 7, 1, "Sérülés.", NOW)).toMatchObject({ ok: true });
    h.raw.exec("delete from notifications");
    h.raw.exec(`update users set deleted_at = ${unix(NOW)} where id = 'p6b'`);
    await X.extendRunningRound(ORG, 1, 1, "2026-12-06", NOW);
    const to = all("select user_id from notifications").map((n: any) => n.user_id);
    expect(to).toHaveLength(11);
    expect(to).not.toContain("p7a");
    expect(to).not.toContain("p7b");
    expect(to).not.toContain("p6b");
    expect(h.extended.map((m: any) => m.toEmail)).not.toContain("p6b@x.hu");
  });

  it("the deadline resolution waits for the new deadline", async () => {
    await X.extendRunningRound(ORG, 1, 1, "2026-12-06", NOW);
    // The Monday after the old deadline, from 06:00: nothing.
    expect(await resolveDeadlines(at("2026-11-30", 7))).toEqual({ resolved: 0, left: false });
    expect(one("select count(*) as n from matches where status = 'final'").n).toBe(0);
    // The Monday after the new one: the unplayed matches are settled.
    expect((await resolveDeadlines(at("2026-12-07", 7))).resolved).toBeGreaterThan(0);
  });

  it("the '3 days before the deadline' reminder comes again for an unplayed match", async () => {
    const [first, second] = all("select id from matches order by id").map((m: any) => m.id);
    h.raw.prepare("insert into match_reminders (match_id, kind, slot, sent_at) values (?, 'match_deadline_soon', 0, ?)").run(first, unix(NOW));
    h.raw.prepare("insert into match_reminders (match_id, kind, slot, sent_at) values (?, 'match_week_end', 0, ?)").run(first, unix(NOW));
    // A played match keeps its claim (it gets no reminder anyway).
    h.raw.prepare(`update matches set status = 'final', outcome = '{"kind":"played","score":{"sets":[[4,1],[4,1]]}}' where id = ?`).run(second);
    h.raw.prepare("insert into match_reminders (match_id, kind, slot, sent_at) values (?, 'match_deadline_soon', 0, ?)").run(second, unix(NOW));
    await X.extendRunningRound(ORG, 1, 1, "2026-12-06", NOW);
    expect(all("select match_id, kind from match_reminders order by match_id, kind")).toEqual([
      { match_id: first, kind: "match_week_end" },
      { match_id: second, kind: "match_deadline_soon" },
    ]);
  });

  it("can extend again, to a Sunday after the new deadline", async () => {
    await X.extendRunningRound(ORG, 1, 1, "2026-12-06", NOW);
    expect(await X.extendRunningRound(ORG, 1, 1, "2026-12-13", NOW)).toEqual({ ok: true });
    expect(phases()[0].deadline).toBe(unix(at("2026-12-13", 23, 59)));
    expect(phases()[3].starts_at).toBe(unix(at("2027-01-25", 0)));
    expect(audits()).toHaveLength(2);
  });

  it("refuses an earlier or the same deadline, a weekday, and more than 4 weeks, and changes nothing", async () => {
    const before = phases();
    for (const bad of ["2026-11-29", "2026-11-22", "2026-12-05", "2027-01-03", ""])
      expect(await X.extendRunningRound(ORG, 1, 1, bad, NOW)).toEqual({ ok: false, error: NOT_LATER });
    expect(phases()).toEqual(before);
    expect(audits()).toEqual([]);
    expect(all("select * from notifications")).toEqual([]);
  });

  it("refuses a round past its deadline, another round, and a stale page", async () => {
    // After the deadline (the resolution may have run).
    expect(await X.extendRunningRound(ORG, 1, 1, "2026-12-06", at("2026-11-30", 0, 1))).toEqual({ ok: false, error: NOT_EXTENDABLE });
    expect(await X.extendRunningRound(ORG, 1, 2, "2026-12-27", NOW)).toEqual({ ok: false, error: NOT_EXTENDABLE });
    // Extended meanwhile to 6 Dec: the same choice from the old page is no
    // longer on offer (the next ones are 13 Dec on).
    await X.extendRunningRound(ORG, 1, 1, "2026-12-06", NOW);
    expect(await X.extendRunningRound(ORG, 1, 1, "2026-12-06", NOW)).toEqual({ ok: false, error: NOT_LATER });
    expect(audits()).toHaveLength(1);
  });

  it("an extension from a page read before another one landed changes nothing", async () => {
    const before = phases();
    h.race = `update season_phases set deadline = deadline + ${7 * 86400} where season_id = 1 and number = 1`;
    expect(await X.extendRunningRound(ORG, 1, 1, "2026-12-13", NOW)).toEqual({ ok: false, error: CHANGED });
    expect(phases().slice(1)).toEqual(before.slice(1));
    expect(all("select distinct deadline from matches")).toEqual([{ deadline: before[0].deadline }]);
    expect(audits()).toEqual([]);
    expect(all("select * from notifications")).toEqual([]);
    expect(h.extended).toEqual([]);
  });

  it("refuses a season without a published round", async () => {
    await freshDb(false);
    expect(await X.extendRunningRound(ORG, 1, 1, "2026-12-06", NOW)).toEqual({ ok: false, error: NOT_EXTENDABLE });
    expect(await X.extendRunningRound(ORG, 99, 1, "2026-12-06", NOW)).toEqual({ ok: false, error: NOT_EXTENDABLE });
    expect(phases()[0].deadline).toBe(sec(PHASES[0]!) + 21 * 86400 - 60);
  });
});
