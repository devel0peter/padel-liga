// One watchdog check (#318, D169): open the health address the way a visitor
// does and decide whether the site works. No Cloudflare imports: the fetch and
// the clock are passed in, so check.test.ts runs it in plain Node.
//
// A check succeeds only on status 200 with the body "ok" within the time
// limit. Anything else fails with a short reason: another status (a redirect
// included: redirects are not followed), another body, a Cloudflare challenge,
// no answer in time, a network error.

/** At most 10 seconds per check (#318 requirement 1); the run starts every minute. */
export const TIMEOUT_MS = 10_000;

/** Names the watchdog in the zone's security events and the app's request lines. */
export const USER_AGENT = "padelparbaj-watchdog/1 (+https://github.com/devel0peter/padel-liga)";

export const CHECK_EVENT = "watchdog check";

export type CheckResult =
  | { ok: true; status: number; ms: number }
  | { ok: false; status?: number; ms: number; reason: string };

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

type Options = { fetch?: Fetch; timeoutMs?: number; now?: () => number };

export async function checkHealth(url: string, options: Options = {}): Promise<CheckResult> {
  const doFetch = options.fetch ?? ((u, init) => fetch(u, init));
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  const started = now();
  const elapsed = () => Math.max(0, Math.round(now() - started));

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Resolves first, then aborts, so a slow answer always reads as a timeout
  // and never as the network error the abort causes.
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => {
      resolve("late");
      controller.abort();
    }, timeoutMs);
  });

  const attempt = async (): Promise<CheckResult> => {
    const response = await doFetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, "cache-control": "no-cache" },
    });
    // The body counts toward the time limit too.
    const body = await response.text();
    const status = response.status;
    if (response.headers.get("cf-mitigated") === "challenge") {
      return { ok: false, status, ms: elapsed(), reason: `challenged by Cloudflare (status ${status})` };
    }
    if (status !== 200) return { ok: false, status, ms: elapsed(), reason: `status ${status}` };
    if (body.trim() !== "ok") {
      return { ok: false, status, ms: elapsed(), reason: `unexpected body (${body.length} characters)` };
    }
    return { ok: true, status, ms: elapsed() };
  };

  try {
    const outcome = await Promise.race([attempt(), late]);
    if (outcome === "late") return { ok: false, ms: elapsed(), reason: `no answer in ${timeoutMs} ms` };
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, ms: elapsed(), reason: `network error: ${message}` };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type CheckLine = {
  level: "info" | "error";
  event: typeof CHECK_EVENT;
  time: string;
  url: string;
  ok: boolean;
  status?: number;
  ms: number;
  reason?: string;
};

/**
 * The check line: the same shape as the app's log lines (app/app/lib/log.ts:
 * level, event, time, fields), info on success, error with the reason on
 * failure. Nothing personal: the address, the status, the time taken.
 */
export function checkLine(url: string, result: CheckResult, at = new Date()): CheckLine {
  const line: CheckLine = {
    level: result.ok ? "info" : "error",
    event: CHECK_EVENT,
    time: at.toISOString(),
    url,
    ok: result.ok,
    ms: result.ms,
  };
  if (result.status !== undefined) line.status = result.status;
  if (!result.ok) line.reason = result.reason;
  return line;
}

/** Writes the line: console.error for a failure, so Workers Logs files it as an error. */
export function writeLine(line: CheckLine, out: Pick<Console, "log" | "error"> = console): void {
  if (line.level === "error") out.error(line);
  else out.log(line);
}
