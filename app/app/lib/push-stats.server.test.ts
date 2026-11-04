// The push counts on real SQLite (~/test/sqlite): who counts as a player and
// as a push user, and the one row per Budapest day the cron writes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { currentPushStats, listPushDays, recordPushStats } = await import("~/lib/push-stats.server");

const device = (endpoint: string, user: string) =>
  h.raw.prepare("insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (?, ?, 'k', 'a')").run(endpoint, user);

describe("push stats on real SQLite", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győr')`);
    h.raw.exec(`insert into users (id, email, name, consent_at, platform_role, deleted_at) values
      ('a', 'a@x.hu', 'Anna', 1, 'player', null),
      ('b', 'b@x.hu', 'Béla', 1, 'player', null),
      ('c', 'c@x.hu', 'Cecil', 1, 'player', null),
      ('d', 'd@x.hu', 'Dóra', 1, 'player', null),
      ('nc', 'nc@x.hu', 'No consent', null, 'player', null),
      ('del', 'del@x.hu', 'Törölt játékos', 1, 'player', 5),
      ('adm', 'adm@x.hu', 'Admin', 1, 'superadmin', null),
      ('org', 'org@x.hu', 'Szervező', 1, 'player', null)`);
    h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'org')`);
  });

  it("counts consented, not deleted players only, without the Admin and the Szervező", async () => {
    expect(await currentPushStats()).toEqual({ players: 4, pushUsers: 0, devices: 0 });
  });

  it("counts a player with two devices once as a push user, and both devices", async () => {
    device("a1", "a");
    device("a2", "a");
    device("b1", "b");
    expect(await currentPushStats()).toEqual({ players: 4, pushUsers: 2, devices: 3 });
  });

  it("leaves out a player who switched the push channel off, and staff devices", async () => {
    device("a1", "a");
    device("c1", "c");
    device("adm1", "adm");
    device("org1", "org");
    h.raw.exec(`insert into notification_opt_outs (user_id, kind) values ('c', 'channel:push')`);
    expect(await currentPushStats()).toEqual({ players: 4, pushUsers: 1, devices: 1 });
  });

  it("writes one row per Budapest day, the last run of the day winning", async () => {
    await recordPushStats(new Date("2026-11-04T08:00:00Z"));
    device("a1", "a");
    // 23:30 UTC is already the 5th in Budapest.
    await recordPushStats(new Date("2026-11-04T23:30:00Z"));
    device("b1", "b");
    await recordPushStats(new Date("2026-11-05T10:00:00Z"));
    expect(await listPushDays({ from: "2026-11-01", to: "2026-11-30" })).toEqual([
      { day: "2026-11-04", players: 4, pushUsers: 0, devices: 0 },
      { day: "2026-11-05", players: 4, pushUsers: 2, devices: 2 },
    ]);
  });

  it("lists only the days of the period, oldest first", async () => {
    await recordPushStats(new Date("2026-11-03T10:00:00Z"));
    await recordPushStats(new Date("2026-11-01T10:00:00Z"));
    await recordPushStats(new Date("2026-11-10T10:00:00Z"));
    const days = await listPushDays({ from: "2026-11-01", to: "2026-11-05" });
    expect(days.map((d) => d.day)).toEqual(["2026-11-01", "2026-11-03"]);
  });
});
