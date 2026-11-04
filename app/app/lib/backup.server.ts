import { env as workerEnv } from "cloudflare:workers";

import {
  BACKUP_PREFIX,
  WORK_PREFIX,
  backupDay,
  backupKey,
  cleanupSql,
  hasSequences,
  headSql,
  keysToDelete,
  rowsSql,
  tableOrder,
  tailSql,
  type SchemaRow,
  type SequenceRow,
  type SqlValue,
} from "./backup";
import { logError, logWarn } from "./log";

// The daily export (#32): the whole database as one SQL file in R2, built by
// the cron in workers/app.ts. Runs inside the Worker with the DB and BACKUPS
// bindings, so it needs no API token. D1 Time Travel (30 days) stays the
// first line of defence; this copy is for a restore from a file.
//
// A Workers Free invocation gets 10 ms of CPU and 50 subrequests (D1 queries
// and R2 calls count), so one run does only a step: it reads a few pages of
// rows, appends them as one piece to R2 and records where it stopped. The
// cron fires every few minutes (BACKUP_CRON); the run after the last piece
// glues the pieces into daily/padel-liga-<day>.sql, prunes old days and
// deletes the pieces. Runs after that find the file and stop at once.
//
// Building the text costs about 5 ms of CPU per MB (measured on 20,000 rows
// of 370 bytes), so a step stops at STEP_CHARS.

type Bindings = { DB: D1Database; BACKUPS?: R2Bucket };

export type Limits = {
  // D1 queries and R2 calls one run may make. Free allows 50.
  maxOps: number;
  // Rows per D1 query.
  pageRows: number;
  // Characters of SQL one run builds before it writes a piece.
  stepChars: number;
};
export const LIMITS: Limits = { maxOps: 40, pageRows: 200, stepChars: 400_000 };

type Part = { key: string; size: number };
type State = {
  day: string;
  takenAt: string;
  tables: string[];
  // Index of the table being read and the last rowid read in it.
  table: number;
  after: number;
  parts: Part[];
  tail: { schema: SchemaRow[]; sequences: boolean; cleanup: string };
  // Everything is read and written as pieces; the file is not glued yet.
  complete: boolean;
};

export type StepResult =
  | { status: "skipped" | "done" }
  | { status: "progress"; parts: number; table: string | null; ops: number }
  | { status: "finished"; key: string; bytes: number; parts: number; deleted: number; ops: number };

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const ROWID = "__rowid";

