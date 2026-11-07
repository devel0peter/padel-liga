// The local seed (#90), pure parts: the guard that keeps it off the remote
// database, the fake data and the docs/walkthrough.md that lists it.
import { describe, expect, it } from "vitest";

import { isMonday, phaseCalendar } from "@padel-liga/rules";

import {
  ADMIN,
  assertLocalArgs,
  assertLocalOnly,
  CLUBS,
  firstRoundStart,
  insertStatements,
  ORGANIZER,
  OUTSIDER,
  PAIR_PLAYERS,
  resetStatements,
  seedEmails,
  seedSql,
  SOLO_PLAYERS,
  wranglerArgs,
} from "./seed";

const NOW = new Date("2026-10-24T10:00:00Z"); // a Saturday

describe("assertLocalOnly", () => {
  it("allows a plain run on a developer machine", () => {
    expect(() => assertLocalOnly([], {})).not.toThrow();
    expect(() => assertLocalOnly([], { NODE_ENV: "development", HOME: "/home/x" })).not.toThrow();
  });

  it.each(["--remote", "--preview", "--env=production", "--env", "--production"])("refuses %s", (flag) => {
    expect(() => assertLocalOnly([flag], {})).toThrow(/Refused/);
  });

  it("refuses --remote even among other arguments", () => {
    expect(() => assertLocalOnly(["--local", "--remote"], {})).toThrow(/--remote/);
  });

  it("refuses any option or argument at all", () => {
    expect(() => assertLocalOnly(["--database", "x"], {})).toThrow(/takes no options/);
    expect(() => assertLocalOnly(["foo"], {})).toThrow(/takes no options/);
  });

  it("refuses CI and a production environment", () => {
    expect(() => assertLocalOnly([], { CI: "true" })).toThrow(/CI/);
    expect(() => assertLocalOnly([], { NODE_ENV: "production" })).toThrow(/production/);
  });
});

describe("wrangler command", () => {
  it("always targets the local database", () => {
    const args = wranglerArgs("/tmp/seed.sql");
    expect(args).toEqual(["wrangler", "d1", "execute", "DB", "--local", "--file", "/tmp/seed.sql"]);
    expect(args).not.toContain("--remote");
  });

  it("is checked once more before it runs", () => {
    expect(() => assertLocalArgs(["wrangler", "d1", "execute", "DB", "--file", "x"])).toThrow(/not --local/);
    expect(() => assertLocalArgs(["wrangler", "d1", "execute", "DB", "--local", "--remote"])).toThrow(/--remote/);
    expect(() => assertLocalArgs(["wrangler", "d1", "execute", "DB", "--local", "--env", "production"])).toThrow(/--env/);
    expect(() => assertLocalArgs(["wrangler", "d1", "execute", "DB", "--local", "--preview"])).toThrow(/--preview/);
  });
});

describe("fake data", () => {
  it("has no real address: every one is on the reserved .test domain", () => {
    const emails = seedEmails();
    expect(emails.length).toBe(3 + PAIR_PLAYERS.length * 2 + SOLO_PLAYERS.length);
    for (const e of emails) expect(e).toMatch(/^[a-z.]+@example\.test$/);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it("writes no email address outside @example.test", () => {
    const sql = seedSql(NOW);
    const found = sql.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? [];
    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const e of found) expect(e).toMatch(/@example\.test$/);
  });

  it("has 10 pairs-to-be, 4 players without a partner, 3 clubs and one player of the second league", () => {
    expect(PAIR_PLAYERS).toHaveLength(10);
    expect(SOLO_PLAYERS).toHaveLength(4);
    expect(CLUBS).toHaveLength(3);
    expect(new Set([ADMIN.email, ORGANIZER.email, OUTSIDER.email]).size).toBe(3);
  });

  it("covers every level, so the Elo seeding has something to order", () => {
    const levels = new Set([...PAIR_PLAYERS.map((p) => p.level), ...SOLO_PLAYERS.map((s) => s.level)]);
    expect([...levels].sort()).toEqual(["halado", "kezdo", "kozephalado", "versenyzo"]);
  });
});

describe("season dates", () => {
  it("starts round 1 on a Monday about two weeks out", () => {
    const start = firstRoundStart(NOW);
    expect(isMonday(start)).toBe(true);
    const days = (Date.parse(`${start}T00:00:00Z`) - Date.parse("2026-10-24T00:00:00Z")) / 86400000;
    expect(days).toBeGreaterThanOrEqual(11);
    expect(days).toBeLessThanOrEqual(17);
  });

  it("is Monday 9 Nov for Saturday 24 Oct and moves with the date", () => {
    expect(firstRoundStart(NOW)).toBe("2026-11-09");
    expect(firstRoundStart(new Date("2026-11-09T10:00:00Z"))).toBe("2026-11-23");
  });

  it("has four phases in the stored statements, as the calendar gives them", () => {
    const phases = phaseCalendar(firstRoundStart(NOW), []);
    const sql = insertStatements(NOW).filter((s) => s.startsWith("insert into season_phases"));
    expect(sql).toHaveLength(4);
    phases.forEach((p, i) => {
      expect(sql[i]).toContain(`select s.id, ${p.number}, ${Math.floor(p.startsAt.getTime() / 1000)}, ${Math.floor(p.deadline.getTime() / 1000)}`);
    });
  });
});

describe("reset", () => {
  it("only deletes by the seed's own markers", () => {
    for (const stmt of resetStatements()) {
      expect(stmt).toMatch(/^delete from /);
      // Every delete is limited by a where clause on the seed's markers.
      expect(stmt).toMatch(/where .*(example\.test|'minta'|'pelda'|minta-padel-arena)/);
    }
  });
});

describe("docs/walkthrough.md", () => {
  it("lists every seeded account, so the checklist and the seed can't drift apart", async () => {
    const { readFileSync } = await import(/* @vite-ignore */ `node:${"fs"}`);
    const doc = readFileSync(new URL("../../../docs/walkthrough.md", import.meta.url), "utf8") as string;
    for (const e of seedEmails()) expect(doc, e).toContain(e);
    for (const c of CLUBS) expect(doc, c.name).toContain(c.name);
  });
});
