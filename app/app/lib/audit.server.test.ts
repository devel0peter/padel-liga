// audit.server.ts on a real SQLite with every migration applied: an entry is
// written in the same batch as the change (#225), and only when the change
// happened.
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { db } = await import("~/db/client.server");
const { cities } = await import("~/db/schema");
const A = await import("~/lib/audit.server");

const entries = () => h.raw.prepare("select actor_id, action, target, detail, league_id from audit_log order by id").all();

describe("audit.server (#225)", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
    h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győr')`);
    h.raw.exec(`insert into users (id, email, name) values ('o', 'o@x.hu', 'Org')`);
  });

  it("writes an entry with the change in one batch, values worked out in SQL", async () => {
    await db.batch([
      db.update(cities).set({ name: "Győr!" }).where(eq(cities.slug, "gyor")),
      A.auditEntry({ actorId: "o", action: "city.update", target: sql`'city:' || 'gyor'`, detail: "x", leagueId: 1 }),
    ]);
    expect(entries()).toEqual([{ actor_id: "o", action: "city.update", target: "city:gyor", detail: "x", league_id: 1 }]);
    expect(h.raw.prepare("select at from audit_log").get().at).toBeGreaterThan(0);
  });

  it("auditIfChanged writes only when the statement before it changed a row", async () => {
    await db.batch([
      db.update(cities).set({ name: "x" }).where(eq(cities.slug, "nope")),
      A.auditIfChanged({ actorId: null, action: "city.update", target: "city:nope" }),
    ]);
    expect(entries()).toEqual([]);
    await db.batch([
      db.update(cities).set({ name: "x" }).where(eq(cities.slug, "gyor")),
      A.auditIfChanged({ actorId: null, action: "city.update", target: "city:gyor" }),
    ]);
    expect(entries()).toEqual([{ actor_id: null, action: "city.update", target: "city:gyor", detail: null, league_id: null }]);
  });

  it("a failing batch saves neither the change nor the entry", async () => {
    await expect(
      db.batch([
        A.auditEntry({ actorId: "o", action: "city.create", target: "city:deb" }),
        db.insert(cities).values({ slug: "gyor", name: "Dupla", listed: false }),
      ]),
    ).rejects.toThrow(/UNIQUE/);
    expect(entries()).toEqual([]);
  });
});

describe("migration 0043 backfills the league of older entries (#226)", () => {
  it("finds the league from each shape older rows were written in", () => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
    h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győr'), (2, 'gyor', 'gyor2', 'Győr 2')`);
    h.raw.exec(`insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (5, 2, 'Tél', 1, 2, '2026-11-09')`);
    h.raw.exec(`insert into users (id, email, name) values ('a', 'a@x.hu', 'A'), ('b', 'b@x.hu', 'B')`);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (1, 2, 'a', 'b')`);
    h.raw.exec(`insert into season_entries (id, season_id, pair_id, status) values (7, 5, 1, 'approved')`);
    const rows: [string, string, string | null, number | null][] = [
      ["league.create", "league:gyor2", "Győr 2", 2],
      ["reminders.on", "league:1", null, 1],
      ["league_admin.grant", "a@x.hu", "league:gyor2", 2],
      ["league_admin.grant", "a@x.hu", "invite:1", 1],
      ["pair.dissolve", "pair:1", "league:2; account deleted", 2],
      ["pair.create", "pair:1", "league:2", 2],
      ["season.create", "season:5", "Tél", 2],
      ["season_entry.enter", "season_entry:7", "pair:1", 2],
      ["season_entry.withdraw", "pair:1", "season:5 groups:3", 2],
      ["city.create", "city:deb", "Debrecen", null],
      ["superadmin.grant", "a@x.hu", "cli", null],
    ];
    for (const [action, target, detail] of rows)
      h.raw.prepare("insert into audit_log (action, target, detail) values (?, ?, ?)").run(action, target, detail);
    // The migration's UPDATE statements, run again on these rows.
    const { readFileSync } = (globalThis as any).process.getBuiltinModule("node:fs");
    const file = readFileSync(new URL("../../drizzle/0043_audit_log_league.sql", import.meta.url), "utf8") as string;
    for (const stmt of file.split("--> statement-breakpoint")) if (/^\s*(--.*\n\s*)*UPDATE/.test(stmt)) h.raw.exec(stmt);
    expect(h.raw.prepare("select league_id from audit_log order by id").all().map((r: any) => r.league_id)).toEqual(rows.map((r) => r[3]));
  });
});
