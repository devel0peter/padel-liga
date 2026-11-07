// The cron's order and failure isolation (#185, #188): the step
// modules are replaced by stubs that log their calls, so each test can make
// one of them fail and see what the others still do.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { step: string; at: Date | undefined }[],
  fail: new Set<string>(),
  result: { "auto-accept": 0, stuck: 0, sent: 0 } as Record<string, any>,
}));

const step = (name: string, at: Date | undefined) => {
  h.calls.push({ step: name, at });
  if (h.fail.has(name)) throw new Error(`${name} broke`);
};

vi.mock("~/lib/auth/login-code.server", () => ({
  STALE_CODE_BATCH: 1000,
  deleteStaleLoginCodes: async (now?: Date) => (step("cleanup", now), h.result.cleanup ?? 0),
}));
vi.mock("~/lib/results.server", () => ({
  autoAcceptResults: async (now?: Date) => (step("auto-accept", now), h.result["auto-accept"]),
}));
vi.mock("~/lib/deadline.server", () => ({
  resolveDeadlines: async (now?: Date) => (step("deadline", now), { resolved: h.result.deadline ?? 0, left: false }),
}));
vi.mock("~/lib/round-switch.server", () => ({
  draftRoundSwitches: async (now?: Date) => (step("round draft", now), h.result["round draft"] ?? null),
}));
vi.mock("~/lib/match-reminders.server", () => ({
  runMatchReminders: async (now?: Date) => (step("match", now), null),
}));
vi.mock("~/lib/reminders.server", () => ({
  STUCK_QUERIES: 20,
  queueDueReminders: async (now?: Date) => (step("stuck", now), h.result.stuck),
}));
vi.mock("~/lib/interest-list-purge.server", () => ({
  PURGE_MIN: { queries: 3, calls: 0 },
  purgeInterestList: async (now?: Date) => (step("interest list", now), h.result["interest list"] ?? null),
}));
vi.mock("~/lib/notifications.server", () => ({
  // Pushes have no time of their own: they go out as soon as there is room.
  pushQueued: async () => (step("push", RUN), { pushed: h.result.pushed ?? 0, left: 0 }),
}));
vi.mock("~/lib/email/outbox.server", () => ({
  DELIVER_MIN: { queries: 5, calls: 3 },
  deliver: async (ids?: number[], now?: Date) => (step("deliver", ids ? undefined : now), { sent: h.result.sent }),
}));

vi.mock("~/lib/push-stats.server", () => ({
  PUSH_STATS_QUERIES: 1,
  recordPushStats: async (now?: Date) => step("push stats", now),
}));

const { runCron } = await import("~/lib/hourly-job.server");

// A scheduled time well before the test runs, so a step that read the clock
// itself would show.
const RUN = new Date("2026-11-10T06:00:00Z");
const ALL = ["cleanup", "auto-accept", "deadline", "round draft", "match", "stuck", "interest list", "push", "deliver", "push stats"];

type Line = { level: string; event: string; requestId?: string; step?: string; result?: string; error?: { message: string } };
let lines: Line[] = [];

beforeEach(() => {
  h.calls = [];
  h.fail = new Set();
  h.result = { "auto-accept": 0, stuck: 0, sent: 0 };
  lines = [];
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation((line: Line) => void lines.push(line));
});
afterEach(() => vi.restoreAllMocks());

const steps = () => h.calls.map((c) => c.step);
const errorLines = () => lines.filter((l) => l.level === "error").map((l) => `${l.event}: ${l.step}`);
const stepResults = () => lines.filter((l) => l.event === "cron step").map((l) => l.result);

