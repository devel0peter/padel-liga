import { afterEach, describe, expect, it, vi } from "vitest";

import { CHECK_EVENT, TIMEOUT_MS, USER_AGENT, checkHealth, checkLine, writeLine, type Fetch } from "./check";
import worker, { runCheck } from "./index";

const URL = "https://padelparbaj.hu/health";

const answer = (body: string | ReadableStream, status = 200, headers: Record<string, string> = {}): Fetch =>
  async () => new Response(body, { status, headers });

// A fetch that never answers, like a hung server; it only gives up when aborted.
const neverAnswers: Fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  });

describe("checkHealth", () => {
  it("succeeds on 200 with the body ok", async () => {
    const result = await checkHealth(URL, { fetch: answer("ok") });
    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  it("fails on 503 with the status as the reason", async () => {
    const result = await checkHealth(URL, { fetch: answer("unavailable", 503) });
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 503, reason: "status 503" }));
  });

  it("fails on 200 with another body", async () => {
    const result = await checkHealth(URL, { fetch: answer("<html>Bejelentkezés</html>") });
    expect(result).toMatchObject({ ok: false, status: 200, reason: "unexpected body (26 characters)" });
  });

  it("fails on a Cloudflare challenge", async () => {
    const result = await checkHealth(URL, { fetch: answer("<html>Just a moment...</html>", 403, { "cf-mitigated": "challenge" }) });
    expect(result).toMatchObject({ ok: false, status: 403, reason: "challenged by Cloudflare (status 403)" });
  });

  it("fails on a redirect instead of following it", async () => {
    const calls: RequestInit[] = [];
    const fetch: Fetch = async (_url, init) => {
      calls.push(init);
      return new Response(null, { status: 301, headers: { location: "https://padelparbaj.hu/login" } });
    };
    const result = await checkHealth(URL, { fetch });
    expect(result).toMatchObject({ ok: false, status: 301, reason: "status 301" });
    expect(calls[0]?.redirect).toBe("manual");
  });

  it("fails when the address never answers, after the time limit", async () => {
    const result = await checkHealth(URL, { fetch: neverAnswers, timeoutMs: 20 });
    expect(result).toMatchObject({ ok: false, reason: "no answer in 20 ms" });
    expect(result.ok || result.status).toBeFalsy();
  });

  it("fails when the headers come but the body never ends", async () => {
    const stalled = new ReadableStream<Uint8Array>({ start: () => {} });
    const result = await checkHealth(URL, { fetch: answer(stalled), timeoutMs: 20 });
    expect(result).toMatchObject({ ok: false, reason: "no answer in 20 ms" });
  });

  it("aborts the request at the time limit", async () => {
    let signal: AbortSignal | undefined;
    const fetch: Fetch = (url, init) => {
      signal = init.signal ?? undefined;
      return neverAnswers(url, init);
    };
    await checkHealth(URL, { fetch, timeoutMs: 20 });
    expect(signal?.aborted).toBe(true);
  });

  it("fails on a network error with its message", async () => {
    const fetch: Fetch = async () => {
      throw new TypeError("Network connection lost.");
    };
    const result = await checkHealth(URL, { fetch });
    expect(result).toMatchObject({ ok: false, reason: "network error: Network connection lost." });
  });

  it("measures the time taken", async () => {
    const times = [1000, 1234];
    const result = await checkHealth(URL, { fetch: answer("ok"), now: () => times.shift() ?? 1234 });
    expect(result.ms).toBe(234);
  });

  it("names itself and asks for a fresh answer", async () => {
    let headers: HeadersInit | undefined;
    await checkHealth(URL, {
      fetch: async (_url, init) => {
        headers = init.headers;
        return new Response("ok");
      },
    });
    expect(headers).toMatchObject({ "user-agent": USER_AGENT, "cache-control": "no-cache" });
    expect(USER_AGENT).toMatch(/^padelparbaj-watchdog\//);
  });

  it("waits at most 10 seconds by default", () => {
    expect(TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("checkLine", () => {
  const at = new Date("2026-11-12T20:00:00.000Z");

  it("is an info line on success", () => {
    expect(checkLine(URL, { ok: true, status: 200, ms: 87 }, at)).toEqual({
      level: "info",
      event: CHECK_EVENT,
      time: "2026-11-12T20:00:00.000Z",
      url: URL,
      ok: true,
      status: 200,
      ms: 87,
    });
  });

  it("is an error line with the reason on failure", () => {
    expect(checkLine(URL, { ok: false, status: 503, ms: 3010, reason: "status 503" }, at)).toEqual({
      level: "error",
      event: CHECK_EVENT,
      time: "2026-11-12T20:00:00.000Z",
      url: URL,
      ok: false,
      status: 503,
      ms: 3010,
      reason: "status 503",
    });
  });

  it("leaves the status out when there was no answer", () => {
    const line = checkLine(URL, { ok: false, ms: 10_000, reason: "no answer in 10000 ms" }, at);
    expect(line).not.toHaveProperty("status");
    expect(line.reason).toBe("no answer in 10000 ms");
  });
});

describe("writeLine", () => {
  it("writes a failure with console.error and a success with console.log", () => {
    const out = { log: vi.fn(), error: vi.fn() };
    const failed = checkLine(URL, { ok: false, ms: 5, reason: "status 500", status: 500 });
    const passed = checkLine(URL, { ok: true, ms: 5, status: 200 });
    writeLine(failed, out);
    writeLine(passed, out);
    expect(out.error).toHaveBeenCalledWith(failed);
    expect(out.log).toHaveBeenCalledWith(passed);
  });
});

describe("the scheduled run", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("checks the configured address and writes one line", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await worker.scheduled({} as ScheduledController, { HEALTH_URL: URL } as Env);

    expect(fetch).toHaveBeenCalledWith(URL, expect.objectContaining({ method: "GET" }));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toMatchObject({ event: CHECK_EVENT, level: "info", ok: true, status: 200 });
    expect(error).not.toHaveBeenCalled();
  });

  it("writes an error line when the site is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await runCheck(URL);

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatchObject({ level: "error", ok: false, status: 503, reason: "status 503" });
  });
});
