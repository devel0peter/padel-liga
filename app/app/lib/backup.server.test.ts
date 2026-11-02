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
function fakeD1(raw: any, c: Counter) {
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        all: async () => {
          c.tick("D1");
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
async function runAll(raw: any, c: Counter, bucket: R2Bucket, limits = LIMITS) {
  const results: any[] = [];
  const calls: number[] = [];
  for (let i = 0; i < 60; i++) {
    c.n = 0;
    const r = await exportStep({ DB: fakeD1(raw, c), BACKUPS: bucket }, NOW, limits);
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

function restore(sql: string) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
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

    expect(results.at(-1)).toMatchObject({ status: "finished", key: FILE });
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
    expect(error).toHaveBeenCalledWith(expect.stringContaining("never finished"));
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
    expect(warn).toHaveBeenCalled();
    expect(c.n).toBe(0);
  });
});
