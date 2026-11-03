// For server-module tests: a real SQLite (node:sqlite, in memory) with every
// migration in app/drizzle applied, behind the same Drizzle API the app uses
// on D1. Use it from a vi.mock of "~/db/client.server":
//
//   const h = vi.hoisted(() => ({ raw: null as any }));
//   vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
//   beforeEach(() => { h.raw = migratedDatabase(); });
//
// Not a test file itself; only imported by tests.
import { entityKind } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";

import * as schema from "~/db/schema";
import { countQuery } from "~/lib/run-usage";

// Node built-ins: this runs in Vitest (Node) but is type-checked with the
// Workers types, which have no node:fs or node:sqlite.
const { readdirSync, readFileSync } = await import(/* @vite-ignore */ `node:${"fs"}`);
const { DatabaseSync } = await import(/* @vite-ignore */ `node:${"sqlite"}`);

const MIGRATIONS = new URL("../../drizzle/", import.meta.url);

const D1_MAX_PARAMS = 100;

// A fresh in-memory database with every migration applied.
export function migratedDatabase(): any {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const files = (readdirSync(MIGRATIONS) as string[]).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files)
    for (const stmt of readFileSync(new URL(f, MIGRATIONS), "utf8").split("--> statement-breakpoint"))
      if (stmt.trim()) raw.exec(stmt);
  return raw;
}

// The module that replaces ~/db/client.server: `db` runs on whatever
// database `h.raw` holds at the time of the query. A batch is a transaction,
// as on D1, and refuses what D1 refuses (see rejectRawInBatch).
export function mockClient(h: { raw: any }) {
  const exec = (sql: string, params: any[], method: string) => {
    // D1 refuses a statement with more than 100 bound parameters; SQLite
    // allows far more, so check it here or tests would miss it.
    if (params.length > D1_MAX_PARAMS) throw new Error(`too many SQL variables: ${params.length} (D1 allows ${D1_MAX_PARAMS})`);
    const st = h.raw.prepare(sql);
    if (method === "run") {
      st.run(...params);
      return { rows: [] };
    }
    st.setReturnArrays(true);
    if (method === "get") return { rows: st.get(...params) ?? undefined };
    return { rows: st.all(...params) };
  };
  // Each statement counts as one query of the run, a batch once, as on D1
  // (lib/run-usage.ts, #183).
  const db = drizzle(
    async (sql, params, method) => {
      countQuery();
      return exec(sql, params, method);
    },
    async (queries) => {
      countQuery();
      h.raw.exec("BEGIN");
      try {
        const out = queries.map((q) => exec(q.sql, q.params, q.method));
        h.raw.exec("COMMIT");
        return out;
      } catch (e) {
        h.raw.exec("ROLLBACK");
        throw e;
      }
    },
    { schema },
  );
  const batch = db.batch.bind(db) as (queries: any[]) => Promise<any>;
  (db as any).batch = async (queries: any[]) => {
    rejectRawInBatch(queries);
    return batch(queries);
  };
  return { db };
}

// On D1 a raw statement with bound parameters (db.run(sql`... ${x}`)) can't
// go in db.batch: drizzle has no prepared statement for it and the batch
// throws before anything runs. sqlite-proxy accepts it, so refuse it here.
function rejectRawInBatch(queries: any[]) {
  for (const q of queries) {
    if (q?.constructor?.[entityKind] !== "SQLiteRaw") continue;
    if (q.getQuery().params.length > 0)
      throw new TypeError(
        "Cannot read properties of undefined (reading 'bind'): a raw statement with parameters can't go in a D1 batch, use a query builder",
      );
  }
}
