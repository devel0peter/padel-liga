// The hourly cron's order and failure isolation (#185, #188): the four step
// modules are replaced by stubs that log their calls, so each test can make
// one of them fail and see what the others still do.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { step: string; at: Date | undefined }[],
  fail: new Set<string>(),
  result: { "auto-accept": 0, stuck: 0, sent: 0 } as Record<string, number>,
}));

const step = (name: string, at: Date | undefined) => {
  h.calls.push({ step: name, at });
  if (h.fail.has(name)) throw new Error(`${name} broke`);
};

vi.mock("~/lib/results.server", () => ({
  autoAcceptResults: async (now?: Date) => (step("auto-accept", now), h.result["auto-accept"]),
}));
vi.mock("~/lib/match-reminders.server", () => ({
  runMatchReminders: async (now?: Date) => (step("match", now), null),
}));
vi.mock("~/lib/reminders.server", () => ({
  STUCK_QUERIES: 20,
  queueDueReminders: async (now?: Date) => (step("stuck", now), h.result.stuck),
}));
vi.mock("~/lib/notifications.server", () => ({
  // Pushes have no time of their own: they go out as soon as there is room.
  pushQueued: async () => (step("push", RUN), { pushed: h.result.pushed ?? 0, left: 0 }),
}));
vi.mock("~/lib/email/outbox.server", () => ({
  DELIVER_MIN: { queries: 5, calls: 3 },
  deliver: async (ids?: number[], now?: Date) => (step("deliver", ids ? undefined : now), { sent: h.result.sent }),
}));

const { runHourlyJob } = await import("~/lib/hourly-job.server");

// A scheduled time well before the test runs, so a step that read the clock
// itself would show.
const RUN = new Date("2026-11-10T06:00:00Z");
const ALL = ["auto-accept", "match", "stuck", "push", "deliver"];

let log: { mock: { calls: unknown[][] } };
let error: { mock: { calls: unknown[][] } };

beforeEach(() => {
  h.calls = [];
  h.fail = new Set();
  h.result = { "auto-accept": 0, stuck: 0, sent: 0 };
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const steps = () => h.calls.map((c) => c.step);
const errorLines = () => error.mock.calls.map((c) => String(c[0]));

describe("runHourlyJob", () => {
  it("runs the steps in order: auto-accept, match reminders, stuck reminders, pushes, email delivery", async () => {
    await runHourlyJob(RUN);
    expect(steps()).toEqual(ALL);
    expect(error).not.toHaveBeenCalled();
  });

  it("gives every step the run's scheduled time", async () => {
    await runHourlyJob(RUN);
    for (const c of h.calls) expect(c.at, c.step).toBe(RUN);
  });

  it("logs what each step did, and nothing when there was nothing to do", async () => {
    await runHourlyJob(RUN);
    expect(log).not.toHaveBeenCalled();
    h.result = { "auto-accept": 2, stuck: 3, pushed: 4, sent: 5 };
    await runHourlyJob(RUN);
    expect(log.mock.calls.map((c) => c[0])).toEqual(["cron: auto-accepted 2 results", "cron: queued 3 reminders", "cron: pushed 4 notifications", "cron: sent 5 emails"]);
  });

  it("still sends the reminders and the email when auto-accept fails, and logs it as auto-accept", async () => {
    h.fail.add("auto-accept");
    await runHourlyJob(RUN);
    expect(steps()).toEqual(ALL);
    expect(errorLines()).toEqual(["cron: auto-accept failed"]);
  });

  it("still queues the stuck reminders and sends the email when the match reminders fail (#185)", async () => {
    h.fail.add("match");
    h.result = { "auto-accept": 0, stuck: 3, sent: 4 };
    await runHourlyJob(RUN);
    expect(steps()).toEqual(ALL);
    expect(errorLines()).toEqual(["cron: match reminders failed"]);
    expect(log.mock.calls.map((c) => c[0])).toEqual(["cron: queued 3 reminders", "cron: sent 4 emails"]);
  });

  it("still sends the email after the match reminders when the stuck reminders fail (#185)", async () => {
    h.fail.add("stuck");
    await runHourlyJob(RUN);
    expect(steps()).toEqual(ALL);
    expect(errorLines()).toEqual(["cron: stuck reminders failed"]);
  });

  it("logs each failure under its own step when several fail", async () => {
    for (const s of ["auto-accept", "match", "stuck", "push", "deliver"]) h.fail.add(s);
    await expect(runHourlyJob(RUN)).resolves.toBeUndefined();
    expect(steps()).toEqual(ALL);
    expect(errorLines()).toEqual([
      "cron: auto-accept failed",
      "cron: match reminders failed",
      "cron: stuck reminders failed",
      "cron: push delivery failed",
      "cron: email delivery failed",
    ]);
  });

  it("starts a step only after the one before it has finished", async () => {
    const order: string[] = [];
    const slow = (name: string, ms: number) => ({
      name,
      run: async () => {
        order.push(`${name} start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${name} end`);
        return null;
      },
    });
    await runHourlyJob(RUN, [slow("a", 20), slow("b", 0)]);
    expect(order).toEqual(["a start", "a end", "b start", "b end"]);
  });
});
