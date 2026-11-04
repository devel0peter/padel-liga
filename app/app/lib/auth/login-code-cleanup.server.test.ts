// Stale login code records are deleted by the cron (#168): the real cron step
// and the real login code functions on a real SQLite with every migration
// applied (~/test/sqlite). The login code email is stubbed, nothing leaves
// the process. Queries are counted with the Worker's own counters.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, codes: [] as { to: string; code: string }[] }));

vi.mock("cloudflare:workers", () => ({ env: { EMAIL_DAILY_LIMIT: "5000", EMAIL_SECRET: "test-secret" } }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
// No mail is sent here; the sender is replaced so nothing could leave.
vi.mock("~/lib/email/send.server", () => ({
  MAX_BATCH: 100,
  relayConfigured: () => false,
  sendEmails: async () => {
    throw new Error("no mail in this test");
  },
}));
vi.mock("~/lib/email/outbox.server", async (original) => ({
  ...(await original<typeof import("~/lib/email/outbox.server")>()),
  queueLoginCode: async (to: string, code: string) => void h.codes.push({ to, code }),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { RunBudget, RUN_LIMITS } = await import("~/lib/run-usage");
const { HOURLY_STEPS, runHourlyJob } = await import("~/lib/hourly-job.server");
const L = await import("~/lib/auth/login-code.server");

const MIN = 60 * 1000;
const T0 = new Date("2026-11-10T08:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const CLEANUP = HOURLY_STEPS.filter((s) => s.name === "login code cleanup");

const emails = () => h.raw.prepare("select email from login_codes order by email").all().map((r: { email: string }) => r.email);
const count = () => h.raw.prepare("select count(*) as n from login_codes").get().n as number;
const insert = (email: string, expiresAt: Date, windowStart: Date) =>
  h.raw
    .prepare("insert into login_codes (email, code_hash, expires_at, window_start, sent_in_window) values (?, 'h', ?, ?, 5)")
    .run(email, sec(expiresAt), sec(windowStart));

type Line = { level: string; event: string; step?: string; result?: string; queries?: number };
let lines: Line[] = [];

// One scheduled run of the real job with only this step, at `now`: the
// queries it made, measured as the Worker measures them.
async function cronRun(now: Date): Promise<number> {
  vi.setSystemTime(now);
  const budget = new RunBudget();
  await runHourlyJob(now, CLEANUP);
  return budget.used().queries;
}

beforeEach(() => {
  h.raw = migratedDatabase();
  h.codes = [];
  lines = [];
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation((line: Line) => void lines.push(line));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("login code cleanup (#168)", () => {
  it("is a cron step, the first one", () => {
    expect(HOURLY_STEPS[0].name).toBe("login code cleanup");
  });

  it("deletes a record whose code expired over an hour ago and whose window ended, at the next run", async () => {
    // Window from 06:00, last code at 06:50 (expired 07:00).
    insert("regi@example.test", at(-60), at(-120));
    insert("nagyon.regi@example.test", at(-3 * 24 * 60), at(-3 * 24 * 60 - 10));
    await cronRun(T0);
    expect(emails()).toEqual([]);
    expect(lines.filter((l) => l.event === "cron step").map((l) => l.result)).toEqual(["deleted 2 stale login codes"]);
  });

  it("keeps a still valid code, a code expired under an hour ago, and a record inside its hourly window", async () => {
    insert("ervenyes@example.test", at(5), at(-90));
    insert("frissen.lejart@example.test", at(-50), at(-120));
    insert("ablakban@example.test", at(-70), at(-59));
    insert("regi@example.test", at(-61), at(-120));
    await cronRun(T0);
    expect(emails()).toEqual(["ablakban@example.test", "ervenyes@example.test", "frissen.lejart@example.test"]);
  });

  it("logs nothing when there is nothing to delete", async () => {
    insert("ervenyes@example.test", at(5), at(-5));
    expect(await cronRun(T0)).toBe(1);
    expect(lines.filter((l) => l.event === "cron step")).toEqual([]);
  });

  it("a code asked for keeps working through the runs, and its record goes an hour after it expires", async () => {
    await L.sendLoginCode("jatekos@example.test");
    await cronRun(at(5));
    expect(emails()).toEqual(["jatekos@example.test"]);
    vi.setSystemTime(at(6));
    expect(await L.verifyLoginCode("jatekos@example.test", h.codes[0].code)).toMatchObject({ ok: true });

    await L.sendLoginCode("masik@example.test");
    await cronRun(at(6 + 10 + 59));
    expect(emails()).toEqual(["masik@example.test"]);
    vi.setSystemTime(at(6 + 10 + 59));
    expect(await L.verifyLoginCode("masik@example.test", h.codes[1].code)).toEqual({ ok: false, error: "Ez a kód lejárt. Kérj újat." });
    await cronRun(at(6 + 10 + 60));
    expect(emails()).toEqual([]);
  });

  it("keeps the hourly code limit and the tries per code across runs", async () => {
    const email = "sok@example.test";
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(at(i * 10));
      expect(await L.sendLoginCode(email)).toMatchObject({ ok: true });
      await cronRun(at(i * 10 + 1));
    }
    // 6th code within the hour (the window started at T0), after a run at :55
    // when every code but the last had expired: still refused.
    await cronRun(at(55));
    vi.setSystemTime(at(55));
    expect(await L.sendLoginCode(email)).toEqual({ ok: false, error: "Túl sok kódot kértél. Próbáld újra egy óra múlva." });

    // Five wrong tries lock the valid code; a run in between changes nothing.
    vi.setSystemTime(at(41));
    for (let i = 0; i < 5; i++) {
      await L.verifyLoginCode(email, "000000");
      await cronRun(at(41));
    }
    expect(await L.verifyLoginCode(email, h.codes[4].code)).toMatchObject({ ok: false, error: "Túl sok hibás próbálkozás. Kérj új kódot." });
  });

  it("with 10,000 stale records stays within the run's query limit and leaves the rest for later runs", async () => {
    h.raw
      .prepare(
        `insert into login_codes (email, code_hash, expires_at, window_start)
         with recursive n(i) as (select 1 union all select i + 1 from n where i < 10000)
         select 'regi' || i || '@example.test', 'h', ?, ? from n`,
      )
      .run(sec(at(-24 * 60)), sec(at(-25 * 60)));
    insert("ervenyes@example.test", at(5), at(-5));

    const first = await cronRun(T0);
    expect(first).toBeLessThanOrEqual(RUN_LIMITS.queries);
    expect(first).toBe(1);
    expect(count()).toBe(10_001 - L.STALE_CODE_BATCH);
    const deferred = lines.filter((l) => l.event === "cron step");
    expect(deferred).toEqual([
      expect.objectContaining({ level: "warn", result: `deleted ${L.STALE_CODE_BATCH} stale login codes; any more left for the next run` }),
    ]);

    let runs = 1;
    while (count() > 1) {
      expect(await cronRun(at(10 * runs))).toBe(1);
      runs++;
    }
    expect(runs).toBe(10_000 / L.STALE_CODE_BATCH);
    expect(emails()).toEqual(["ervenyes@example.test"]);
  });

  it("leaves the run alone when there is no room for its one query", async () => {
    insert("regi@example.test", at(-60), at(-120));
    const step = CLEANUP[0];
    expect(await step.run(T0, new RunBudget({ queries: 0, calls: 50 }))).toBe("login code cleanup: no room in this run; left for the next one");
    expect(emails()).toEqual(["regi@example.test"]);
  });
});
