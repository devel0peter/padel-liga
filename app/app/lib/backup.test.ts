import { describe, expect, it } from "vitest";

import {
  BACKUP_CRON,
  STEPS_CRON,
  KEEP_BACKUPS,
  backupKey,
  cronJob,
  foreignKeys,
  hasSequences,
  headSql,
  insertOrder,
  insertStatement,
  isInternalTable,
  keysToDelete,
  cleanupSql,
  duplicateCleanupSql,
  orphanCleanupSql,
  rowsSql,
  sqlLiteral,
  tableOrder,
  tailSql,
  uniqueIndex,
} from "./backup";

describe("sqlLiteral", () => {
  it("writes null, numbers, text and bytes", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(undefined)).toBe("NULL");
    expect(sqlLiteral(0)).toBe("0");
    expect(sqlLiteral(-12.5)).toBe("-12.5");
    expect(sqlLiteral("Kovács Éva")).toBe("'Kovács Éva'");
    expect(sqlLiteral([0, 15, 255])).toBe("X'000fff'");
    expect(sqlLiteral(new Uint8Array([1, 171]).buffer)).toBe("X'01ab'");
  });
  it("doubles quotes and keeps newlines", () => {
    expect(sqlLiteral("O'Neil\nsecond line")).toBe("'O''Neil\nsecond line'");
  });
  it("refuses a number SQL can't hold", () => {
    expect(() => sqlLiteral(Number.NaN)).toThrow();
    expect(() => sqlLiteral(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("insertStatement", () => {
  it("quotes table and column names", () => {
    expect(insertStatement("users", { id: 1, 'na"me': "x", note: null })).toBe(
      `INSERT INTO "users" ("id", "na""me", "note") VALUES (1, 'x', NULL);`,
    );
  });
});

describe("insertOrder", () => {
  const t = (name: string, sql: string) => ({ type: "table", name, sql });
  it("puts a table after the tables it references", () => {
    const order = insertOrder([
      t("child", 'CREATE TABLE "child" (id integer, parent_id integer REFERENCES "parent"(id))'),
      t("parent", 'CREATE TABLE "parent" (id integer, boss integer REFERENCES parent(id))'),
      t("grandchild", "CREATE TABLE grandchild (c integer, FOREIGN KEY (c) REFERENCES `child`(id))"),
    ]);
    expect(order).toEqual(["parent", "child", "grandchild"]);
  });
  it("keeps the order of tables that don't depend on each other", () => {
    expect(insertOrder([t("b", "CREATE TABLE b (x)"), t("a", "CREATE TABLE a (x)")])).toEqual(["b", "a"]);
  });
  it("does not loop on a cycle", () => {
    const order = insertOrder([t("a", "CREATE TABLE a (b references b)"), t("b", "CREATE TABLE b (a references a)")]);
    expect([...order].sort()).toEqual(["a", "b"]);
  });
});

describe("the pieces of the file", () => {
  const schema = [
    { type: "table", name: "child", sql: 'CREATE TABLE "child" (id integer, p integer REFERENCES parent(id))' },
    { type: "table", name: "parent", sql: 'CREATE TABLE "parent" (id integer)' },
    { type: "index", name: "child_p", sql: 'CREATE INDEX "child_p" ON "child" (p)' },
    { type: "table", name: "sqlite_sequence", sql: "CREATE TABLE sqlite_sequence(name,seq)" },
    { type: "table", name: "_cf_KV", sql: "CREATE TABLE _cf_KV (k)" },
  ];

  it("reads the parents first", () => {
    expect(tableOrder(schema)).toEqual(["parent", "child"]);
  });
  it("starts with a timestamp, the pragma and the CREATE TABLEs, not SQLite's own", () => {
    const lines = headSql(schema, new Date("2026-11-02T03:17:00Z")).trim().split("\n");
    expect(lines[0]).toContain("2026-11-02T03:17:00.000Z");
    expect(lines.slice(2)).toEqual([
      "PRAGMA defer_foreign_keys = TRUE;",
      'CREATE TABLE "child" (id integer, p integer REFERENCES parent(id));',
      'CREATE TABLE "parent" (id integer);',
    ]);
  });
  it("writes one INSERT OR REPLACE per row, so a primary key read twice keeps the later row (#179)", () => {
    expect(rowsSql("parent", [{ id: 7 }, { id: 8 }])).toBe(
      'INSERT OR REPLACE INTO "parent" ("id") VALUES (7);\nINSERT OR REPLACE INTO "parent" ("id") VALUES (8);\n',
    );
    expect(rowsSql("parent", [])).toBe("");
  });
  it("ends with the AUTOINCREMENT counters, then the indexes", () => {
    expect(tailSql(schema, [{ name: "child", seq: 41 }]).trim().split("\n")).toEqual([
      "DELETE FROM sqlite_sequence;",
      `INSERT INTO "sqlite_sequence" ("name", "seq") VALUES ('child', 41);`,
      'CREATE INDEX "child_p" ON "child" (p);',
    ]);
    expect(tailSql(schema, [])).toBe('CREATE INDEX "child_p" ON "child" (p);\n');
  });
  it("knows whether there are counters to copy", () => {
    expect(hasSequences(schema)).toBe(true);
    expect(hasSequences(schema.filter((s) => s.name !== "sqlite_sequence"))).toBe(false);
  });
  it("leaves out SQLite's and Cloudflare's own tables", () => {
    expect(isInternalTable("sqlite_sequence")).toBe(true);
    expect(isInternalTable("_cf_KV")).toBe(true);
    expect(isInternalTable("users")).toBe(false);
    const all = headSql(schema, new Date()) + tailSql(schema, []);
    expect(all).not.toContain("_cf_KV");
    expect(all).not.toContain("CREATE TABLE sqlite_sequence");
  });
});

describe("retention", () => {
  const key = (d: number) => backupKey(new Date(Date.UTC(2026, 10, d)));
  it("names the file after the UTC day", () => {
    expect(backupKey(new Date("2026-11-02T23:59:59Z"))).toBe("daily/padel-liga-2026-11-02.sql");
    expect(backupKey(new Date("2026-11-03T00:00:00Z"))).toBe("daily/padel-liga-2026-11-03.sql");
  });
  it("keeps at least 30 daily files", () => {
    expect(KEEP_BACKUPS).toBeGreaterThanOrEqual(30);
  });
  it("deletes the oldest beyond the newest N, whatever the listing order", () => {
    const keys = [3, 1, 5, 2, 4].map(key);
    expect(keysToDelete(keys, 3)).toEqual([key(2), key(1)]);
  });
  it("deletes nothing while there are no more than N", () => {
    expect(keysToDelete([1, 2, 3].map(key), 3)).toEqual([]);
    expect(keysToDelete([], 3)).toEqual([]);
  });
  it("leaves files it didn't write alone", () => {
    expect(keysToDelete(["daily/notes.txt", "other/padel-liga-2020-01-01.sql", key(1), key(2)], 1)).toEqual([key(1)]);
  });
});

describe("which job a cron runs", () => {
  it("sends the export cron to the export and everything else to the 10-minute cron steps", () => {
    expect(cronJob(BACKUP_CRON)).toBe("backup");
    expect(cronJob(STEPS_CRON)).toBe("steps");
    expect(cronJob("17 3 * * *")).toBe("steps");
    expect(cronJob("")).toBe("steps");
  });
  it("is the pair of crons in wrangler.jsonc, with the bucket bound", async () => {
    const { readFileSync } = await import(/* @vite-ignore */ `node:${"fs"}`);
    const text = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8") as string;
    expect(text).toContain(`"crons": ["${STEPS_CRON}", "${BACKUP_CRON}"]`);
    expect(text).toMatch(/"binding": "BACKUPS"/);
  });
});

describe("foreignKeys", () => {
  it("reads drizzle's table-level keys, composite ones too", () => {
    expect(
      foreignKeys("CREATE TABLE `s` (`id` integer, `u` text, `a` integer, `b` integer, FOREIGN KEY (`u`) REFERENCES `users`(`id`) ON DELETE cascade, FOREIGN KEY (`a`, `b`) REFERENCES `pairs`(`x`, `y`))"),
    ).toEqual([
      { columns: ["u"], parent: "users", parentColumns: ["id"], onDelete: "cascade" },
      { columns: ["a", "b"], parent: "pairs", parentColumns: ["x", "y"], onDelete: "no action" },
    ]);
  });
  it("reads a column added with ALTER TABLE ... REFERENCES, once", () => {
    expect(foreignKeys("CREATE TABLE `m` (`id` integer PRIMARY KEY NOT NULL, `club_id` integer REFERENCES clubs(id))")).toEqual([
      { columns: ["club_id"], parent: "clubs", parentColumns: ["id"], onDelete: "no action" },
    ]);
  });
  it("reads each key's ON DELETE action, wherever ON UPDATE stands (#282)", () => {
    const sql =
      "CREATE TABLE `a` (`id` integer, `by` text, `league_id` integer REFERENCES leagues(id) ON DELETE set null, `x` text, `y` text, " +
      "FOREIGN KEY (`by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE SET  NULL, " +
      "FOREIGN KEY (`x`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade, " +
      "FOREIGN KEY (`y`) REFERENCES `users`(`id`) ON UPDATE cascade)";
    expect(foreignKeys(sql).map((k) => [k.columns[0], k.onDelete])).toEqual([
      ["by", "set null"],
      ["x", "restrict"],
      ["y", "no action"],
      ["league_id", "set null"],
    ]);
  });
  it("finds nothing in a table without keys", () => {
    expect(foreignKeys("CREATE TABLE `t` (`id` integer PRIMARY KEY, `note` text)")).toEqual([]);
  });
});

describe("orphanCleanupSql", () => {
  const schema = [
    { type: "table", name: "sessions", sql: 'CREATE TABLE `sessions` (`id` text, `user_id` text, FOREIGN KEY (`user_id`) REFERENCES `users`(`id`))' },
    { type: "table", name: "users", sql: "CREATE TABLE `users` (`id` text PRIMARY KEY)" },
    { type: "table", name: "logins", sql: "CREATE TABLE `logins` (`id` text, `session` text REFERENCES sessions(id))" },
  ];
  it("deletes children without a parent, parents' tables first", () => {
    expect(orphanCleanupSql(schema).trim().split("\n")).toEqual([
      'DELETE FROM "sessions" WHERE "user_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" AS "r" WHERE "r"."id" = "sessions"."user_id");',
      'DELETE FROM "logins" WHERE "session" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sessions" AS "r" WHERE "r"."id" = "logins"."session");',
    ]);
  });
  it("empties a link that is ON DELETE SET NULL and keeps the row; deletes the other orphans (#282)", () => {
    const linked = [
      { type: "table", name: "users", sql: "CREATE TABLE `users` (`id` text PRIMARY KEY)" },
      {
        type: "table",
        name: "audit_log",
        sql:
          "CREATE TABLE `audit_log` (`id` integer, `actor_id` text, `a` text, `b` text, FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null, " +
          "FOREIGN KEY (`a`, `b`) REFERENCES `pairs`(`x`, `y`) ON DELETE set null)",
      },
      { type: "table", name: "pairs", sql: "CREATE TABLE `pairs` (`x` text, `y` text, `player_a` text REFERENCES users(id) ON DELETE restrict)" },
    ];
    expect(orphanCleanupSql(linked).trim().split("\n")).toEqual([
      'DELETE FROM "pairs" WHERE "player_a" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" AS "r" WHERE "r"."id" = "pairs"."player_a");',
      'UPDATE "audit_log" SET "actor_id" = NULL WHERE "actor_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" AS "r" WHERE "r"."id" = "audit_log"."actor_id");',
      'UPDATE "audit_log" SET "a" = NULL, "b" = NULL WHERE "a" IS NOT NULL AND "b" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "pairs" AS "r" WHERE "r"."x" = "audit_log"."a" AND "r"."y" = "audit_log"."b");',
    ]);
  });
  it("is empty when no table has a key, and goes before the counters in the tail", () => {
    expect(orphanCleanupSql([{ type: "table", name: "t", sql: "CREATE TABLE t (id integer)" }])).toBe("");
    const tail = tailSql(schema, [{ name: "t", seq: 3 }], orphanCleanupSql(schema)).split("\n");
    expect(tail[0]).toContain('DELETE FROM "sessions"');
    expect(tail.indexOf("DELETE FROM sqlite_sequence;")).toBeGreaterThan(1);
  });
});

describe("uniqueIndex", () => {
  it("reads drizzle's unique and partial indexes", () => {
    expect(uniqueIndex("CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`)")).toEqual({
      name: "users_email_unique",
      table: "users",
      columns: ["`email`"],
      where: null,
    });
    expect(uniqueIndex("CREATE UNIQUE INDEX `pairs_active_a_idx` ON `pairs` (`league_id`,`player_a`) WHERE status = 'active'")).toEqual({
      name: "pairs_active_a_idx",
      table: "pairs",
      columns: ["`league_id`", "`player_a`"],
      where: "status = 'active'",
    });
  });
  it("keeps expressions whole and drops ASC/DESC", () => {
    expect(uniqueIndex('CREATE UNIQUE INDEX IF NOT EXISTS "x" ON "t" (lower(a, \'(,)\'), b DESC)')?.columns).toEqual(["lower(a, '(,)')", "b"]);
  });
  it("is null for an index that isn't unique", () => {
    expect(uniqueIndex("CREATE INDEX `pairs_league_idx` ON `pairs` (`league_id`)")).toBeNull();
  });
});

describe("duplicateCleanupSql", () => {
  const schema = [
    { type: "table", name: "pairs", sql: "CREATE TABLE `pairs` (`id` integer PRIMARY KEY, `league_id` integer, `player_a` text REFERENCES users(id), `status` text)" },
    { type: "table", name: "users", sql: "CREATE TABLE `users` (`id` text PRIMARY KEY, `email` text)" },
    { type: "index", name: "pairs_active_a_idx", sql: "CREATE UNIQUE INDEX `pairs_active_a_idx` ON `pairs` (`league_id`,`player_a`) WHERE status = 'active'" },
    { type: "index", name: "users_email_unique", sql: "CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`)" },
    { type: "index", name: "pairs_league_idx", sql: "CREATE INDEX `pairs_league_idx` ON `pairs` (`league_id`)" },
  ];
  it("keeps the highest rowid per value of every unique index, parents' tables first, NULLs left alone", () => {
    expect(duplicateCleanupSql(schema).trim().split("\n")).toEqual([
      'DELETE FROM "users" WHERE (`email`) IS NOT NULL AND rowid NOT IN (SELECT max(rowid) FROM "users" WHERE (`email`) IS NOT NULL GROUP BY `email`);',
      'DELETE FROM "pairs" WHERE (`league_id`) IS NOT NULL AND (`player_a`) IS NOT NULL AND (status = \'active\') AND rowid NOT IN ' +
        '(SELECT max(rowid) FROM "pairs" WHERE (`league_id`) IS NOT NULL AND (`player_a`) IS NOT NULL AND (status = \'active\') GROUP BY `league_id`, `player_a`);',
    ]);
  });
  it("runs before the orphan cleanup, so a dropped row's children go too", () => {
    const all = cleanupSql(schema).trim().split("\n");
    expect(all).toHaveLength(3);
    expect(all[2]).toContain('DELETE FROM "pairs" WHERE "player_a" IS NOT NULL AND NOT EXISTS');
  });
  it("is empty without unique indexes", () => {
    expect(duplicateCleanupSql(schema.filter((s) => !s.name.endsWith("unique") && !s.name.endsWith("a_idx")))).toBe("");
  });
});
