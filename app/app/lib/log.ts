// Structured production logs (#227). Every line is one object on the console:
// Cloudflare Workers Logs indexes its fields, so the dashboard and
// `npm run logs:read -w app` can filter by event, level, request id, account
// id or error. Pure: no Cloudflare imports, tested in log.test.ts.
//
// No personal data in a line: no email address, phone number, name, login
// code, token or password. Accounts appear by id only. Callers pass ids and
// counts; whatever slips through is scrubbed here (scrub below): fields with a
// personal key are dropped and strings are cleaned, error messages and stack
// traces included.
//
// Request id: the Cloudflare Ray ID of the request (`cf-ray`, which Workers
// Logs also stores as `$metadata.rayId`), or a random id for a cron run or a
// local request. Workers has no AsyncLocalStorage without the nodejs_compat
// flag, so the id of the running invocation is kept here while it runs, and a
// line written while two invocations overlap in one isolate carries none
// rather than a wrong one (Workers Logs still ties it to its invocation by
// `$metadata.requestId`).

export type Level = "info" | "warn" | "error";
export type Fields = Record<string, unknown>;

// The header the Worker puts the request id in (workers/app.ts), so code that
// holds the request can read it.
export const REQUEST_ID_HEADER = "x-request-id";

// ---- Scrubbing --------------------------------------------------------------

// Keys whose value is personal or secret whatever it looks like.
const PERSONAL_KEY =
  /e-?mail|phone|^(first|last|full|display|user|player|partner)?_?name$|^to$|recipient|address|token|password|secret|cookie|authorization|endpoint|session/i;
// A code field, named exactly (#274): `code` itself or a code named for what it
// proves (a login or verification code), camelCase or snake_case. Fields that
// only end in "code" (statusCode, zip_code, error-codes) are not codes.
const CODE_KEY =
  /^(otp|(login|verification|verify|confirmation|confirm|auth|otp|one_?time|reset|security|access|pin|sms|mfa|totp|two_?factor)?_?code)$/i;
