import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  db: null as unknown,
  raw: null as { exec: (sql: string) => void; prepare: (sql: string) => { all: () => unknown[] } } | null,
  env: {} as Record<string, string>,
}));

vi.mock("cloudflare:workers", () => ({ env: h.env }));
vi.mock("cloudflare:sockets", () => ({ connect: () => { throw new Error("unused"); } }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const N = await import("./notifications.server");
const PS = await import("./partner-search.server");
const LM = await import("./league-members.server");

function freshDb() {
  h.raw = migratedDatabase();
  h.raw!.exec(`
    insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1);
    insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győri liga');
    insert into users (id, email, name, platform_role, level, consent_at) values
      ('org1', 'org1@x.hu', 'Szervező Egy', 'player', 'halado', 1000),
      ('org2', 'org2@x.hu', 'Szervező Kettő', 'player', 'halado', 1000),
      ('adm1', 'adm1@x.hu', 'Admin Egy', 'superadmin', 'halado', 1000),
      ('p1', 'p1@x.hu', 'Kovács Anna', 'player', 'kezdo', 1000),
      ('p2', 'p2@x.hu', 'Nagy Béla', 'player', 'kezdo', null);
    insert into league_admins (league_id, user_id) values (1, 'org1'), (1, 'org2');
  `);
}

const all = <T = Record<string, unknown>>(sql: string) => h.raw!.prepare(sql).all() as T[];

describe("new_signup organizer notices (#382)", () => {
  beforeEach(freshDb);

  it("throttles push to at most 1 per recipient per league per hour and reports suppressed count after the hour", async () => {
    const base = new Date("2026-11-10T10:00:00Z");
    for (let i = 0; i < 5; i++) {
      await N.notifyNewSignup(
        { leagueId: 1, event: "player_joined", except: "p1" },
        new Date(base.getTime() + i * 5 * 60_000),
      );
    }
    const org1Rows = all<{ id: number; title: string; body: string; push_due_at: number | null; pushed_at: number | null }>(
      "select id, title, body, push_due_at, pushed_at from notifications where user_id = 'org1' and kind = 'new_signup' order by id",
    );
    expect(org1Rows).toHaveLength(5);
    expect(org1Rows.filter((r) => r.pushed_at !== null)).toHaveLength(1);
    expect(org1Rows[0].pushed_at).not.toBeNull();
    expect(org1Rows[4].pushed_at).toBeNull();

    // Sixth event after an hour passes pushes with (+4 új jelentkező)
    await N.notifyNewSignup(
      { leagueId: 1, event: "pair_formed", except: "p1" },
      new Date(base.getTime() + 61 * 60_000),
    );
    const sixth = all<{ title: string; body: string; pushed_at: number | null }>(
      "select title, body, pushed_at from notifications where user_id = 'org1' and kind = 'new_signup' order by id desc limit 1",
    )[0];
    expect(sixth.pushed_at).not.toBeNull();
    expect(sixth.body).toContain("(+4 új jelentkező)");
    expect(sixth.title).not.toContain("Kovács");
    expect(sixth.title).not.toContain("@");
  });

  it("respects opt-out and excludes the actor who triggered the event", async () => {
    h.raw!.exec("insert into notification_opt_outs (user_id, kind) values ('org2', 'new_signup')");
    await N.notifyNewSignup({ leagueId: 1, event: "pair_entered", joinsPhase: 2, except: "org1" });
    const users = all<{ user_id: string; title: string }>(
      "select user_id, title from notifications where kind = 'new_signup' order by user_id",
    );
    expect(users.map((u) => u.user_id)).toEqual(["adm1"]);
    expect(users[0].title).toContain("a 2. körben kezd");
  });

  it("dedupes Párt keresek toggle within 24 hours via audit_log", async () => {
    const t0 = new Date("2026-11-10T10:00:00Z");
    const list = [{ id: 1, name: "Győri liga", slug: "gyor", city: "gyor" }];
    await PS.setPartnerSearch({ id: "p1", consentAt: new Date(1000) }, 1, true, list, "p1", t0);
    await PS.setPartnerSearch({ id: "p1", consentAt: new Date(1000) }, 1, false, list, "p1", new Date(t0.getTime() + 60_000));
    await PS.setPartnerSearch({ id: "p1", consentAt: new Date(1000) }, 1, true, list, "p1", new Date(t0.getTime() + 120_000));
    const count = all<{ id: number }>("select id from notifications where user_id = 'org1' and kind = 'new_signup'");
    expect(count).toHaveLength(1);
  });

  it("notifies only when a player finishes first-login consent for register-button joins", async () => {
    await LM.joinFromRegisterButton("p2", "gyor");
    expect(all("select id from notifications where kind = 'new_signup'")).toHaveLength(0);
    await LM.notifyJoinedLeagues("p2");
    expect(all("select distinct user_id from notifications where kind = 'new_signup' order by user_id")).toEqual([
      { user_id: "adm1" },
      { user_id: "org1" },
      { user_id: "org2" },
    ]);
  });
});
