import { describe, expect, it } from "vitest";

import {
  BACKUP_CRON,
  KEEP_BACKUPS,
  backupKey,
  dumpSql,
  insertOrder,
  insertStatement,
  isInternalTable,
  keysToDelete,
  sqlLiteral,
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

describe("dumpSql", () => {
  const schema = [
    { type: "table", name: "child", sql: 'CREATE TABLE "child" (id integer, p integer REFERENCES parent(id))' },
    { type: "table", name: "parent", sql: 'CREATE TABLE "parent" (id integer)' },
    { type: "index", name: "child_p", sql: 'CREATE INDEX "child_p" ON "child" (p)' },
    { type: "table", name: "sqlite_sequence", sql: "CREATE TABLE sqlite_sequence(name,seq)" },
    { type: "table", name: "_cf_KV", sql: "CREATE TABLE _cf_KV (k)" },
  ];
  const tables = [
    { name: "child", rows: [{ id: 1, p: 7 }] },
    { name: "parent", rows: [{ id: 7 }] },
  ];
  const lines = dumpSql(schema, tables, new Date("2026-11-02T03:17:00Z")).trim().split("\n");

  it("creates tables, inserts parents first, then the indexes", () => {
    expect(lines.slice(3)).toEqual([
      'CREATE TABLE "child" (id integer, p integer REFERENCES parent(id));',
      'CREATE TABLE "parent" (id integer);',
      'INSERT INTO "parent" ("id") VALUES (7);',
      'INSERT INTO "child" ("id", "p") VALUES (1, 7);',
      'CREATE INDEX "child_p" ON "child" (p);',
    ]);
  });
  it("starts with a timestamp and the pragma", () => {
    expect(lines[0]).toContain("2026-11-02T03:17:00.000Z");
    expect(lines[2]).toBe("PRAGMA defer_foreign_keys = TRUE;");
  });
  it("leaves out SQLite's and Cloudflare's own tables", () => {
    expect(isInternalTable("sqlite_sequence")).toBe(true);
    expect(isInternalTable("_cf_KV")).toBe(true);
    expect(isInternalTable("users")).toBe(false);
    expect(lines.join("\n")).not.toContain("sqlite_sequence");
    expect(lines.join("\n")).not.toContain("_cf_KV");
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

describe("wrangler.jsonc", () => {
  it("schedules the export cron and binds the bucket", async () => {
    const { readFileSync } = await import(/* @vite-ignore */ `node:${"fs"}`);
    const text = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8") as string;
    expect(text).toContain(`"crons": ["0 * * * *", "${BACKUP_CRON}"]`);
    expect(text).toMatch(/"binding": "BACKUPS"/);
  });
});
