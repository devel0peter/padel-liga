// Reads production logs (Cloudflare Workers Logs) from the terminal (#227).
//   npm run logs:read -w app -- --since 24h --level error
// Read-only: it only calls the telemetry query endpoint, with a token that
// has nothing but Workers Observability access (KeePass, group PadelParbaj).
// The lines hold no personal data by design (app/lib/log.ts); still, keep
// them out of public places.
import { formatEvents, parseLogArgs, queryBody, USAGE, type TelemetryEvent } from "../app/lib/log-query";

const fail = (msg: string): never => {
  console.error(`${msg}\n${USAGE}`);
  process.exit(1);
};

const query = parseLogArgs(process.argv.slice(2));
if ("error" in query) fail(query.error);
const q = query as Exclude<typeof query, { error: string }>;

const token = process.env.CF_LOGS_TOKEN;
const account = process.env.CF_ACCOUNT_ID;
if (!token || !account) fail("CF_LOGS_TOKEN or CF_ACCOUNT_ID is not set.");

const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(queryBody(q, Date.now())),
});
const body = (await res.json().catch(() => null)) as {
  success?: boolean;
  errors?: { message: string }[];
  result?: { events?: { events?: TelemetryEvent[] } };
} | null;
if (!res.ok || !body?.success) fail(`Query failed (${res.status}): ${body?.errors?.map((e) => e.message).join("; ") ?? "no answer"}`);

const events = body?.result?.events?.events ?? [];
if (q.json) console.log(JSON.stringify(events, null, 2));
else {
  for (const line of formatEvents(events)) console.log(line);
  console.error(`${events.length} events${events.length === q.limit ? ` (the limit; narrow it with --since or a filter)` : ""}.`);
}
