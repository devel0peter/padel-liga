// `npm run logs:read` (#227): arguments, the query sent, the lines printed.
import { describe, expect, it } from "vitest";

import { formatEvents, parseLogArgs, queryBody, WORKER, type LogQuery } from "./log-query";

const NOW = Date.UTC(2026, 10, 4, 18, 0, 0);

describe("parseLogArgs", () => {
  it("defaults to the last hour, 100 events", () => {
    expect(parseLogArgs([])).toEqual({ sinceMs: 3_600_000, limit: 100, json: false });
  });

  it("reads every option", () => {
    expect(
      parseLogArgs(["--since", "3d", "--level", "error", "--event", "cron step failed", "--request", "r1", "--user", "u1", "--search", "smtp", "--limit", "20", "--json"]),
    ).toEqual({
      sinceMs: 3 * 86_400_000,
      level: "error",
      event: "cron step failed",
      requestId: "r1",
      userId: "u1",
      search: "smtp",
      limit: 20,
      json: true,
    });
  });

  it("refuses what it doesn't know", () => {
    for (const args of [["--since", "1w"], ["--since", "8d"], ["--level", "debug"], ["--limit", "0"], ["--limit", "5000"], ["--delete", "x"], ["--event"]])
      expect(parseLogArgs(args), args.join(" ")).toHaveProperty("error");
  });
});

describe("queryBody", () => {
  it("asks for this Worker's events in the window, filtered", () => {
    const q = parseLogArgs(["--since", "24h", "--level", "error", "--user", "u1", "--search", "smtp"]) as LogQuery;
    expect(queryBody(q, NOW)).toEqual({
      queryId: "logs-read",
      view: "events",
      limit: 100,
      timeframe: { from: NOW - 86_400_000, to: NOW },
      parameters: {
        filterCombination: "and",
        filters: [
          { key: "$metadata.service", operation: "eq", type: "string", value: WORKER },
          { key: "level", operation: "eq", type: "string", value: "error" },
          { key: "userId", operation: "eq", type: "string", value: "u1" },
        ],
        needle: { value: "smtp" },
      },
    });
  });
});

describe("formatEvents", () => {
  it("prints Budapest time, level, event and the other fields, oldest first", () => {
    const lines = formatEvents([
      { timestamp: NOW + 1000, source: { level: "error", event: "cron step failed", time: "x", requestId: "cron-1", step: "push delivery" } },
      { timestamp: NOW, source: { level: "info", event: "cron start", time: "x", requestId: "cron-1" } },
      { timestamp: NOW + 2000, $metadata: { level: "log", message: "plain text" }, source: "plain text" },
    ]);
    expect(lines).toEqual([
      expect.stringMatching(/19:00:00 INFO cron start \{"requestId":"cron-1"\}$/),
      expect.stringMatching(/19:00:01 ERROR cron step failed \{"requestId":"cron-1","step":"push delivery"\}$/),
      expect.stringMatching(/19:00:02 LOG plain text$/),
    ]);
  });
});
