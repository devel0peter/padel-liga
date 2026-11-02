// The daily database export (#32): pure parts. backup.server.ts reads D1 and
// writes R2; this file turns what it read into one SQL file that restores
// the database (README, "Restoring a backup").

// UTC 03:17, i.e. 04:17 or 05:17 in Budapest. Must match the second entry of
// `triggers.crons` in app/wrangler.jsonc (backup.test.ts checks).
export const BACKUP_CRON = "17 3 * * *";
// How many daily files stay in the bucket. The ticket asks for at least 30.
export const KEEP_BACKUPS = 35;
export const BACKUP_PREFIX = "daily/";

export type SqlValue = string | number | null | ArrayBuffer | number[];
export type SchemaRow = { type: string; name: string; sql: string };
export type TableDump = { name: string; rows: Record<string, SqlValue>[] };

// Tables SQLite and Cloudflare keep for themselves: they come back on their
// own and can't be created by hand.
export function isInternalTable(name: string): boolean {
  return name.startsWith("sqlite_") || name.startsWith("_cf_");
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

export function sqlLiteral(value: SqlValue | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cannot export the number ${value}`);
    return String(value);
  }
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value);
  return `X'${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}'`;
}

export function insertStatement(table: string, row: Record<string, SqlValue>): string {
  const columns = Object.keys(row);
  return `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES (${columns.map((c) => sqlLiteral(row[c])).join(", ")});`;
}

// Tables in an order that lets every INSERT find its parent row: a table
// comes after the tables its CREATE statement REFERENCES. D1 enforces foreign
// keys while a file runs, so the order matters for a restore into D1 or a
// local D1. A cycle (none today) keeps the original order for what is left.
export function insertOrder(tables: SchemaRow[]): string[] {
  const names = tables.map((t) => t.name);
  const parents = new Map<string, Set<string>>();
  for (const t of tables) {
    const refs = new Set<string>();
    for (const m of t.sql.matchAll(/\bREFERENCES\s+[`"'[]?([A-Za-z0-9_]+)/gi)) {
      const parent = m[1]!;
      if (parent !== t.name && names.includes(parent)) refs.add(parent);
    }
    parents.set(t.name, refs);
  }
  const done: string[] = [];
  const left = [...names];
  while (left.length) {
    const i = left.findIndex((n) => [...parents.get(n)!].every((p) => done.includes(p)));
    const next = left.splice(i === -1 ? 0 : i, 1)[0]!;
    done.push(next);
  }
  return done;
}

// The whole file: schema, then the rows of every table, then the indexes.
// Plain SQL that sqlite3 and `wrangler d1 execute --file` both run.
export function dumpSql(schema: SchemaRow[], tables: TableDump[], takenAt: Date): string {
  const create = schema.filter((s) => s.type === "table" && !isInternalTable(s.name));
  const rest = schema.filter((s) => s.type !== "table" && !isInternalTable(s.name));
  const byName = new Map(tables.map((t) => [t.name, t]));
  const out: string[] = [
    `-- padel-liga database export, ${takenAt.toISOString()}`,
    "-- Restore: see README, \"Restoring a backup\".",
    "PRAGMA defer_foreign_keys = TRUE;",
  ];
  for (const t of create) out.push(`${t.sql};`);
  for (const name of insertOrder(create))
    for (const row of byName.get(name)?.rows ?? []) out.push(insertStatement(name, row));
  for (const s of rest) out.push(`${s.sql};`);
  return `${out.join("\n")}\n`;
}

// "daily/padel-liga-2026-11-02.sql": the UTC day of the export.
export function backupKey(takenAt: Date): string {
  return `${BACKUP_PREFIX}padel-liga-${takenAt.toISOString().slice(0, 10)}.sql`;
}

const KEY = /^daily\/padel-liga-\d{4}-\d{2}-\d{2}\.sql$/;

// The keys to delete: all but the newest `keep` daily files. Anything else
// in the bucket is left alone.
export function keysToDelete(keys: string[], keep = KEEP_BACKUPS): string[] {
  return keys
    .filter((k) => KEY.test(k))
    .sort()
    .reverse()
    .slice(keep);
}
