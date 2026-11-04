import { getTableColumns, type SQL, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

// The SELECT of an `insert ... select` built with db.insert(table).select():
// a value for every column, in the table's order (drizzle lists all columns
// for a SQL select), then `rest` (from/where). A builder, unlike a raw
// db.run(), can go in a D1 batch (#225).
export function rowSelect<T extends SQLiteTable>(table: T, values: Record<keyof T["$inferSelect"], SQL>, rest: SQL): SQL {
  const columns = Object.keys(getTableColumns(table)) as (keyof T["$inferSelect"])[];
  return sql`select ${sql.join(
    columns.map((c) => values[c]),
    sql`, `,
  )} ${rest}`;
}