export async function exportStep(
  env: Bindings = workerEnv as unknown as Bindings,
  now = new Date(),
  limits: Limits = LIMITS,
): Promise<StepResult> {
  const bucket = env.BACKUPS;
  if (!bucket) {
    logWarn("backup skipped", { reason: "no BACKUPS binding" });
    return { status: "skipped" };
  }
  let ops = 0;
  const day = backupDay(now);
  const key = backupKey(now);
  const stateKey = `${WORK_PREFIX}${day}/state.json`;
  const partKey = (n: number) => `${WORK_PREFIX}${day}/part-${String(n).padStart(4, "0")}.sql`;
  const query = async <T>(sql: string, ...params: unknown[]) => {
    ops++;
    const { results } = await env.DB.prepare(sql).bind(...params).all<T>();
    return results;
  };
  const saveState = async (s: State) => {
    ops++;
    await bucket.put(stateKey, JSON.stringify(s));
  };
  const savePart = async (s: State, sql: string) => {
    ops++;
    const o = await bucket.put(partKey(s.parts.length + 1), sql);
    if (!o) throw new Error("backup: R2 did not store a piece");
    s.parts.push({ key: o.key, size: o.size });
  };

  ops++;
  if (await bucket.head(key)) return { status: "done" };

  ops++;
  const saved = await bucket.get(stateKey);
  let state: State;
  if (saved) {
    state = JSON.parse(await saved.text()) as State;
  } else {
    await dropOtherDays(bucket, day, () => ops++);
    const schema = await query<SchemaRow>("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid");
    state = {
      day,
      takenAt: now.toISOString(),
      tables: tableOrder(schema),
      table: 0,
      after: Number.MIN_SAFE_INTEGER,
      parts: [],
      tail: { schema: schema.filter((s) => s.type !== "table" || s.name === "sqlite_sequence"), sequences: hasSequences(schema), cleanup: cleanupSql(schema) },
      complete: false,
    };
    await savePart(state, headSql(schema, now));
  }

  if (!state.complete) {
    // Reserve the calls after the loop: the sequence query, a piece, the state.
    const buffer: string[] = [];
    let chars = 0;
    while (state.table < state.tables.length && ops < limits.maxOps - 3 && chars < limits.stepChars) {
      const name = state.tables[state.table]!;
      const rows = await query<Record<string, SqlValue>>(
        `SELECT rowid AS ${ROWID}, * FROM ${quote(name)} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
        state.after,
        limits.pageRows,
      );
      const last = rows.at(-1);
      if (last) {
        state.after = last[ROWID] as number;
        for (const row of rows) delete row[ROWID];
        const sql = rowsSql(name, rows);
        buffer.push(sql);
        chars += sql.length;
      }
      if (rows.length < limits.pageRows) {
        state.table++;
        state.after = Number.MIN_SAFE_INTEGER;
      }
    }
    if (state.table >= state.tables.length) {
      const sequences = state.tail.sequences ? await query<SequenceRow>("SELECT name, seq FROM sqlite_sequence ORDER BY name") : [];
      buffer.push(tailSql(state.tail.schema, sequences, state.tail.cleanup));
      state.complete = true;
    }
    if (buffer.length) await savePart(state, buffer.join(""));
    await saveState(state);
    if (!state.complete) {
      return { status: "progress", parts: state.parts.length, table: state.tables[state.table] ?? null, ops };
    }
  }

  // Glue the pieces, if this run still has the calls for it (else the next).
  if (state.parts.length + 7 > limits.maxOps) {
    throw new Error(`backup: ${state.parts.length} pieces are too many to glue within ${limits.maxOps} calls; raise stepChars or split the export further`);
  }
  if (ops + state.parts.length + 5 > limits.maxOps) {
    return { status: "progress", parts: state.parts.length, table: null, ops };
  }
  const total = state.parts.reduce((n, p) => n + p.size, 0);
  const { readable, writable } = new FixedLengthStream(total);
  ops++;
  const putting = bucket.put(key, readable, { httpMetadata: { contentType: "application/sql; charset=utf-8" } });
  const feeding = (async () => {
    for (const part of state.parts) {
      ops++;
      const o = await bucket.get(part.key);
      if (!o) throw new Error(`backup: piece ${part.key} is missing`);
      await o.body.pipeTo(writable, { preventClose: true });
    }
    await writable.close();
  })();
  // If the write fails first, nobody reads the stream: don't wait on the feeding.
  feeding.catch(() => {});
  await Promise.all([putting, feeding]);

  // Only after the new file is safely written.
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    ops++;
    const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const old = keysToDelete(keys);
  if (old.length) {
    ops++;
    await bucket.delete(old);
  }
  ops++;
  await bucket.delete([...state.parts.map((p) => p.key), stateKey]);
  return { status: "finished", key, bytes: total, parts: state.parts.length, deleted: old.length, ops };
}

// Pieces of an earlier day that never got finished: report and delete them.
async function dropOtherDays(bucket: R2Bucket, day: string, count: () => void) {
  count();
  const listed = await bucket.list({ prefix: WORK_PREFIX });
  const stale = listed.objects.map((o) => o.key).filter((k) => !k.startsWith(`${WORK_PREFIX}${day}/`));
  if (!stale.length) return;
  logError("backup unfinished day dropped", { pieces: stale.length, first: stale[0] });
  count();
  await bucket.delete(stale);
}
