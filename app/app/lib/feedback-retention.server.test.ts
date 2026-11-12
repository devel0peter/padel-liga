// feedback-retention.server.ts (#249) on a real SQLite with every migration
// applied (~/test/sqlite): the cron's daily deletion of feedback older than
// a year, once per Budapest day, in one query.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const R = await import("~/lib/feedback-retention.server");
const { RunBudget } = await import("~/lib/run-usage");

// 06:00 in Budapest on 12 November (UTC+1).
const NOW = new Date("2026-11-12T05:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysBefore = (n: number, from = NOW) => new Date(from.getTime() - n * DAY);
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

function addFeedback(id: number, at: Date, userId: string | null = null, kind = "bug") {
  h.raw
    .prepare("insert into feedback (id, kind, message, rating, page, device, browser, app_version, user_id, created_at) values (?, ?, 'Valami', ?, '/home', 'desktop', 'Chrome', 'abc', ?, ?)")
    .run(id, kind, kind === "rating" ? 4 : null, userId, sec(at));
}
const ids = () => h.raw.prepare("select id from feedback order by id").all().map((r: any) => r.id);
const run = (now = NOW, budget = new RunBudget()) => R.deleteOldFeedback(now, budget);

beforeEach(() => {
  h.raw = migratedDatabase();
  R.forgetRetentionDay();
  h.raw.prepare("insert into users (id, email, name, created_at) values ('u1', 'u1@example.test', 'Kiss Anna', ?)").run(sec(NOW));
});

describe("deleting feedback older than a year (#249)", () => {
  it("deletes a message 366 days old and keeps one 364 days old, of accounts and visitors alike", async () => {
    addFeedback(1, daysBefore(366), "u1");
    addFeedback(2, daysBefore(366), null, "rating");
    addFeedback(3, daysBefore(364), "u1");
    addFeedback(4, daysBefore(364));
    addFeedback(5, daysBefore(1), "u1");
    expect(await run()).toBe("deleted 2 feedback messages older than a year");
    expect(ids()).toEqual([3, 4, 5]);
  });

  it("deletes a message exactly a year old", async () => {
    addFeedback(1, new Date("2025-11-12T05:00:00Z"));
    addFeedback(2, new Date("2025-11-12T05:00:01Z"));
    await run();
    expect(ids()).toEqual([2]);
  });

  it("says nothing when there was nothing to delete, and remembers the day anyway", async () => {
    addFeedback(1, daysBefore(10));
    expect(await run()).toBeNull();
    expect(h.raw.prepare("select key, done_at from job_runs").all()).toEqual([{ key: R.RETENTION_KEY, done_at: sec(NOW) }]);
  });

  it("is one query, and none for the rest of the day in the same isolate", async () => {
    addFeedback(1, daysBefore(400));
    const first = new RunBudget();
    await run(NOW, first);
    expect(first.used().queries).toBe(R.RETENTION_QUERIES);
    const later = new RunBudget();
    expect(await run(new Date(NOW.getTime() + 10 * 60_000), later)).toBeNull();
    expect(later.used().queries).toBe(0);
  });

  it("runs once per Budapest day however many times the job runs, also in a fresh isolate", async () => {
    await run();
    // A message turns a year old later in the day: it waits for the next day.
    addFeedback(1, daysBefore(365, new Date("2026-11-12T20:00:00Z")));
    for (const at of ["2026-11-12T10:00:00Z", "2026-11-12T20:00:00Z", "2026-11-12T22:59:00Z"]) {
      R.forgetRetentionDay();
      expect(await run(new Date(at))).toBeNull();
    }
    expect(ids()).toEqual([1]);
    // 00:00 on 13 November in Budapest is 23:00 UTC on the 12th.
    R.forgetRetentionDay();
    expect(await run(new Date("2026-11-12T23:00:00Z"))).toBe("deleted 1 feedback messages older than a year");
    expect(ids()).toEqual([]);
  });

  it("leaves the work for the next run when the run has no query left", async () => {
    addFeedback(1, daysBefore(400));
    const full = new RunBudget({ queries: 0, calls: 0 });
    expect(await run(NOW, full)).toBe("feedback retention: no room in this run; left for the next one");
    expect(ids()).toEqual([1]);
    expect(h.raw.prepare("select count(*) as n from job_runs").get().n).toBe(0);
    expect(await run()).toBe("deleted 1 feedback messages older than a year");
  });
});
