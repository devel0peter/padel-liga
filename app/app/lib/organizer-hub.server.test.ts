import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  raw: null as { exec: (sql: string) => void; prepare: (sql: string) => { all: () => unknown[] } } | null,
  env: {} as Record<string, string>,
}));

vi.mock("cloudflare:workers", () => ({ env: h.env, waitUntil: () => {} }));
vi.mock("cloudflare:sockets", () => ({ connect: () => { throw new Error("unused"); } }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const Stats = await import("./organizer-stats.server");
const Waiting = await import("./waiting-list.server");
const Broadcast = await import("./organizer-broadcast.server");
const Log = await import("./organizer-log.server");
const Checklist = await import("./launch-checklist.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function freshDb() {
  h.raw = migratedDatabase();
  h.raw!.exec(`
    insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('movar', 'Mosonmagyaróvár', 0);
    insert or replace into leagues (id, city, slug, name, contact_name, contact_email) values
      (1, 'gyor', 'gyor', 'Győri liga', 'Péter', 'hello@padelparbaj.hu'),
      (2, 'movar', 'movar', 'Mosonmagyaróvár', null, null);
    insert into clubs (id, slug, city, name, active) values
      (1, 'klub-a', 'gyor', 'Padel Klub A', 1),
      (2, 'klub-b', 'gyor', 'Padel Klub B', 1);
    insert into users (id, email, name, platform_role, level, phone, consent_at, created_at) values
      ('org1', 'org1@x.hu', 'Szervező Egy', 'player', 'halado', '+36301111111', 1000, ${sec("2026-11-01T10:00:00Z")}),
      ('u1', 'u1@x.hu', 'Kovács Anna', 'player', 'kezdo', '+36301111112', 1000, ${sec("2026-11-10T10:00:00Z")}),
      ('u2', 'u2@x.hu', 'Nagy Béla', 'player', 'kezdo', '+36301111113', 1000, ${sec("2026-11-10T10:00:00Z")}),
      ('u3', 'u3@x.hu', 'Szabó Csaba', 'player', 'halado', '+36301111114', 1000, ${sec("2026-11-12T10:00:00Z")}),
      ('u4', 'u4@x.hu', 'Tóth Dóra', 'player', 'halado', '+36301111115', 1000, ${sec("2026-11-12T10:00:00Z")}),
      ('s1', 's1@x.hu', 'Varga Eszter', 'player', 'kezdo', '+36301111116', 1000, ${sec("2026-11-14T10:00:00Z")}),
      ('s2', 's2@x.hu', 'Kiss Ferenc', 'player', 'kezdo', '+36301111117', 1000, ${sec("2026-11-01T10:00:00Z")});
    insert into league_admins (league_id, user_id) values (1, 'org1'), (2, 'org1');
    insert into league_members (league_id, user_id, source) values
      (1, 'u1', 'chosen'), (1, 'u2', 'chosen'), (1, 'u3', 'chosen'), (1, 'u4', 'chosen'),
      (1, 's1', 'chosen'), (1, 's2', 'chosen');
    insert into partner_searches (league_id, user_id, seeking, updated_at) values (1, 's1', 1, ${sec("2026-11-14T12:00:00Z")});
    insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values
      (1, 1, '2026/27 tél', ${sec("2026-11-01T00:00:00Z")}, ${sec("2026-11-08T22:59:00Z")}, '2026-11-09');
    insert into season_phases (season_id, number, starts_at, deadline) values
      (1, 1, ${sec("2026-11-09T00:00:00Z")}, ${sec("2026-11-29T22:59:00Z")}),
      (1, 2, ${sec("2026-11-30T00:00:00Z")}, ${sec("2026-12-20T22:59:00Z")});
    insert into pairs (id, league_id, player_a, player_b, status, source, created_at) values
      (1, 1, 'u1', 'u2', 'active', 'link', ${sec("2026-11-05T10:00:00Z")}),
      (2, 1, 'u3', 'u4', 'active', 'link', ${sec("2026-11-13T10:00:00Z")});
    insert into season_entries (season_id, pair_id, status, joins_phase, created_at, decided_at) values
      (1, 1, 'approved', 1, ${sec("2026-11-05T10:00:00Z")}, ${sec("2026-11-05T10:00:00Z")}),
      (1, 2, 'approved', 2, ${sec("2026-11-13T10:00:00Z")}, ${sec("2026-11-13T10:00:00Z")});
    insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, ${sec("2026-11-08T10:00:00Z")});
    insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1);
  `);
}

describe("organizer hub server modules (#378, #380, #381, #387, #389, #391, #401)", () => {
  beforeEach(freshDb);

  it("counts played matches per club and excludes walkovers (#401)", async () => {
    h.raw!.exec(`
      insert into pairs (id, league_id, player_a, player_b, status) values (3, 1, 's1', 's2', 'active');
      insert into group_pairs (group_id, pair_id, seed) values (1, 2, 2), (1, 3, 3);
      insert into matches (group_id, pair_a, pair_b, week, deadline, status, outcome, club_id) values
        (1, 1, 2, 1, ${sec("2026-11-29T22:59:00Z")}, 'final', '{"kind":"played","score":[[6,4],[6,3]]}', 1),
        (1, 1, 3, 2, ${sec("2026-11-29T22:59:00Z")}, 'final', '{"kind":"played","score":[[6,2],[6,4]]}', null),
        (1, 2, 3, 3, ${sec("2026-11-29T22:59:00Z")}, 'final', '{"kind":"walkover","winner":"a"}', 2);
    `);
    const table = await Stats.clubMatchCounts(1, 1);
    expect(table.grandTotal).toBe(2);
    expect(table.rows.map((r) => [r.clubName, r.total])).toEqual([
      ["Padel Klub A", 1],
      ["Nincs megadva", 1],
    ]);
  });

  it("lists waiting pairs and singles split into Párt keres and Nincs párja (#380, #381)", async () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const wl = await Waiting.leagueWaitingList(1, now);
    expect(wl.nextRoundPairs.map((p) => p.pairId)).toEqual([2]);
    expect(wl.nextRoundPairs[0].joinsPhase).toBe(2);
    expect(wl.nextRoundPairs[0].isNew).toBe(true);
    expect(wl.notEnteredPairs).toHaveLength(0);
    expect(wl.seekingSingles.map((s) => s.id)).toEqual(["s1"]);
    expect(wl.otherSingles.map((s) => s.id)).toEqual(["s2"]);
    expect(wl.counts).toEqual({ total: 3, pairs: 1, nextRound: 1, notEntered: 0, seeking: 1, noPair: 1 });
  });

  it("enforces max 1 broadcast per league per Budapest day (#387)", async () => {
    const t1 = new Date("2026-11-15T10:00:00Z");
    const first = await Broadcast.sendLeagueBroadcast({
      leagueId: 1,
      subject: "Teszt",
      body: "Üzenet",
      audienceLabel: "Győri liga",
      actor: { id: "org1", email: "org1@x.hu" },
      now: t1,
    });
    expect(first).toMatchObject({ ok: true, count: 6 });

    const second = await Broadcast.sendLeagueBroadcast({
      leagueId: 1,
      subject: "Második",
      body: "Üzenet",
      audienceLabel: "Győri liga",
      actor: { id: "org1", email: "org1@x.hu" },
      now: new Date("2026-11-15T15:00:00Z"),
    });
    expect(second).toMatchObject({ ok: false });
  });

  it("scopes organizer Napló to league entries and city clubs while hiding platform actions (#389)", async () => {
    h.raw!.exec(`
      insert into audit_log (actor_id, action, target, detail, league_id) values
        ('org1', 'season_entry.enter', 'pair:1', null, 1),
        ('org1', 'club.update', 'club:1', 'Padel Klub A', null),
        ('org1', 'user.update', 'user:u1', null, 1),
        ('org1', 'season_entry.enter', 'pair:99', null, 2);
    `);
    const log = await Log.leagueAuditLog(1, "gyor");
    expect(log.entries.map((e) => e.action).sort()).toEqual(["club.update", "season_entry.enter"]);
  });

  it("hides launch checklist once round 1 is published and shows missing items for a new town (#391)", async () => {
    const gyor = await Checklist.leagueLaunchChecklist(1);
    expect(gyor.visible).toBe(false);
    expect(gyor.missingRequired).toBe(0);

    const movar = await Checklist.leagueLaunchChecklist(2);
    expect(movar.visible).toBe(true);
    expect(movar.missingRequired).toBeGreaterThan(0);
  });
});
