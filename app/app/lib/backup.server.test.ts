// exportStep (#32) on a real SQLite with every migration applied
// (~/test/sqlite), a fake R2 bucket, and a restore of the file it wrote into
// a fresh database with foreign keys on, as D1 has them. Every run is
// counted: a Workers Free invocation may make 50 D1 and R2 calls.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const { migratedDatabase } = await import("~/test/sqlite");
const { exportStep, LIMITS } = await import("./backup.server");
const { DatabaseSync } = await import(/* @vite-ignore */ `node:${"sqlite"}`);

const FREE_CALLS = 50;

// Not in Node; the Workers runtime has the real one.
vi.stubGlobal(
  "FixedLengthStream",
  class extends TransformStream {
    constructor(public length: number) {
      super();
    }
  },
);

class Counter {
  n = 0;
  failAt = 0;
  tick(what: string) {
    this.n++;
    if (this.failAt && this.n === this.failAt) {
      this.failAt = 0;
      throw new Error(`${what} failed`);
    }
  }
}

// The slice of D1Database the export uses, over node:sqlite.
function fakeD1(raw: any, c: Counter, before?: (sql: string) => void) {
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        all: async () => {
          c.tick("D1");
          before?.(sql);
          return { results: raw.prepare(sql).all(...params) };
        },
      }),
    }),
  } as unknown as D1Database;
}

function fakeBucket(c: Counter, initial: string[] = []) {
  const files = new Map<string, string>(initial.map((k) => [k, "old"]));
  const size = (s: string) => new TextEncoder().encode(s).length;
  const bucket = {
    head: async (key: string) => (c.tick("R2 head"), files.has(key) ? { key } : null),
    get: async (key: string) => {
      c.tick("R2 get");
      const text = files.get(key);
      if (text === undefined) return null;
      return { key, text: async () => text, body: new Response(text).body! };
    },
    put: async (key: string, body: string | ReadableStream) => {
      c.tick("R2 put");
      const text = typeof body === "string" ? body : await new Response(body).text();
      files.set(key, text);
      return { key, size: size(text) };
    },
    list: async ({ prefix }: { prefix: string }) => (
      c.tick("R2 list"),
      { objects: [...files.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }
    ),
    delete: async (keys: string[]) => (c.tick("R2 delete"), keys.forEach((k) => files.delete(k))),
  };
  return { files, bucket: bucket as unknown as R2Bucket };
}

const NOW = new Date("2026-11-02T03:00:00Z");
const NAME = `O'Neil "Béla"\nsecond line`;
const FILE = "daily/padel-liga-2026-11-02.sql";

function fill(raw: any) {
  const add = raw.prepare(`INSERT INTO interest_signups (mode, name1, email1, level, consent_at, note) VALUES ('solo', ?, ?, 'halado', 1780000000, ?)`);
  add.run(NAME, "bela@example.test", null);
  raw.exec(`INSERT INTO users (id, email) VALUES ('u1', 'a@example.test')`);
  raw.exec(`INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ('s1', 'u1', 1790000000)`);
  return add;
}

// Runs steps like the cron does, one invocation each, until the file is there.
async function runAll(raw: any, c: Counter, bucket: R2Bucket, limits = LIMITS, before?: (sql: string) => void) {
  const results: any[] = [];
  const calls: number[] = [];
  for (let i = 0; i < 60; i++) {
    c.n = 0;
    const r = await exportStep({ DB: fakeD1(raw, c, before), BACKUPS: bucket }, NOW, limits);
    calls.push(c.n);
    results.push(r);
    if (r.status === "finished") return { results, calls };
  }
  throw new Error(`not finished after 60 runs: ${JSON.stringify(results.at(-1))}`);
}

const tableCounts = (raw: any) =>
  Object.fromEntries(
    (raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(
      ({ name }) => [name, (raw.prepare(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number }).n],
    ),
  );
const schemaOf = (db: any) => db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();

// D1 (and wrangler's local D1) runs a file in one transaction; with foreign
// keys on, the PRAGMA at its top defers the check to the commit.
function restore(sql: string) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("BEGIN");
  db.exec(sql);
  db.exec("COMMIT");
  return db;
}

// A plain sqlite3 restore (`sqlite3 new.db < file`): foreign keys off, so no
// ON DELETE action fires; only the file's own cleanup keeps the links whole.
function restorePlain(sql: string) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(sql);
  return db;
}

