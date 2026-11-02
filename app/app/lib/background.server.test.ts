// runAfterResponse (#140) hands the work to the Worker's waitUntil, so the
// response doesn't wait for it, and a failure is logged instead of thrown.
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ handed: [] as Promise<unknown>[] }));
vi.mock("cloudflare:workers", () => ({ waitUntil: (p: Promise<unknown>) => h.handed.push(p) }));

const { runAfterResponse } = await import("./background.server");

describe("runAfterResponse", () => {
  it("starts the task and hands it to waitUntil without waiting for it", async () => {
    let finish!: () => void;
    let done = false;
    runAfterResponse("test", () => new Promise<void>((r) => (finish = r)).then(() => (done = true)));
    expect(h.handed).toHaveLength(1);
    expect(done).toBe(false);
    finish();
    await h.handed[0];
    expect(done).toBe(true);
  });

  it("logs a failure instead of rejecting", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    h.handed = [];
    runAfterResponse("bulk send", async () => {
      throw new Error("relay down");
    });
    await expect(h.handed[0]).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("bulk send failed", expect.any(Error));
    error.mockRestore();
  });
});
