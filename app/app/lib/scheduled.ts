import { ceilingPercent, cronJob, nearCeiling } from "./backup";
import type { StepResult } from "./backup.server";
import { beginInvocation, logError, logInfo, logWarn } from "./log";

// What workers/app.ts does for a cron trigger, apart from the Worker's own
// imports so a test can run it with stand-ins for the two jobs.
export type Jobs = {
  backup: () => Promise<StepResult>;
  // The 10-minute cron steps (runCron in lib/hourly-job.server.ts).
  steps: (now: Date) => Promise<void>;
};

type Controller = { cron: string; scheduledTime: number };

export function runScheduled(controller: Controller, ctx: { waitUntil(promise: Promise<unknown>): void }, jobs: Jobs): void {
  if (cronJob(controller.cron) === "backup") {
    ctx.waitUntil(runBackup(jobs.backup));
    return;
  }
  ctx.waitUntil(jobs.steps(new Date(controller.scheduledTime)));
}

// One export step and its log line (#227): a line while it works and when the
// day's file is written; every run after that ("done") stays quiet. The
// finished line says how much of the size ceiling the file used, and past
// 75% a warning follows (#282; README "Backups"). A failed step logs an error
// and still fails, so the cron run shows as failed too.
async function runBackup(backup: Jobs["backup"]): Promise<void> {
  const requestId = `backup-${crypto.randomUUID()}`;
  const end = beginInvocation(requestId, "cron");
  try {
    const r = await backup();
    if (r.status === "progress") logInfo("backup step", { requestId, pieces: r.parts, table: r.table, calls: r.ops });
    if (r.status === "finished") {
      const ceiling = { pieces: r.parts, maxPieces: r.maxParts, ceilingPercent: ceilingPercent(r.parts, r.maxParts) };
      logInfo("backup finished", { requestId, file: r.key, bytes: r.bytes, ...ceiling, deletedFiles: r.deleted, calls: r.ops });
      if (nearCeiling(r.parts, r.maxParts)) logWarn("backup near size ceiling", { requestId, bytes: r.bytes, ...ceiling });
    }
  } catch (error) {
    logError("backup failed", { requestId, error });
    throw error;
  } finally {
    end();
  }
}