afterEach(() => vi.restoreAllMocks());

describe("exportStep", () => {
  it("writes the whole database to one file that restores into an empty database", async () => {
    const raw = migratedDatabase();
    fill(raw);
    const c = new Counter();
    const { files, bucket } = fakeBucket(c);
    const { results, calls } = await runAll(raw, c, bucket);

    expect(results.at(-1)).toMatchObject({ status: "finished", key: FILE, maxParts: LIMITS.maxOps - 7 });
    // The file only, no pieces or state left behind.
    expect([...files.keys()]).toEqual([FILE]);
    expect(Math.max(...calls)).toBeLessThanOrEqual(FREE_CALLS);

    // Foreign keys on, as in D1: sessions must come after users.
    const restored = restore(files.get(FILE)!);
    expect(tableCounts(restored)).toEqual(tableCounts(raw));
    expect(restored.prepare("SELECT name1 FROM interest_signups").get()).toEqual({ name1: NAME });
    expect(restored.prepare("SELECT user_id FROM sessions").get()).toEqual({ user_id: "u1" });
    expect(schemaOf(restored)).toEqual(schemaOf(raw));
    expect(results.at(-1).bytes).toBe(new TextEncoder().encode(files.get(FILE)!).length);
  });

  it("stays under 50 calls a run on a database with 90 tables and 1,500 big rows", async () => {
    const raw = migratedDatabase();
    const add = fill(raw);
    for (let t = 0; t < 60; t++) {
      raw.exec(`CREATE TABLE extra_${t} (id integer primary key, v text)`);
      raw.exec(`INSERT INTO extra_${t} (v) VALUES ('row of table ${t}')`);
    }
    for (let i = 0; i < 1500; i++) add.run(`Játékos ${i}`, `p${i}@example.test`, "megjegyzés ".repeat(100));
    const c = new Counter();
    const { files, bucket } = fakeBucket(c);
    const { results, calls } = await runAll(raw, c, bucket);

    // Several runs, none over the Free limit (the schema alone is 90 queries' worth of tables).
    expect(results.length).toBeGreaterThan(3);
    expect(Math.max(...calls)).toBeLessThanOrEqual(LIMITS.maxOps);
    expect(LIMITS.maxOps).toBeLessThan(FREE_CALLS);
    const restored = restore(files.get(FILE)!);
    expect(tableCounts(restored)).toEqual(tableCounts(raw));
    expect(restored.prepare("SELECT count(*) AS n FROM interest_signups").get()).toEqual({ n: 1501 });
  });

  it("glues as many pieces as its ceiling says within the run's calls, and stops one piece past it (#282)", async () => {
    const pieces = async (maxOps: number) => {
      const raw = migratedDatabase();
      fill(raw);
      for (let i = 0; i < 20; i++) raw.exec(`INSERT INTO job_runs (key, done_at) VALUES ('k${i}', 1790000000)`);
      const c = new Counter();
      const { bucket } = fakeBucket(c);
      return runAll(raw, c, bucket, { maxOps, pageRows: 1, stepChars: 1 });
    };
    // One row a piece: how many pieces this database makes.
    const free = (await pieces(200)).results.at(-1);
    const n = free.parts as number;
    expect(n).toBeGreaterThan(20);
    // A run that allows exactly n pieces glues them within its calls.
    const { results, calls } = await pieces(n + 7);
    expect(results.at(-1)).toMatchObject({ status: "finished", parts: n, maxParts: n });
    expect(Math.max(...calls)).toBeLessThanOrEqual(n + 7);
    // One call fewer: n pieces are past the ceiling, and the export says so.
    await expect(pieces(n + 6)).rejects.toThrow(`${n} pieces are too many to glue`);
  });

  it("builds a bounded amount of SQL per run", async () => {
    const raw = migratedDatabase();
    const add = fill(raw);
    for (let i = 0; i < 1500; i++) add.run(`Játékos ${i}`, `p${i}@example.test`, "megjegyzés ".repeat(100));
    const c = new Counter();
    const seen: number[] = [];
    const { bucket, files } = fakeBucket(c);
    const put = bucket.put.bind(bucket);
    (bucket as any).put = async (key: string, body: any, ...rest: any[]) => {
      if (typeof body === "string" && key.endsWith(".sql")) seen.push(body.length);
      return (put as any)(key, body, ...rest);
    };
    await runAll(raw, c, bucket);
    // A piece may overshoot by one page of rows, never by more.
    const onePage = 200 * 1200;
    expect(Math.max(...seen)).toBeLessThanOrEqual(LIMITS.stepChars + onePage);
    expect(seen.length).toBeGreaterThan(2);
    expect(files.has(FILE)).toBe(true);
  });

  it("restores although a row was written between two steps and arrived without its parent", async () => {
    const raw = migratedDatabase();
    fill(raw);
    const c = new Counter();
    const { files, bucket } = fakeBucket(c);
    // A person logs in after `users` was read and before `sessions` is: the
    // new session (and a session of the new user) reach the file, the user not.
    let late = false;
    await runAll(raw, c, bucket, LIMITS, (sql) => {
      if (late || !sql.includes('FROM "sessions"')) return;
      late = true;
      raw.exec(`INSERT INTO users (id, email) VALUES ('u2', 'late@example.test')`);
      raw.exec(`INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ('s2', 'u2', 1790000000)`);
    });
    expect(late).toBe(true);
    // With foreign keys on, one orphan would fail this with FOREIGN KEY constraint failed.
    const restored = restore(files.get(FILE)!);
    // The session of the late user is dropped, the rest is whole.
    expect(restored.prepare("SELECT id_hash FROM sessions").all()).toEqual([{ id_hash: "s1" }]);
    expect(restored.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 1 });
    expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  // One page of two rows per run, so a table with three rows is cut by a step
  // boundary (#179).
  const ONE_PAGE_A_RUN = { maxOps: 40, pageRows: 2, stepChars: 1 };
  // Runs `write` once, just before the second page of `table` is read.
  const betweenPages = (table: string, write: () => void) => {
    let pages = 0;
    return {
      hook: (sql: string) => {
        if (sql.includes(`FROM "${table}" WHERE rowid >`) && ++pages === 2) write();
      },
      fired: () => pages >= 2,
    };
  };

  it("restores although a pair was dissolved and its player's new active pair written between two steps (#179)", async () => {
    const raw = migratedDatabase();
    fill(raw);
    raw.exec(`INSERT INTO cities (slug, name) VALUES ('teszt', 'Teszt')`);
    raw.exec(`INSERT INTO leagues (id, city, slug, name) VALUES (91, 'teszt', 'teszt', 'Teszt')`);
    for (const u of ["u2", "u3", "u4", "u5"]) raw.exec(`INSERT INTO users (id, email) VALUES ('${u}', '${u}@example.test')`);
    raw.exec(`INSERT INTO pairs (id, league_id, player_a, player_b) VALUES (1, 91, 'u1', 'u2'), (2, 91, 'u3', 'u4')`);
    const c = new Counter();
    const { files, bucket } = fakeBucket(c);
    // The first page of `pairs` holds pair 1 (u1, active). Then u1's pair is
    // dissolved and u1 enters a new active pair 3: both reach the file as
    // u1's active pair, and pairs_active_a_idx would fail the restore.
    const gap = betweenPages("pairs", () => {
      raw.exec(`UPDATE pairs SET status = 'dissolved', dissolved_at = 1790000000 WHERE id = 1`);
      raw.exec(`INSERT INTO pairs (id, league_id, player_a, player_b) VALUES (3, 91, 'u1', 'u5')`);
    });
    await runAll(raw, c, bucket, ONE_PAGE_A_RUN, gap.hook);
    expect(gap.fired()).toBe(true);
    const file = files.get(FILE)!;
    expect(file.match(/INTO "pairs" .*'u1'/g)).toHaveLength(2);

    const restored = restore(file);
    // The older row (pair 1 as read before it was dissolved) is dropped, the live one kept.
    expect(restored.prepare("SELECT id, player_a, status FROM pairs ORDER BY id").all()).toEqual([
      { id: 2, player_a: "u3", status: "active" },
      { id: 3, player_a: "u1", status: "active" },
    ]);
    expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("drops the rows that depended on a dropped duplicate, so foreign keys still hold (#179)", async () => {
    const raw = migratedDatabase();
    fill(raw);
    raw.exec(`INSERT INTO users (id, email) VALUES ('u2', 'u2@example.test'), ('u3', 'u3@example.test')`);
    raw.exec(`INSERT INTO cities (slug, name) VALUES ('teszt', 'Teszt')`);
    raw.exec(`INSERT INTO leagues (id, city, slug, name) VALUES (91, 'teszt', 'teszt', 'Teszt')`);
    // player_a has no ON DELETE action: only the orphan cleanup can remove it.
    raw.exec(`INSERT INTO pairs (id, league_id, player_a, player_b) VALUES (1, 91, 'u1', 'u2')`);
    const c = new Counter();
    const { files, bucket } = fakeBucket(c);
    // u1 was read with a@example.test; then u1 changes address and a new
    // account u9 takes it. users_email_unique keeps u9, so u1 goes, and with
    // it u1's session (cascade) and pair (no action, orphan cleanup).
    const gap = betweenPages("users", () => {
      raw.exec(`UPDATE users SET email = 'uj@example.test' WHERE id = 'u1'`);
      raw.exec(`INSERT INTO users (id, email) VALUES ('u9', 'a@example.test')`);
    });
    await runAll(raw, c, bucket, ONE_PAGE_A_RUN, gap.hook);
    expect(gap.fired()).toBe(true);

    const restored = restore(files.get(FILE)!);
    expect(restored.prepare("SELECT id FROM users ORDER BY id").all()).toEqual([{ id: "u2" }, { id: "u3" }, { id: "u9" }]);
    expect(restored.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect(restored.prepare("SELECT count(*) AS n FROM pairs").get()).toEqual({ n: 0 });
    expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps an audit entry whose author arrived without its account, with no author (#282)", async () => {
    const raw = migratedDatabase();
    fill(raw);
    raw.exec(`INSERT INTO audit_log (actor_id, action, target) VALUES ('u1', 'pair.dissolve', 'pair:1')`);
    const c = new Counter();
    const { files, bucket } = fakeBucket(c);
    // An account is made after `users` was read and writes an audit entry
    // before `audit_log` is read: the entry reaches the file, its author not.
    let late = false;
    await runAll(raw, c, bucket, LIMITS, (sql) => {
      if (late || !sql.includes('FROM "audit_log"')) return;
      late = true;
      raw.exec(`INSERT INTO users (id, email) VALUES ('u2', 'late@example.test')`);
      raw.exec(`INSERT INTO audit_log (actor_id, action, target) VALUES ('u2', 'season.publish', 'season:7')`);
    });
    expect(late).toBe(true);
    for (const restored of [restore(files.get(FILE)!), restorePlain(files.get(FILE)!)]) {
      expect(restored.prepare("SELECT actor_id, action, target FROM audit_log ORDER BY id").all()).toEqual([
        { actor_id: "u1", action: "pair.dissolve", target: "pair:1" },
        { actor_id: null, action: "season.publish", target: "season:7" },
      ]);
      expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    }
  });

  it("keeps a pair dissolved by a dropped duplicate account, without who dissolved it, with or without foreign keys (#179, #282)", async () => {
    const raw = migratedDatabase();
    fill(raw);
    raw.exec(`INSERT INTO users (id, email) VALUES ('u2', 'u2@example.test'), ('u3', 'u3@example.test')`);
    raw.exec(`INSERT INTO cities (slug, name) VALUES ('teszt', 'Teszt')`);
    raw.exec(`INSERT INTO leagues (id, city, slug, name) VALUES (91, 'teszt', 'teszt', 'Teszt')`);
    // u1 (an organizer) dissolved u2 and u3's pair.
    raw.exec(`INSERT INTO pairs (id, league_id, player_a, player_b, status, dissolved_at, dissolved_by) VALUES (1, 91, 'u2', 'u3', 'dissolved', 1790000000, 'u1')`);
    const c = new Counter();
    const { files, bucket } = fakeBucket(c);
    // As in the #179 case above: u1 gives its address to a new account u9
    // between two pages of `users`, so users_email_unique drops u1.
    const gap = betweenPages("users", () => {
      raw.exec(`UPDATE users SET email = 'uj@example.test' WHERE id = 'u1'`);
      raw.exec(`INSERT INTO users (id, email) VALUES ('u9', 'a@example.test')`);
    });
    await runAll(raw, c, bucket, ONE_PAGE_A_RUN, gap.hook);
    expect(gap.fired()).toBe(true);

    for (const restored of [restore(files.get(FILE)!), restorePlain(files.get(FILE)!)]) {
      expect(restored.prepare("SELECT id FROM users ORDER BY id").all()).toEqual([{ id: "u2" }, { id: "u3" }, { id: "u9" }]);
      expect(restored.prepare("SELECT id, status, dissolved_by FROM pairs").all()).toEqual([{ id: 1, status: "dissolved", dissolved_by: null }]);
      // u1's session still goes (ON DELETE CASCADE).
      expect(restored.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
      expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    }
  });

  it("restores although a primary key was given up and taken again between two steps (#179)", async () => {
    const raw = migratedDatabase();
    for (const k of ["a", "b", "c"]) raw.exec(`INSERT INTO job_runs (key, done_at) VALUES ('${k}', 1790000000)`);
    const c = new Counter();
    const { files, bucket } = fakeBucket(c);
    // "a" was read on the first page; it is deleted and written again, so the
    // new row sits after the cursor and is read on the second page too.
    const gap = betweenPages("job_runs", () => {
      raw.exec(`DELETE FROM job_runs WHERE key = 'a'`);
      raw.exec(`INSERT INTO job_runs (key, done_at) VALUES ('a', 1790000999)`);
    });
    await runAll(raw, c, bucket, ONE_PAGE_A_RUN, gap.hook);
    expect(gap.fired()).toBe(true);
    const file = files.get(FILE)!;
    expect(file.match(/INTO "job_runs" .*'a'/g)).toHaveLength(2);

    const restored = restore(file);
    expect(restored.prepare("SELECT key, done_at FROM job_runs ORDER BY key").all()).toEqual([
      { key: "a", done_at: 1790000999 },
      { key: "b", done_at: 1790000000 },
      { key: "c", done_at: 1790000000 },
    ]);
  });

  it("finds every foreign key of the real schema, so no orphan cleanup is missing", async () => {
    const { foreignKeys } = await import("./backup");
    const tables = migratedDatabase().prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL").all() as { name: string; sql: string }[];
    let found = 0;
    for (const t of tables) {
      const written = (t.sql.match(/\bREFERENCES\b/gi) ?? []).length;
      expect(foreignKeys(t.sql), t.name).toHaveLength(written);
      found += written;
    }
    expect(found).toBeGreaterThan(30);
  });

  it("only empties links the real schema lets be empty, so a restore can't fail on the cleanup (#282)", async () => {
    const { foreignKeys } = await import("./backup");
    const db = migratedDatabase();
    const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL").all() as { name: string; sql: string }[];
    let cleared = 0;
    for (const t of tables) {
      const notNull = new Set((db.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string; notnull: number }[]).filter((c) => c.notnull).map((c) => c.name));
      for (const fk of foreignKeys(t.sql).filter((k) => k.onDelete === "set null"))
        for (const column of fk.columns) {
          expect(notNull.has(column), `${t.name}.${column}`).toBe(false);
          cleared++;
        }
    }
    // audit_log.actor_id, pairs.dissolved_by, match_decisions.decided_by and the like.
    expect(cleared).toBeGreaterThan(10);
  });

  it("does nothing once the day's file exists", async () => {
    const raw = migratedDatabase();
    const c = new Counter();
    const { files, bucket } = fakeBucket(c);
    await runAll(raw, c, bucket);
    const before = files.get(FILE);
    c.n = 0;
    expect(await exportStep({ DB: fakeD1(raw, c), BACKUPS: bucket }, NOW)).toEqual({ status: "done" });
    expect(c.n).toBe(1);
    expect(files.get(FILE)).toBe(before);
  });

  it("restores the AUTOINCREMENT counters, so a deleted highest id is not reused", async () => {
    const raw = migratedDatabase();
    const add = fill(raw);
    add.run("Második", "m@example.test", null);
    raw.exec("DELETE FROM interest_signups WHERE name1 = 'Második'");
    const c = new Counter();
    const { files, bucket } = fakeBucket(c);
    await runAll(raw, c, bucket);
    const restored = restore(files.get(FILE)!);
    restored.exec(`INSERT INTO interest_signups (mode, name1, email1, level, consent_at) VALUES ('solo', 'Új', 'u@example.test', 'halado', 1780000000)`);
    expect(restored.prepare("SELECT id FROM interest_signups WHERE name1 = 'Új'").get()).toEqual({ id: 3 });
  });

  it("carries on after a run that failed half way, without doubling rows", async () => {
    const raw = migratedDatabase();
    const add = fill(raw);
    for (let i = 0; i < 600; i++) add.run(`Játékos ${i}`, `p${i}@example.test`, "megjegyzés ".repeat(100));
    const c = new Counter();
    const { files, bucket } = fakeBucket(c);
    // The second run dies at a late call (its piece write).
    c.n = 0;
    await exportStep({ DB: fakeD1(raw, c), BACKUPS: bucket }, NOW);
    c.n = 0;
    c.failAt = 6;
    await expect(exportStep({ DB: fakeD1(raw, c), BACKUPS: bucket }, NOW)).rejects.toThrow("failed");
    c.failAt = 0;
    await runAll(raw, c, bucket);
    const restored = restore(files.get(FILE)!);
    expect(tableCounts(restored)).toEqual(tableCounts(raw));
  });

  it("drops the pieces of an earlier day that never finished, and says so", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = migratedDatabase();
    const c = new Counter();
    const { files, bucket } = fakeBucket(c, ["work/2026-11-01/state.json", "work/2026-11-01/part-0001.sql"]);
    await runAll(raw, c, bucket);
    expect([...files.keys()]).toEqual([FILE]);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ level: "error", event: "backup unfinished day dropped" }));
  });

  it("deletes the files beyond the newest 35 once the new one is written", async () => {
    const raw = migratedDatabase();
    const old = Array.from({ length: 40 }, (_, i) => `daily/padel-liga-2026-${i < 20 ? "09" : "10"}-${String((i % 20) + 1).padStart(2, "0")}.sql`);
    const c = new Counter();
    const { files, bucket } = fakeBucket(c, [...old, "daily/readme.txt"]);
    const { results } = await runAll(raw, c, bucket);
    expect([...files.keys()].filter((k) => k.endsWith(".sql"))).toHaveLength(35);
    expect(files.has(FILE)).toBe(true);
    expect(files.has("daily/padel-liga-2026-09-01.sql")).toBe(false);
    expect(files.has("daily/readme.txt")).toBe(true);
    expect(results.at(-1).deleted).toBe(6);
  });

  it("keeps the old files while the new one isn't written", async () => {
    const raw = migratedDatabase();
    const c = new Counter();
    const { files, bucket } = fakeBucket(c, ["daily/padel-liga-2026-10-01.sql"]);
    const put = bucket.put.bind(bucket);
    (bucket as any).put = async (key: string, ...rest: any[]) => {
      if (key === FILE) throw new Error("R2 down");
      return (put as any)(key, ...rest);
    };
    await expect(runAll(raw, c, bucket)).rejects.toThrow("R2 down");
    expect(files.has("daily/padel-liga-2026-10-01.sql")).toBe(true);
  });

  it("skips quietly without a bucket binding", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = new Counter();
    expect(await exportStep({ DB: fakeD1(migratedDatabase(), c) }, NOW)).toEqual({ status: "skipped" });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ level: "warn", event: "backup skipped" }));
    expect(c.n).toBe(0);
  });
});
