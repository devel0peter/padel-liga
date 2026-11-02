// matches.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the player's group and matches (#25). The groups are published with groups.server.ts; email is stubbed.
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
});