describe("runCron", () => {
  it("runs the steps in order: login code cleanup, auto-accept, deadline resolution, round switch draft, match reminders, stuck reminders, interest list deletion, pushes, email delivery, push stats", async () => {
    await runCron(RUN);
    expect(steps()).toEqual(ALL);
    expect(errorLines()).toEqual([]);
  });

  it("gives every step the run's scheduled time", async () => {
    await runCron(RUN);
    for (const c of h.calls) expect(c.at, c.step).toBe(RUN);
  });

  it("logs what each step did, and nothing when there was nothing to do", async () => {
    await runCron(RUN);
    expect(stepResults()).toEqual([]);
    h.result = {
      cleanup: 1,
      "auto-accept": 2,
      deadline: 6,
      "round draft": "drafted phase 2 of season 1",
      stuck: 3,
      "interest list": "interest list deletion finished: deleted 0 signups, 1 emails, 0 reminder records",
      pushed: 4,
      sent: 5,
    };
    await runCron(RUN);
    expect(stepResults()).toEqual([
      "deleted 1 stale login codes",
      "auto-accepted 2 results",
      "resolved 6 matches at the deadline",
      "drafted phase 2 of season 1",
      "queued 3 reminders",
      "interest list deletion finished: deleted 0 signups, 1 emails, 0 reminder records",
      "pushed 4 notifications",
      "sent 5 emails",
    ]);
  });

  it("still pushes and sends the email when the interest list deletion fails (#334)", async () => {
    h.fail.add("interest list");
    h.result = { "auto-accept": 0, stuck: 0, sent: 2 };
    await runCron(RUN);
    expect(steps()).toEqual(ALL);
    expect(errorLines()).toEqual(["cron step failed: interest list deletion"]);
    expect(stepResults()).toEqual(["sent 2 emails"]);
  });

  it("runs every other step when the login code cleanup fails (#168)", async () => {
    h.fail.add("cleanup");
    h.result = { "auto-accept": 2, stuck: 0, sent: 1 };
    await runCron(RUN);
    expect(steps()).toEqual(ALL);
    expect(errorLines()).toEqual(["cron step failed: login code cleanup"]);
    expect(stepResults()).toEqual(["auto-accepted 2 results", "sent 1 emails"]);
  });

  it("still sends the reminders and the email when auto-accept fails, and logs it as auto-accept", async () => {
    h.fail.add("auto-accept");
    await runCron(RUN);
    expect(steps()).toEqual(ALL);
    expect(errorLines()).toEqual(["cron step failed: auto-accept"]);
  });

  it("still queues the stuck reminders and sends the email when the match reminders fail (#185)", async () => {
    h.fail.add("match");
    h.result = { "auto-accept": 0, stuck: 3, sent: 4 };
    await runCron(RUN);
    expect(steps()).toEqual(ALL);
    expect(errorLines()).toEqual(["cron step failed: match reminders"]);
    expect(stepResults()).toEqual(["queued 3 reminders", "sent 4 emails"]);
  });

  it("still sends the email after the match reminders when the stuck reminders fail (#185)", async () => {
    h.fail.add("stuck");
    await runCron(RUN);
    expect(steps()).toEqual(ALL);
    expect(errorLines()).toEqual(["cron step failed: stuck reminders"]);
  });

  it("logs each failure under its own step when several fail", async () => {
    for (const s of ALL) h.fail.add(s);
    await expect(runCron(RUN)).resolves.toBeUndefined();
    expect(steps()).toEqual(ALL);
    expect(errorLines()).toEqual([
      "cron step failed: login code cleanup",
      "cron step failed: auto-accept",
      "cron step failed: deadline resolution",
      "cron step failed: round switch draft",
      "cron step failed: match reminders",
      "cron step failed: stuck reminders",
      "cron step failed: interest list deletion",
      "cron step failed: push delivery",
      "cron step failed: email delivery",
      "cron step failed: push stats",
    ]);
  });

  it("still writes the push stats when the email delivery fails", async () => {
    h.fail.add("deliver");
    await runCron(RUN);
    expect(steps()).toEqual(ALL);
    expect(errorLines()).toEqual(["cron step failed: email delivery"]);
  });

  it("logs a start and a finish line, and every line of the run carries the same request id (#227)", async () => {
    h.fail.add("stuck");
    h.result = { "auto-accept": 1, stuck: 0, sent: 2 };
    await runCron(RUN);
    const events = lines.map((l) => l.event);
    expect(events[0]).toBe("cron start");
    expect(events.at(-1)).toBe("cron finish");
    const ids = new Set(lines.map((l) => l.requestId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^cron-/);
    expect(lines.find((l) => l.level === "error")?.error?.message).toBe("stuck broke");
  });

  it("logs work left for the next run as a warning (#227)", async () => {
    const left = { name: "late", run: async () => "sent 3 emails; 4 left for the next run (run limits)" };
    await runCron(RUN, [left]);
    expect(lines.find((l) => l.event === "cron step")?.level).toBe("warn");
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
    await runCron(RUN, [slow("a", 20), slow("b", 0)]);
    expect(order).toEqual(["a start", "a end", "b start", "b end"]);
  });
});
