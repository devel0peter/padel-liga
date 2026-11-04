// The request line and the unexpected-error line (#227): the Worker's fetch
// (workers/app.ts) writes one `request` line per request, with the request
// id it also hands to the app; React Router's handleError (entry.server.tsx)
// writes one `unhandled error` line with the stack. The app itself is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Line = Record<string, any>;

const h = vi.hoisted(() => ({
  seen: null as Request | null,
  respond: (async () => new Response("hi", { status: 200 })) as (request: Request) => Promise<Response>,
}));

vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  createRequestHandler: () => async (request: Request) => {
    h.seen = request;
    return h.respond(request);
  },
}));
vi.mock("./lib/hourly-job.server", () => ({ runHourlyJob: async () => {} }));

const worker = (await import("../workers/app")).default;
const { handleError } = await import("./entry.server");
const { noteAccount, REQUEST_ID_HEADER } = await import("./lib/log");

const ACCOUNT = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
let lines: Line[] = [];

beforeEach(() => {
  lines = [];
  h.seen = null;
  h.respond = async () => new Response("hi", { status: 200 });
  for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation((line: Line) => void lines.push(line));
});
afterEach(() => vi.restoreAllMocks());

const fetchVia = (request: Request) => worker.fetch(request as Parameters<typeof worker.fetch>[0]);

describe("the request line", () => {
  it("writes one line: Ray ID, method, path without query or token, status, duration", async () => {
    const res = await fetchVia(
      new Request("https://padelparbaj.hu/pair/join/AbCdEfGh12345678IjKlMnOp?email=a%40b.hu", { headers: { "cf-ray": "8f1a2b3c4d5e6f70-PRG" } }),
    );
    expect(res.status).toBe(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      event: "request",
      requestId: "8f1a2b3c4d5e6f70-PRG",
      method: "GET",
      path: "/pair/join/[token]",
      status: 200,
    });
    expect(typeof lines[0].ms).toBe("number");
    expect(lines[0].userId).toBeUndefined();
    expect(JSON.stringify(lines)).not.toContain("a@b.hu");
  });

  it("hands the request id to the app and names the logged-in account by id", async () => {
    h.respond = async (request) => {
      noteAccount(request, ACCOUNT);
      return new Response(null, { status: 204 });
    };
    await fetchVia(new Request("https://padelparbaj.hu/home", { headers: { "cf-ray": "ray-1" } }));
    expect(h.seen?.headers.get(REQUEST_ID_HEADER)).toBe("ray-1");
    expect(lines[0]).toMatchObject({ event: "request", requestId: "ray-1", status: 204, userId: ACCOUNT });
  });

  it("makes up a request id where there is no Ray ID (local runs)", async () => {
    await fetchVia(new Request("http://localhost/health"));
    expect(lines[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.seen?.headers.get(REQUEST_ID_HEADER)).toBe(lines[0].requestId);
  });

  it("logs a request the app throws on as failed, with the error, and throws it on", async () => {
    h.respond = async () => {
      throw new Error("boom");
    };
    await expect(fetchVia(new Request("https://padelparbaj.hu/home", { headers: { "cf-ray": "ray-2" } }))).rejects.toThrow("boom");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", event: "request failed", requestId: "ray-2", status: 500, error: { message: "boom" } });
  });
});

describe("handleError", () => {
  const request = (signal?: AbortSignal) =>
    new Request("https://padelparbaj.hu/profile?x=1", { headers: { [REQUEST_ID_HEADER]: "ray-3" }, signal });

  it("logs an unexpected error once, with the request id and the stack", () => {
    handleError(new Error("loader broke"), { request: request(), params: {}, context: {} as any });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", event: "unhandled error", requestId: "ray-3", path: "/profile", error: { message: "loader broke" } });
    expect(lines[0].error.stack).toContain("request-log.test.ts");
  });

  it("logs nothing for a request the browser gave up on", () => {
    const aborted = new AbortController();
    aborted.abort();
    handleError(new Error("aborted"), { request: request(aborted.signal), params: {}, context: {} as any });
    expect(lines).toHaveLength(0);
  });
});
