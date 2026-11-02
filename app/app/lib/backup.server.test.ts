// exportDatabase (#32) on a real SQLite with every migration applied
// (~/test/sqlite), a fake R2 bucket, and a restore of the file it wrote into
// a fresh database with foreign keys on, as D1 has them.
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const { migratedDatabase } = await import("~/test/sqlite");
const { exportDatabase } = await import("./backup.server");
const { DatabaseSync } = await import(/* @vite-ignore */ `node:${"sqlite"}`);

// The slice of D1Database the export uses, over node:sqlite.
function fakeD1(raw: any) {
  const run = (sql: string) => ({ results: raw.prepare(sql).all() });
  const prepare = (sql: string) => ({ sql, all: async () => run(sql) });
  return {
    prepare,
    batch: async (statements: { sql: string }[]) => {
      raw.exec("BEGIN");
      try {
        return statements.map((s) => run(s.sql));
      } finally {
        raw.exec("COMMIT");
      }
    },
  } as unknown as D1Database;
}

function fakeBucket(initial: string[] = []) {
  const files = new Map<string, string>(initial.map((k) => [k, "old"]));
  const bucket = {
    put: async (key: string, body: string) => void files.set(key, body),
    list: async ({ prefix }: { prefix: string }) => ({
      objects: [...files.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    }),
    delete: async (keys: string[]) => keys.forEach((k) => files.delete(k)),
  };
  return { files, bucket: bucket as unknown as R2Bucket };
}

const NOW = new Date("2026-11-02T03:17:00Z");
const NAME = `O'Neil "Béla"\nsecond line`;

function fill(raw: any) {
  raw
    .prepare(`INSERT INTO interest_signups (mode, name1, email1, level, consent_at) VALUES ('solo', ?, 'bela@example.test', 'halado', 1780000000)`)
    .run(NAME);
  raw.exec(`INSERT INTO users (id, email) VALUES ('u1', 'a@example.test')`);
  raw.exec(`INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ('s1', 'u1', 1790000000)`);
}

const tableCounts = (raw: any) =>
  Object.fromEntries(
    (raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(
      ({ name }) => [name, (raw.prepare(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number }).n],
    ),
  );

const schemaOf = (db: any) => db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();

describe("exportDatabase", () => {
  it("writes the whole database to one file that restores into an empty database", async () => {
    const raw = migratedDatabase();
    fill(raw);
    const { files, bucket } = fakeBucket();
    const result = await exportDatabase({ DB: fakeD1(raw), BACKUPS: bucket }, NOW);

    expect(result?.key).toBe("daily/padel-liga-2026-11-02.sql");
    expect([...files.keys()]).toEqual(["daily/padel-liga-2026-11-02.sql"]);

    // Foreign keys on, as in D1: sessions must come after users.
    const restored = new DatabaseSync(":memory:");
    restored.exec("PRAGMA foreign_keys = ON");
    restored.exec(files.get(result!.key)!);
    expect(tableCounts(restored)).toEqual(tableCounts(raw));
    expect(restored.prepare("SELECT name1 FROM interest_signups").get()).toEqual({ name1: NAME });
    expect(restored.prepare("SELECT user_id FROM sessions").get()).toEqual({ user_id: "u1" });
    expect(schemaOf(restored)).toEqual(schemaOf(raw));
    expect(result!.rows).toBeGreaterThanOrEqual(3);
  });

  it("deletes the files beyond the newest 35 after writing the new one", async () => {
    const raw = migratedDatabase();
    const old = Array.from({ length: 40 }, (_, i) => `daily/padel-liga-2026-${i < 20 ? "09" : "10"}-${String((i % 20) + 1).padStart(2, "0")}.sql`);
    const { files, bucket } = fakeBucket([...old, "daily/readme.txt"]);
    const result = await exportDatabase({ DB: fakeD1(raw), BACKUPS: bucket }, NOW);
    const daily = [...files.keys()].filter((k) => k.endsWith(".sql"));
    expect(daily).toHaveLength(35);
    expect(files.has("daily/padel-liga-2026-11-02.sql")).toBe(true);
    expect(files.has("daily/padel-liga-2026-09-01.sql")).toBe(false);
    expect(files.has("daily/readme.txt")).toBe(true);
    expect(result!.deleted).toBe(6);
  });

  it("keeps the old files when the write fails", async () => {
    const raw = migratedDatabase();
    const { files, bucket } = fakeBucket(["daily/padel-liga-2026-10-01.sql"]);
    (bucket as any).put = async () => {
      throw new Error("R2 down");
    };
    await expect(exportDatabase({ DB: fakeD1(raw), BACKUPS: bucket }, NOW)).rejects.toThrow("R2 down");
    expect([...files.keys()]).toEqual(["daily/padel-liga-2026-10-01.sql"]);
  });

  it("skips quietly without a bucket binding", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await exportDatabase({ DB: fakeD1(migratedDatabase()) }, NOW)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
