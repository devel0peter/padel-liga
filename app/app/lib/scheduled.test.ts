import { afterEach, describe, expect, it, vi } from "vitest";

import { BACKUP_CRON, STEPS_CRON } from "./backup";
import { runScheduled } from "./scheduled";

const AT = Date.UTC(2026, 10, 5, 3, 10);

function run(cron: string, backup = async () => ({ status: "done" }) as any, steps = async (_now: Date) => {}) {
  const waited: Promise<unknown>[] = [];
  const jobs = { backup: vi.fn(backup), steps: vi.fn(steps) };
  runScheduled({ cron, scheduledTime: AT }, { waitUntil: (p) => void waited.push(p) }, jobs);
  return { jobs, done: Promise.all(waited) };
}

afterEach(() => vi.restoreAllMocks());

describe("runScheduled", () => {
  it("runs only the export on the export cron", async () => {
    const { jobs, done } = run(BACKUP_CRON);
    await done;
    expect(jobs.backup).toHaveBeenCalledTimes(1);
    expect(jobs.steps).not.toHaveBeenCalled();
  });

  it("runs only the 10-minute job on its cron, from the scheduled time", async () => {
    const { jobs, done } = run(STEPS_CRON);
    await done;
    expect(jobs.steps).toHaveBeenCalledTimes(1);
    expect(jobs.steps).toHaveBeenCalledWith(new Date(AT));
    expect(jobs.backup).not.toHaveBeenCalled();
  });

  it("logs a step and the finished file, stays quiet once the day's file exists", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(BACKUP_CRON, async () => ({ status: "done" }) as any).done;
    expect(log).not.toHaveBeenCalled();
    await run(BACKUP_CRON, async () => ({ status: "progress", parts: 2, table: "users", ops: 9 }) as any).done;
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ level: "info", event: "backup step", pieces: 2, table: "users", calls: 9 }));
    await run(BACKUP_CRON, async () => ({ status: "finished", key: "daily/x.sql", bytes: 5, parts: 2, maxParts: 33, deleted: 0, ops: 7 }) as any).done;
    expect(log).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: "backup finished", file: "daily/x.sql", bytes: 5, pieces: 2, maxPieces: 33, ceilingPercent: 6, deletedFiles: 0 }),
    );
    // Both lines carry the run's own request id.
    expect(log.mock.calls.map((c) => (c[0] as { requestId: string }).requestId)).toEqual([
      expect.stringMatching(/^backup-/),
      expect.stringMatching(/^backup-/),
    ]);
  });

  it("warns once a finished export is past 75% of the size ceiling, and not below it (#282)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const finished = (parts: number) => async () => ({ status: "finished", key: "daily/x.sql", bytes: parts * 400_000, parts, maxParts: 33, deleted: 0, ops: 7 }) as any;
    // 24 of 33 pieces: 73%.
    await run(BACKUP_CRON, finished(24)).done;
    expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ event: "backup finished", pieces: 24, maxPieces: 33, ceilingPercent: 73 }));
    expect(warn).not.toHaveBeenCalled();
    // 25 of 33: 76%.
    await run(BACKUP_CRON, finished(25)).done;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warn", event: "backup near size ceiling", pieces: 25, maxPieces: 33, ceilingPercent: 76, bytes: 10_000_000 }),
    );
  });

  it("logs a failed export as an error and lets it reach the runtime, so the cron run shows as failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { done } = run(BACKUP_CRON, async () => {
      throw new Error("R2 down");
    });
    await expect(done).rejects.toThrow("R2 down");
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", event: "backup failed", error: expect.objectContaining({ message: "R2 down" }) }),
    );
  });
});
