import { cronJob } from "./backup";
import type { StepResult } from "./backup.server";
import { beginInvocation, logError, logInfo } from "./log";

// What workers/app.ts does for a cron trigger, apart from the Worker's own
// imports so a test can run it with stand-ins for the two jobs.
export type Jobs = {
  backup: () => Promise<StepResult>;
  hourly: (now: Date) => Promise<void>;
};

type Controller = { cron: string; scheduledTime: number };

export function runScheduled(controller: Controller, ctx: { waitUntil(promise: Promise<unknown>): void }, jobs: Jobs): void {
  if (cronJob(controller.cron) === "backup") {
    ctx.waitUntil(runBackup(jobs.backup));
    return;
  }
  ctx.waitUntil(jobs.hourly(new Date(controller.scheduledTime)));
}

// One export step and its log line (#227): a line while it works and when the
// day's file is written; every run after that ("done") stays quiet. A failed
// step logs an error and still fails, so the cron run shows as failed too.
async function runBackup(backup: Jobs["backup"]): Promise<void> {
  const requestId = `backup-${crypto.randomUUID()}`;
  const end = beginInvocation(requestId);
  try {
    const r = await backup();
    if (r.status === "progress") logInfo("backup step", { requestId, pieces: r.parts, table: r.table, calls: r.ops });
    if (r.status === "finished") {
      logInfo("backup finished", { requestId, file: r.key, bytes: r.bytes, pieces: r.parts, deletedFiles: r.deleted, calls: r.ops });
    }
  } catch (error) {
    logError("backup failed", { requestId, error });
    throw error;
  } finally {
    end();
  }
}
