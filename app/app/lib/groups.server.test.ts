// groups.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the first-phase draft, moves, publishing and the lock
// (#24, D20-D22). Email is stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

// No VAPID keys: notifications are stored, not pushed.
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({ listedCities: async () => [{ slug: "gyor" }] }));
vi.mock("~/lib/email/outbox.server", () => ({
  queueGroupsPublished: async (messages: any[]) => h.mails.push(...messages),
  queueSeasonEntered: async (to: string, input: any) => h.mails.push({ kind: "decision", toEmail: to, input }),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const G = await import("~/lib/groups.server");
const S = await import("~/lib/seasons.server");
const P = await import("~/lib/pairs.server");
const { DISSOLVE_REFUSED } = await import("~/lib/pairs");
const E = await import("~/lib/season-entries.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

// The first season: phases from Monday 9 Nov 2026 (Budapest, UTC+1).
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const PHASE_1_DEADLINE = sec(PHASES[0]!) + 21 * 86400 - 60;
const NOW = new Date("2026-11-07T10:00:00Z");
const APPROVED = sec("2026-11-06T10:00:00Z");

// Levels of the 10 pairs that make the 4+3+3 draft, by pair id. Average
// starting Elo: 1600, 1500, 1400, 1400, 1300, 1200, 1100, 1100, 1000, 1000.
const TEN: [string, string][] = [
  ["versenyzo", "versenyzo"],
  ["versenyzo", "halado"],
  ["halado", "halado"],
  ["halado", "halado"],
  ["halado", "kozephalado"],
  ["kozephalado", "kozephalado"],
  ["kozephalado", "kezdo"],
  ["kozephalado", "kezdo"],
  ["kezdo", "kezdo"],
  ["kezdo", "kezdo"],
];

function addPair(
  id: number,
  levels: [string, string],
  entry: { status?: string; joinsPhase?: number | null; decidedAt?: number; pairStatus?: string } = {},
) {
  for (const side of ["a", "b"] as const)
    h.raw
      .prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, ?, 1)")
      .run(`p${id}${side}`, `p${id}${side}@x.hu`, `Játékos ${id}${side.toUpperCase()}`, levels[side === "a" ? 0 : 1]);
  h.raw
    .prepare("insert into pairs (id, league_id, player_a, player_b, status) values (?, 1, ?, ?, ?)")
    .run(id, `p${id}a`, `p${id}b`, entry.pairStatus ?? "active");
  const status = entry.status ?? "approved";
  h.raw
    .prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, ?, ?, ?)")
    .run(id, status, entry.joinsPhase === undefined ? (status === "approved" ? 1 : null) : entry.joinsPhase, entry.decidedAt ?? APPROVED + id);
}

function freshDb(pairCount = 10) {
  h.raw = migratedDatabase();
  h.mails = [];
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('o', 'o@x.hu', 'Org', 'versenyzo', 1)`);
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
  // Pair 4 was approved before pair 3: on their Elo tie it is seeded higher.
  TEN.slice(0, pairCount).forEach((levels, i) => addPair(i + 1, levels, i === 3 ? { decidedAt: APPROVED } : {}));
}

const all = (q: string, ...params: unknown[]) => h.raw.prepare(q).all(...params);
// The stored draft: pair ids per group number, by seed.
const draft = () => {
  const rows = all(
    "select g.number, gp.pair_id from groups g left join group_pairs gp on gp.group_id = g.id where g.season_id = 1 order by g.number, gp.seed",
  );
  const out: number[][] = [];
  for (const r of rows) {
    out[r.number - 1] ??= [];
    if (r.pair_id !== null) out[r.number - 1]!.push(r.pair_id);
  }
  return out;
};

describe("first-phase groups on real SQLite", () => {
  beforeEach(() => freshDb());

  it("10 approved pairs give a 4+3+3 draft by Elo, ties by approval order", async () => {
    expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
    expect(draft()).toEqual([
      [1, 2, 4, 3],
      [5, 6, 7],
      [8, 9, 10],
    ]);
    expect(all("select published_at from groups").every((r: any) => r.published_at === null)).toBe(true);
  });

  it("the organizer can move a pair, and the move is stored and re-seeded", async () => {
    await G.generateDraft(1, "o");
    // Pair 3 (1400) moves down to group 2 and is seeded first there.
    expect(await G.moveDraftPair(1, 3, 2, "o")).toEqual({ ok: true });
    expect(draft()).toEqual([
      [1, 2, 4],
      [3, 5, 6, 7],
      [8, 9, 10],
    ]);
    // Pair 10 moves up to group 1: seeded last.
    expect(await G.moveDraftPair(1, 10, 1, "o")).toEqual({ ok: true });
    expect(draft()[0]).toEqual([1, 2, 4, 10]);
    expect(draft()[2]).toEqual([8, 9]);
  });

  it("leaves out dissolved, pending, rejected, withdrawn and later-phase pairs", async () => {
    // A pair dissolved after phase 1 started keeps its approved entry (D19).
    addPair(11, ["versenyzo", "versenyzo"], { pairStatus: "dissolved" });
    addPair(12, ["versenyzo", "versenyzo"], { status: "pending" });
    addPair(13, ["versenyzo", "versenyzo"], { status: "rejected" });
    addPair(14, ["versenyzo", "versenyzo"], { status: "withdrawn", joinsPhase: 1 });
    addPair(15, ["versenyzo", "versenyzo"], { joinsPhase: 2 });
    addPair(16, ["versenyzo", "versenyzo"], { joinsPhase: null });
    expect((await G.eligiblePairs(1)).map((p) => p.pairId)).toEqual([4, 1, 2, 3, 5, 6, 7, 8, 9, 10]);
    await G.generateDraft(1, "o");
    expect(draft().flat().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("regenerating replaces the draft and drops the moves", async () => {
    await G.generateDraft(1, "o");
    await G.moveDraftPair(1, 3, 2, "o");
    expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
    expect(draft()).toEqual([
      [1, 2, 4, 3],
      [5, 6, 7],
      [8, 9, 10],
    ]);
    expect(all("select count(*) n from groups")[0].n).toBe(3);
  });

  it.each([0, 1, 2, 5])("stores no draft for %i approved pairs", async (n) => {
    freshDb(n);
    const result = await G.generateDraft(1, "o");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/3, 4 vagy legalább 6 párból/);
    expect(draft()).toEqual([]);
  });

  it("3 or 4 approved pairs make a single group", async () => {
    freshDb(3);
    await G.generateDraft(1, "o");
    expect(draft()).toEqual([[1, 2, 3]]);
  });

  it("publishing creates every group's matches and emails every player once", async () => {
    await G.generateDraft(1, "o");
    expect(await G.publishGroups(1, "o", NOW)).toEqual({ ok: true });

    const rows = all(
      "select g.number, m.week, m.pair_a, m.pair_b, m.deadline, m.status from matches m join groups g on g.id = m.group_id order by g.number, m.week, m.id",
    );
    expect(rows).toHaveLength(12);
    expect(rows.every((r: any) => r.deadline === PHASE_1_DEADLINE && r.status === "open")).toBe(true);
    const of = (n: number) => rows.filter((r: any) => r.number === n).map((r: any) => `${r.week}:${r.pair_a}-${r.pair_b}`);
    // Seeds 1–4 of group 1 are pairs 1, 2, 4, 3.
    expect(of(1)).toEqual(["1:1-3", "1:2-4", "2:1-4", "2:2-3", "3:1-2", "3:4-3"]);
    expect(of(2)).toEqual(["1:6-7", "2:5-7", "3:5-6"]);
    expect(of(3)).toEqual(["1:9-10", "2:8-10", "3:8-9"]);
    expect(all("select published_at from groups").every((r: any) => r.published_at === sec(NOW.toISOString()))).toBe(true);

    // One email per player: 10 pairs, 20 players, each address once.
    expect(h.mails).toHaveLength(20);
    expect(new Set(h.mails.map((m) => m.toEmail)).size).toBe(20);
    const anna = h.mails.find((m) => m.toEmail === "p1a@x.hu")!;
    expect(anna.input).toMatchObject({
      to: "Játékos 1A",
      partnerName: "Játékos 1B",
      league: "Padelpárbaj Győr",
      season: "2026/27 tél",
      phase: 1,
      group: 1,
      deadline: new Date(PHASE_1_DEADLINE * 1000),
    });
    expect(anna.input.weeks).toEqual([
      { week: 1, range: "nov. 9. – nov. 15.", opponents: ["Játékos 3A", "Játékos 3B"] },
      { week: 2, range: "nov. 16. – nov. 22.", opponents: ["Játékos 4A", "Játékos 4B"] },
      { week: 3, range: "nov. 23. – nov. 29.", opponents: ["Játékos 2A", "Játékos 2B"] },
    ]);
    // Seed 1 of a group of 3 rests in week 1.
    expect(h.mails.find((m) => m.toEmail === "p5b@x.hu")!.input.weeks[0].opponents).toBeNull();
    // Names only: no other player's email in what the template gets.
    for (const m of h.mails) expect(JSON.stringify(m.input)).not.toContain("@");

    // And one in-app notification per player (#115), with their group.
    const inbox = all("select n.kind, n.title, n.url, u.email from notifications n join users u on u.id = n.user_id");
    expect(inbox).toHaveLength(20);
    expect(new Set(inbox.map((n: any) => n.email)).size).toBe(20);
    expect(inbox.every((n: any) => n.kind === "groups_published" && n.url === "/home")).toBe(true);
    expect(inbox.find((n: any) => n.email === "p1a@x.hu")!.title).toBe("Itt a csoportod: 1. csoport");
    expect(inbox.find((n: any) => n.email === "p5b@x.hu")!.title).toBe("Itt a csoportod: 2. csoport");
  });

  it("a group of 2 or 5 can't be published", async () => {
    await G.generateDraft(1, "o");
    // Group 1 gets 5 pairs, group 2 is left with 2.
    await G.moveDraftPair(1, 5, 1, "o");
    expect(draft().map((g) => g.length)).toEqual([5, 2, 3]);
    const result = await G.publishGroups(1, "o", NOW);
    expect(result).toEqual({ ok: false, error: "Minden csoportban 3 vagy 4 pár legyen. Helyezz át párokat, vagy generáld újra." });
    expect(all("select count(*) n from matches")[0].n).toBe(0);
    expect(all("select count(*) n from groups where published_at is not null")[0].n).toBe(0);
    expect(h.mails).toEqual([]);
  });

  it("a draft that no longer matches the approved pairs can't be published", async () => {
    await G.generateDraft(1, "o");
    // Pair 10 is dissolved after the draft was made.
    h.raw.exec("update pairs set status = 'dissolved' where id = 10");
    expect(await G.publishGroups(1, "o", NOW)).toEqual({
      ok: false,
      error: "A nevezett párok változtak a javaslat óta. Generáld újra.",
    });
    expect(all("select count(*) n from matches")[0].n).toBe(0);
    // A new draft leaves the dissolved pair out: 9 pairs, 3+3+3.
    await G.generateDraft(1, "o");
    expect(draft()).toEqual([
      [1, 2, 4],
      [3, 5, 6],
      [7, 8, 9],
    ]);
  });

  it("after publishing the groups are locked and the season can't be edited or deleted", async () => {
    await G.generateDraft(1, "o");
    await G.publishGroups(1, "o", NOW);
    const locked = { ok: false, error: "A csoportok már kint vannak, nem módosíthatók." };
    expect(await G.generateDraft(1, "o")).toEqual(locked);
    expect(await G.moveDraftPair(1, 3, 2, "o")).toEqual(locked);
    expect(await G.publishGroups(1, "o", NOW)).toEqual(locked);
    expect(draft()).toEqual([
      [1, 2, 4, 3],
      [5, 6, 7],
      [8, 9, 10],
    ]);
    expect(all("select count(*) n from matches")[0].n).toBe(12);
    expect(h.mails).toHaveLength(20);

    expect(await S.seasonState(1)).toMatchObject({ groupsPublished: true });
    // Even with every entry withdrawn, the published season isn't deleted.
    h.raw.exec("update season_entries set status = 'withdrawn'");
    expect(await S.deleteSeason(1, "o")).toBe(false);
  });

  it("a season without published groups can still be edited", async () => {
    await G.generateDraft(1, "o");
    expect(await S.seasonState(1)).toMatchObject({ groupsPublished: false });
  });

  it("refuses a move of a pair not in the draft or into a group that doesn't exist", async () => {
    await G.generateDraft(1, "o");
    const changed = { ok: false, error: "A javaslat közben változott. Frissítsd az oldalt." };
    expect(await G.moveDraftPair(1, 99, 2, "o")).toEqual(changed);
    expect(await G.moveDraftPair(1, 3, 9, "o")).toEqual(changed);
  });

  it("publishing without a draft is refused", async () => {
    expect(await G.publishGroups(1, "o", NOW)).toEqual({ ok: false, error: "Még nincs javaslat." });
  });

  it("a move made while publishing is checked stops the publish, with nothing written", async () => {
    await G.generateDraft(1, "o");
    // Right before the publish locks the groups, another organizer moves pair
    // 5 into group 1 (5+2+3), as moveDraftPair would.
    const raw = h.raw;
    let moved = false;
    h.raw = new Proxy(raw, {
      get(target, prop) {
        if (prop !== "prepare") {
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (q: string) => {
          if (!moved && /^update "groups" set "published_at"/.test(q)) {
            moved = true;
            target.exec(`update group_pairs set group_id = (select id from groups where number = 1) where pair_id = 5`);
            target.exec(`update groups set revision = revision + 1 where number in (1, 2)`);
          }
          return target.prepare(q);
        };
      },
    });
    const result = await G.publishGroups(1, "o", NOW);
    h.raw = raw;
    expect(moved).toBe(true);
    expect(result).toEqual({ ok: false, error: "A javaslat közben változott. Frissítsd az oldalt." });
    expect(all("select count(*) n from matches")[0].n).toBe(0);
    expect(all("select count(*) n from groups where published_at is not null")[0].n).toBe(0);
    expect(h.mails).toEqual([]);
  });

  it("a pair dissolved while publishing is checked stops the publish", async () => {
    await G.generateDraft(1, "o");
    const raw = h.raw;
    let dissolved = false;
    h.raw = new Proxy(raw, {
      get(target, prop) {
        if (prop !== "prepare") {
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (q: string) => {
          if (!dissolved && /^update "groups" set "published_at"/.test(q)) {
            dissolved = true;
            target.exec(`update pairs set status = 'dissolved' where id = 7`);
          }
          return target.prepare(q);
        };
      },
    });
    const result = await G.publishGroups(1, "o", NOW);
    h.raw = raw;
    expect(dissolved).toBe(true);
    expect(result).toEqual({ ok: false, error: "A javaslat közben változott. Frissítsd az oldalt." });
    expect(all("select count(*) n from matches")[0].n).toBe(0);
    expect(h.mails).toEqual([]);
  });

  it("a move bumps the revision of both groups it touches", async () => {
    await G.generateDraft(1, "o");
    await G.moveDraftPair(1, 3, 2, "o");
    expect(all("select number, revision from groups order by number")).toEqual([
      { number: 1, revision: 1 },
      { number: 2, revision: 1 },
      { number: 3, revision: 0 },
    ]);
  });

  it("an Elo tie in the target group goes by approval order after a move (D20)", async () => {
    // Pair 4 (1400, approved first) is in group 1 with pair 3 (1400). Move 4
    // to group 2, then back: it is seeded above 3 again, not by move order.
    await G.generateDraft(1, "o");
    await G.moveDraftPair(1, 4, 2, "o");
    await G.moveDraftPair(1, 4, 1, "o");
    expect(draft()[0]).toEqual([1, 2, 4, 3]);
  });

  it("drafts and publishes a big league within D1's 100-parameter limit", async () => {
    freshDb(0);
    const levels = ["kezdo", "kozephalado", "halado", "versenyzo"];
    for (let i = 1; i <= 100; i++) addPair(i, [levels[i % 4]!, levels[(i >> 2) % 4]!]);
    expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
    expect(draft()).toHaveLength(25);
    expect(await G.moveDraftPair(1, draft()[0]![0]!, 25, "o")).toEqual({ ok: true });
    expect(await G.moveDraftPair(1, draft()[24]![0]!, 1, "o")).toEqual({ ok: true });
    expect(await G.publishGroups(1, "o", NOW)).toEqual({ ok: true });
    expect(all("select count(*) n from matches")[0].n).toBe(150);
    expect(h.mails).toHaveLength(200);
    // The Párok page lists 100 locked pairs within the limit too (#97).
    expect((await P.leaguePairs(1, NOW)).filter((r) => r.locked)).toHaveLength(100);
  });

  describe("after publishing", () => {
    beforeEach(async () => {
      await G.generateDraft(1, "o");
      await G.publishGroups(1, "o", NOW);
    });

    it("a pair in a published group can't be dissolved or changed until its round's deadline (#97)", async () => {
      expect(await G.pairInRunningGroup(3, NOW)).toBe(true);
      expect(await P.dissolvePair("o", 1, 3, NOW)).toEqual({ ok: false, error: DISSOLVE_REFUSED });
      h.raw.exec("insert into users (id, email, name, consent_at) values ('free', 'free@x.hu', 'Free', 1)");
      expect(await P.changePartner("o", 1, 3, "p3a", "free", NOW)).toEqual({ ok: false, error: DISSOLVE_REFUSED });
      expect(all("select count(*) n from pairs where player_b = 'free'")[0].n).toBe(0);
      expect(all("select count(*) n from audit_log where action like 'pair.%'")[0].n).toBe(0);
      // The Párok page shows it as locked (#97).
      expect((await P.leaguePairs(1, NOW)).find((r) => r.id === 3)!.locked).toBe(true);
      expect(all("select status from pairs where id = 3")[0].status).toBe("active");
      expect(all("select status from season_entries where pair_id = 3")[0].status).toBe("approved");
      // After phase 1's deadline it is between phases again.
      expect(await G.pairInRunningGroup(3, new Date((PHASE_1_DEADLINE + 1) * 1000))).toBe(false);
    });

    it("a pair outside the groups can still be dissolved", async () => {
      addPair(20, ["kezdo", "kezdo"], { status: "pending" });
      expect(await G.pairInRunningGroup(20, NOW)).toBe(false);
      expect(await P.dissolvePair("o", 1, 20, NOW)).toEqual({ ok: true });
    });

    it("#153: a pair entering now joins phase 2, since phase 1 is locked", async () => {
      addPair(20, ["kezdo", "kezdo"], { status: "withdrawn" });
      h.raw.exec("delete from season_entries where pair_id = 20");
      const player = { id: "p20a", email: "p20a@x.hu", name: "Játékos 20A", level: "kezdo" } as any;
      expect(await E.applyToSeason(player, 1, NOW)).toMatchObject({ ok: true, joins: { phase: 2 } });
      expect(all("select status, joins_phase from season_entries where pair_id = 20")[0]).toEqual({ status: "approved", joins_phase: 2 });
      expect(h.mails.filter((m) => m.kind === "decision")[0].input.joins.phase).toBe(2);
    });
  });
});
