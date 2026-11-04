// Writing the audit log (#225, D91). Every organizer, Admin and system change
// writes one entry, in the same D1 batch (one transaction) as the change, so
// both are saved or neither. These return statements for that batch; nothing
// here runs a query on its own.
//
// Entries name things by id ("user:<id>", "pair:12"), never by email or
// phone. actorId null: the system (cron), shown as "Rendszer".
import { type SQL, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { rowSelect } from "~/db/insert-select";
import { auditLog, seasons } from "~/db/schema";

import type { AuditAction } from "./audit";

// A value for an entry: plain, or SQL worked out inside the batch (e.g. the
// id a statement before it just inserted).
type Value = string | number | null | SQL;

export type AuditInput = {
  actorId: string | null;
  action: AuditAction;
  target: Value;
  detail?: Value;
  leagueId?: number | SQL | null;
  // When it happened; the database clock when left out. The cron passes its
  // run's scheduled time, like everything else it writes (#188, #222).
  at?: Date;
};

// The league of a season, worked out inside the batch.
export function leagueOfSeason(seasonId: number): SQL {
  return sql`(select ${seasons.leagueId} from ${seasons} where ${seasons.id} = ${seasonId})`;
}

// An entry written unconditionally: put it in the batch of a change that
// either happens or makes the batch fail.
export function auditEntry(e: AuditInput) {
  return auditWhen(sql`1`, e);
}

// An entry only if the statement right before it in the batch changed a row
// (SQLite changes()): for a change guarded by its own WHERE.
export function auditIfChanged(e: AuditInput) {
  return auditWhen(sql`changes() > 0`, e);
}

// An entry only if `condition` holds when the batch reaches it.
export function auditWhen(condition: SQL, e: AuditInput) {
  return db.insert(auditLog).select(
    rowSelect(
      auditLog,
      {
        id: sql`null`,
        actorId: sql`${e.actorId}`,
        action: sql`${e.action}`,
        target: sql`${e.target}`,
        detail: sql`${e.detail ?? null}`,
        at: e.at ? sql`${Math.floor(e.at.getTime() / 1000)}` : sql`unixepoch()`,
        leagueId: sql`${e.leagueId ?? null}`,
      },
      sql`where ${condition}`,
    ),
  );
}
