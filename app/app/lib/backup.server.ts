import { env as workerEnv } from "cloudflare:workers";

import {
  BACKUP_PREFIX,
  backupKey,
  dumpSql,
  isInternalTable,
  keysToDelete,
  type SchemaRow,
  type SqlValue,
} from "./backup";

// The daily export (#32): the whole database as one SQL file in R2, written
// by the daily cron (workers/app.ts). Runs inside the Worker with the DB and
// BACKUPS bindings, so it needs no API token. D1 Time Travel (30 days) stays
// the first line of defence; this copy is for a restore from a file.

type Bindings = { DB: D1Database; BACKUPS?: R2Bucket };

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

export type BackupResult = { key: string; tables: number; rows: number; bytes: number; deleted: number };

// Returns null when the bucket isn't bound (local dev without R2, a deploy
// before Peter created the bucket): nothing to write to, nothing to fail.
export async function exportDatabase(
  env: Bindings = workerEnv as unknown as Bindings,
  now = new Date(),
): Promise<BackupResult | null> {
  const bucket = env.BACKUPS;
  if (!bucket) {
    console.warn("backup: no BACKUPS binding, skipped");
    return null;
  }
  const { results: schema } = await env.DB.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid",
  ).all<SchemaRow>();
  const tableNames = schema.filter((s) => s.type === "table" && !isInternalTable(s.name)).map((s) => s.name);
  // One batch is one transaction: every table is read at the same moment, so
  // the file never shows half of a pair or a signup without its partner.
  // The batch counts one D1 query per table: far below the Workers limit.
  const read = await env.DB.batch<Record<string, SqlValue>>(
    tableNames.map((name) => env.DB.prepare(`SELECT * FROM ${quote(name)}`)),
  );
  const tables = tableNames.map((name, i) => ({ name, rows: read[i]!.results }));
  const sql = dumpSql(schema, tables, now);
  const key = backupKey(now);
  await bucket.put(key, sql, { httpMetadata: { contentType: "application/sql; charset=utf-8" } });

  // Only after the new file is safely written.
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const old = keysToDelete(keys);
  if (old.length) await bucket.delete(old);

  return {
    key,
    tables: tables.length,
    rows: tables.reduce((n, t) => n + t.rows.length, 0),
    bytes: new TextEncoder().encode(sql).length,
    deleted: old.length,
  };
}
