// The daily database export (#32): pure parts. backup.server.ts reads D1 and
// writes R2; this file turns what it read into pieces of one SQL file that
// restores the database (README, "Restoring a backup").

// Every 5 minutes from 03:00 to 05:59 UTC (04:00-07:59 in Budapest). The
// export is split into steps, one per run, because a Workers Free invocation
// may spend only 10 ms of CPU and make 50 D1 queries; the first runs do the
// work, the rest find the day's file and stop. Must match the second entry of
// `triggers.crons` in app/wrangler.jsonc (backup.test.ts checks).
export const BACKUP_CRON = "*/5 3-5 * * *";
export const EMAIL_CRON = "0 * * * *";
// How many daily files stay in the bucket. The ticket asks for at least 30.
export const KEEP_BACKUPS = 35;
export const BACKUP_PREFIX = "daily/";
// Unfinished days: the pieces of the file being built.
export const WORK_PREFIX = "work/";

export type SqlValue = string | number | null | ArrayBuffer | number[];
export type SchemaRow = { type: string; name: string; sql: string };
export type SequenceRow = { name: string; seq: number };

// Which job a scheduled run is for (workers/app.ts).
export function cronJob(cron: string): "backup" | "email" {
  return cron === BACKUP_CRON ? "backup" : "email";
}

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

const userTables = (schema: SchemaRow[]) => schema.filter((s) => s.type === "table" && !isInternalTable(s.name));

// The tables to read, parents first.
export function tableOrder(schema: SchemaRow[]): string[] {
  return insertOrder(userTables(schema));
}

// Does the database have AUTOINCREMENT tables (and so a sqlite_sequence)?
export function hasSequences(schema: SchemaRow[]): boolean {
  return schema.some((s) => s.type === "table" && s.name === "sqlite_sequence");
}

// First piece of the file: a comment, the pragma and the CREATE TABLEs.
export function headSql(schema: SchemaRow[], takenAt: Date): string {
  const out = [
    `-- padel-liga database export, ${takenAt.toISOString()}`,
    "-- Restore: see README, \"Restoring a backup\".",
    "PRAGMA defer_foreign_keys = TRUE;",
    ...userTables(schema).map((t) => `${t.sql};`),
  ];
  return `${out.join("\n")}\n`;
}

// The INSERTs for some rows of a table.
export function rowsSql(table: string, rows: Record<string, SqlValue>[]): string {
  return rows.map((r) => `${insertStatement(table, r)}\n`).join("");
}

// Last piece: the AUTOINCREMENT counters, so a deleted highest id is not
// handed out again after a restore, then the indexes.
export function tailSql(schema: SchemaRow[], sequences: SequenceRow[]): string {
  const out: string[] = [];
  if (sequences.length) {
    out.push("DELETE FROM sqlite_sequence;");
    for (const s of sequences) out.push(insertStatement("sqlite_sequence", { name: s.name, seq: s.seq }));
  }
  for (const s of schema) if (s.type !== "table" && s.sql && !isInternalTable(s.name)) out.push(`${s.sql};`);
  return out.length ? `${out.join("\n")}\n` : "";
}

// "daily/padel-liga-2026-11-02.sql": the UTC day of the export.
export function backupKey(takenAt: Date): string {
  return `${BACKUP_PREFIX}padel-liga-${backupDay(takenAt)}.sql`;
}

export function backupDay(takenAt: Date): string {
  return takenAt.toISOString().slice(0, 10);
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
