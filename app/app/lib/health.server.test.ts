// GET /health (#228): "ok" when the database answers, 503 when it fails or
// doesn't answer in time; never cached, nothing private in the answer. The
// database is the real SQLite test helper; the failing cases stub the check.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { healthResponse, HEALTH_TIMEOUT_MS } = await import("~/lib/health.server");
const { RunBudget } = await import("~/lib/run-usage");
const route = await import("~/routes/health");

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.raw = migratedDatabase();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function expectNotCachedPlainText(res: Response) {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
}

describe("GET /health", () => {
  it("answers ok with 200 when the database answers, with one query", async () => {
    const budget = new RunBudget();
    const res = await route.loader();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    await expectNotCachedPlainText(res);
    expect(budget.used().queries).toBe(1);
  });

  it("doesn't count as a visit on the traffic page", async () => {
    await route.loader();
    await route.loader();
    expect(h.raw.prepare("select count(*) as n from landing_views").get().n).toBe(0);
  });

  it("answers 503 when the database fails, and logs a warning", async () => {
    const res = await healthResponse(async () => {
      throw new Error("D1_ERROR: database unavailable");
    });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("unavailable");
    await expectNotCachedPlainText(res);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "health check failed" }));
  });

  it("answers 503 within the time limit when the database doesn't answer", async () => {
    vi.useFakeTimers();
    const pending = healthResponse(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(HEALTH_TIMEOUT_MS).toBeLessThan(5000);
  });

  it("says nothing but ok or unavailable", async () => {
    for (const res of [await healthResponse(async () => 1), await healthResponse(async () => Promise.reject(new Error("x")))])
      expect(["ok", "unavailable"]).toContain(await res.text());
  });
});
