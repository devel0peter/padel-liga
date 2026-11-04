// The query behind `npm run logs:read -w app` (scripts/logs-read.ts, #227):
// arguments in, a Workers Observability query out, events back as lines.
// Pure, tested in log-query.test.ts. The script only ever calls the telemetry
// query endpoint, which reads.
// https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/

export const WORKER = "padel-liga";
export const USAGE = `Usage: npm run logs:read -w app -- [--since 1h] [--level error|warn|info] [--event "<event>"]
       [--request <request id>] [--user <account id>] [--search "<text>"] [--limit 100] [--json]
Needs CF_LOGS_TOKEN (read-only token, KeePass group PadelParbaj) and CF_ACCOUNT_ID in the environment.`;

const MAX_SINCE_MS = 7 * 24 * 60 * 60 * 1000;
const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

export type LogQuery = {
  sinceMs: number;
  level?: "error" | "warn" | "info";
  event?: string;
  requestId?: string;
  userId?: string;
  search?: string;
  limit: number;
  json: boolean;
};

export function parseLogArgs(args: readonly string[]): LogQuery | { error: string } {
  const q: LogQuery = { sinceMs: UNIT_MS.h, limit: 100, json: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--json") {
      q.json = true;
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) return { error: `${flag} needs a value.` };
    i++;
    switch (flag) {
      case "--since": {
        const m = /^(\d+)([mhd])$/.exec(value);
        if (!m) return { error: "--since is like 30m, 6h or 3d." };
        q.sinceMs = Number(m[1]) * UNIT_MS[m[2]];
        if (q.sinceMs <= 0 || q.sinceMs > MAX_SINCE_MS) return { error: "--since is at most 7d (logs are kept for 3 days)." };
        break;
      }
      case "--level":
        if (value !== "error" && value !== "warn" && value !== "info") return { error: "--level is error, warn or info." };
        q.level = value;
        break;
      case "--event":
        q.event = value;
        break;
      case "--request":
        q.requestId = value;
        break;
      case "--user":
        q.userId = value;
        break;
      case "--search":
        q.search = value;
        break;
      case "--limit": {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 2000) return { error: "--limit is 1 to 2000." };
        q.limit = n;
        break;
      }
      default:
        return { error: `Unknown option ${flag}.` };
    }
  }
  return q;
}

type Filter = { key: string; operation: "eq"; type: "string"; value: string };
const eq = (key: string, value: string): Filter => ({ key, operation: "eq", type: "string", value });

/** The body of POST /accounts/{account}/workers/observability/telemetry/query. */
export function queryBody(q: LogQuery, now: number) {
  const filters: Filter[] = [eq("$metadata.service", WORKER)];
  // The level field every line of lib/log.ts carries.
  if (q.level) filters.push(eq("level", q.level));
  if (q.event) filters.push(eq("event", q.event));
  if (q.requestId) filters.push(eq("requestId", q.requestId));
  if (q.userId) filters.push(eq("userId", q.userId));
  return {
    queryId: "logs-read",
    view: "events",
    limit: q.limit,
    timeframe: { from: now - q.sinceMs, to: now },
    parameters: {
      filters,
      filterCombination: "and",
      ...(q.search ? { needle: { value: q.search } } : {}),
    },
  };
}

export type TelemetryEvent = {
  timestamp: number;
  $metadata?: { level?: string; message?: string; requestId?: string };
  source?: unknown;
};

const TIME = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** One event as one line, Budapest time first, oldest at the top. */
export function formatEvents(events: readonly TelemetryEvent[]): string[] {
  return [...events]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => {
      const source = e.source && typeof e.source === "object" ? { ...(e.source as Record<string, unknown>) } : null;
      const level = String(source?.level ?? e.$metadata?.level ?? "").toUpperCase();
      const event = String(source?.event ?? e.$metadata?.message ?? (typeof e.source === "string" ? e.source : ""));
      if (source) {
        delete source.level;
        delete source.event;
        delete source.time;
      }
      const rest = source && Object.keys(source).length > 0 ? ` ${JSON.stringify(source)}` : "";
      return `${TIME.format(new Date(e.timestamp))} ${level} ${event}${rest}`;
    });
}