const isSecretKey = (key: string) => PERSONAL_KEY.test(key) || CODE_KEY.test(key);
// Objects whose keys name things rather than fields: "email queued" counts
// mails per email kind (`kinds: { login_code: 2 }`), and a kind is not a code.
const NAMED_COUNTS = new Set(["kinds"]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// A run of digits with spaces, dashes, dots, slashes or brackets: a phone
// number when it holds 9 or more digits and doesn't start with a date.
const DIGIT_RUN = /\(?\+?\d[\d\s\-()./]{6,}\d/g;
const DATE_START = /^\d{4}[-./]\s?\d{1,2}[-./]/;
const isPhone = (run: string) => !DATE_START.test(run) && (run.match(/\d/g)?.length ?? 0) >= 9;
// A login code: six digits on their own.
const SIX_DIGITS = /(?<![\d.:-])\d{6}(?![\d.:-])/g;
// A random token: 20 or more URL-safe characters with at least one digit. A
// safety net only: a token without a digit (rare) gets through, and harmless
// long words with digits get masked. Callers never pass tokens.
const TOKEN = /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g;
// Paths that carry a token (the pair link, #55; an email's tracking image, #243).
const TOKEN_PATHS = /^(\/(?:pair\/join|email\/open)\/)[^/?#]+/;

// An account id (a UUID, accounts.server.ts) is not a secret: it stays.
const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID = new RegExp(`^${UUID_SOURCE}$`, "i");
const UUIDS = new RegExp(`(${UUID_SOURCE})`, "i");

export function scrubString(value: string): string {
  // split() with a capture group keeps the UUIDs at the odd indexes.
  return value
    .split(UUIDS)
    .map((part, i) => (i % 2 === 1 ? part : scrubPart(part)))
    .join("");
}

function scrubPart(value: string): string {
  return value
    .replace(EMAIL, "[email]")
    .replace(TOKEN, "[token]")
    .replace(DIGIT_RUN, (run) => (isPhone(run) ? "[phone]" : run))
    .replace(SIX_DIGITS, "[code]");
}

/** A request path for the log: no query string, no token. */
export function logPath(url: string): string {
  const { pathname } = new URL(url, "http://x");
  return scrubString(pathname.replace(TOKEN_PATHS, "$1[token]"));
}

// A failed Drizzle query says "Failed query: <sql>\nparams: <every bound
// value>" in its message and again in its stack: names, notes, addresses.
// The values never reach the log; the SQL stays (it has only placeholders).
// The values are the end of the message, so everything after "params:" goes;
// a value can hold anything, a line shaped like a stack frame included (#274),
// so the end of the values is never guessed from the text.
const PARAMS_MARK = "\nparams: ";
const HIDDEN_PARAMS = `${PARAMS_MARK}[hidden]`;
function withoutParams(text: string): string {
  const at = text.indexOf(PARAMS_MARK);
  return at < 0 ? text : text.slice(0, at) + HIDDEN_PARAMS;
}

// The stack starts with the message: that copy is swapped for the cleaned
// one, and the frames after it stay. A stack that holds values but not the
// message as written (no frames can be told from values then) keeps only
// what comes before them.
function stackWithoutParams(stack: string, message: string): string {
  if (!message.includes(PARAMS_MARK)) return withoutParams(stack);
  const at = stack.indexOf(message);
  if (at >= 0) return stack.slice(0, at) + withoutParams(message) + stack.slice(at + message.length);
  return withoutParams(stack);
}

export function serializeError(error: unknown): Fields {
  if (error instanceof Error) {
    const out: Fields = { name: error.name, message: scrubString(withoutParams(error.message)) };
    if (error.stack) out.stack = scrubString(stackWithoutParams(error.stack, error.message));
    if (error.cause !== undefined) out.cause = serializeError(error.cause);
    return out;
  }
  return { message: scrubString(withoutParams(typeof error === "string" ? error : safeJson(error))) };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Fields without personal data: personal keys dropped, strings cleaned. */
export function scrub(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return serializeError(value);
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 4) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  const out: Fields = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (NAMED_COUNTS.has(key) && v !== null && typeof v === "object" && !Array.isArray(v)) out[key] = scrubNamedCounts(v as Fields, depth + 1);
    else out[key] = isSecretKey(key) ? "[redacted]" : scrub(v, depth + 1);
  }
  return out;
}

// The keys are names (email kinds): personal keys are still dropped, code
// names are not while they hold a count (a number): a code name holding
// anything else is blanked like any code field. The values are cleaned as usual.
function scrubNamedCounts(value: Fields, depth: number): Fields {
  const out: Fields = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const secret = PERSONAL_KEY.test(key) || (CODE_KEY.test(key) && typeof v !== "number");
    out[key] = secret ? "[redacted]" : scrub(v, depth + 1);
  }
  return out;
}

// ---- The running invocation ------------------------------------------------

type Invocation = { requestId: string; userId?: string };
const running = new Map<string, Invocation>();

/** Marks an invocation (a request or a cron run) as running; returns its end. */
export function beginInvocation(requestId: string): () => void {
  running.set(requestId, { requestId });
  return () => {
    running.delete(requestId);
  };
}

/** The id of the one invocation running now, if exactly one is. */
export function currentRequestId(): string | undefined {
  if (running.size !== 1) return undefined;
  return running.keys().next().value;
}

export function requestIdOf(request: Request): string | undefined {
  return request.headers.get(REQUEST_ID_HEADER) ?? undefined;
}

/** Remembers the logged-in account of a request for its request line. */
export function noteAccount(request: Request, userId: string): void {
  const id = requestIdOf(request);
  const invocation = id ? running.get(id) : undefined;
  if (invocation) invocation.userId = userId;
}

export function accountOf(requestId: string): string | undefined {
  return running.get(requestId)?.userId;
}

// ---- Writing -----------------------------------------------------------------

/** The line as written; exported for the tests. */
export function logLine(level: Level, event: string, fields: Fields = {}, at = new Date()): Fields {
  const { requestId, userId, ...rest } = fields;
  const line: Fields = { level, event: scrubString(event), time: at.toISOString() };
  const id = typeof requestId === "string" ? requestId : currentRequestId();
  if (id) line.requestId = id;
  if (typeof userId === "string" && UUID.test(userId)) line.userId = userId;
  Object.assign(line, scrub(rest) as Fields);
  return line;
}

export function log(level: Level, event: string, fields?: Fields): void {
  const line = logLine(level, event, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logInfo = (event: string, fields?: Fields) => log("info", event, fields);
export const logWarn = (event: string, fields?: Fields) => log("warn", event, fields);
/** An error line: pass the error as `error` so its message and stack are kept. */
export const logError = (event: string, fields?: Fields) => log("error", event, fields);
