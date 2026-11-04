import { sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { logWarn } from "~/lib/log";

// The health check (#228, D92): GET /health answers "ok" when the app runs and
// the database answers one trivial query in time. An outside uptime monitor
// opens it every 5 minutes and tells Peter when it fails twice in a row.
// Nothing private in the answer: no counts, no versions, no secrets.

export const HEALTH_TIMEOUT_MS = 3000;

const HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

async function selectOne(): Promise<void> {
  await db.run(sql`select 1`);
}

/** Whether the check answers within the time limit, without throwing. */
export async function answersInTime(check: () => Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), timeoutMs);
  });
  try {
    const outcome = await Promise.race([check().then(() => "ok" as const), late]);
    if (outcome === "late") logWarn("health check failed", { reason: `no database answer in ${timeoutMs} ms` });
    return outcome === "ok";
  } catch (error) {
    logWarn("health check failed", { error });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function healthResponse(check: () => Promise<unknown> = selectOne, timeoutMs = HEALTH_TIMEOUT_MS): Promise<Response> {
  const ok = await answersInTime(check, timeoutMs);
  return new Response(ok ? "ok" : "unavailable", { status: ok ? 200 : 503, headers: HEADERS });
}
