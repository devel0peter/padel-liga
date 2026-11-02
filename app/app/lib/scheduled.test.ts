import { afterEach, describe, expect, it, vi } from "vitest";

import { BACKUP_CRON, EMAIL_CRON } from "./backup";
import { runScheduled } from "./scheduled";

function run(cron: string, backup = async () => ({ status: "done" }) as any, email = async () => ({ sent: 0 })) {
  const waited: Promise<unknown>[] = [];
  const jobs = { backup: vi.fn(backup), email: vi.fn(email) };
  runScheduled(cron, { waitUntil: (p) => void waited.push(p) }, jobs);
  return { jobs, done: Promise.all(waited) };
}

afterEach(() => vi.restoreAllMocks());

describe("runScheduled", () => {
  it("runs only the export on the export cron", async () => {
    const { jobs, done } = run(BACKUP_CRON);
    await done;
    expect(jobs.backup).toHaveBeenCalledTimes(1);
    expect(jobs.email).not.toHaveBeenCalled();
  });

  it("runs only the email job on the hourly cron", async () => {
    const { jobs, done } = run(EMAIL_CRON);
    await done;
    expect(jobs.email).toHaveBeenCalledTimes(1);
    expect(jobs.backup).not.toHaveBeenCalled();
  });

  it("logs a step and the finished file, stays quiet once the day's file exists", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(BACKUP_CRON, async () => ({ status: "done" }) as any).done;
    expect(log).not.toHaveBeenCalled();
    await run(BACKUP_CRON, async () => ({ status: "progress", parts: 2, table: "users", ops: 9 }) as any).done;
    expect(log).toHaveBeenCalledWith(expect.stringContaining("step done, 2 pieces"));
    await run(BACKUP_CRON, async () => ({ status: "finished", key: "daily/x.sql", bytes: 5, parts: 2, deleted: 0, ops: 7 }) as any).done;
    expect(log).toHaveBeenCalledWith(expect.stringContaining("daily/x.sql"));
  });

  it("lets a failed export reach the runtime, so the cron run shows as failed", async () => {
    const { done } = run(BACKUP_CRON, async () => {
      throw new Error("R2 down");
    });
    await expect(done).rejects.toThrow("R2 down");
  });
});
