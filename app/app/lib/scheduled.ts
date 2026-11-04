import { cronJob } from "./backup";
import type { StepResult } from "./backup.server";

// What workers/app.ts does for a cron trigger, apart from the Worker's own
// imports so a test can run it with stand-ins for the two jobs.
export type Jobs = {
  backup: () => Promise<StepResult>;
  hourly: (now: Date) => Promise<void>;
};

type Controller = { cron: string; scheduledTime: number };

export function runScheduled(controller: Controller, ctx: { waitUntil(promise: Promise<unknown>): void }, jobs: Jobs): void {
  if (cronJob(controller.cron) === "backup") {
    // Not caught: a failed export shows as a failed cron run in the logs.
    ctx.waitUntil(
      jobs.backup().then((r) => {
        // "done" is every run after the day's file exists: stay quiet.
        if (r.status === "progress") console.log(`backup: step done, ${r.parts} pieces, ${r.ops} calls`);
        if (r.status === "finished") console.log(`backup: ${r.key}, ${r.bytes} bytes from ${r.parts} pieces, ${r.deleted} old files deleted, ${r.ops} calls`);
      }),
    );
    return;
  }
  ctx.waitUntil(jobs.hourly(new Date(controller.scheduledTime)));
}
