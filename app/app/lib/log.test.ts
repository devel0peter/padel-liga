// The structured logger (#227): no personal data gets written, errors keep
// their stack, and every line of an invocation carries its request id.
import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  accountOf,
  beginInvocation,
  currentRequestId,
  log,
  logLine,
  logPath,
  noteAccount,
  REQUEST_ID_HEADER,
  scrub,
  scrubString,
  serializeError,
} from "./log";

const ACCOUNT = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const AT = new Date("2026-11-04T10:00:00Z");

afterEach(() => vi.restoreAllMocks());

describe("scrubString", () => {
  it("removes email addresses", () => {
    expect(scrubString("relay refused anna.kovacs+padel@example.hu: 550")).toBe("relay refused [email]: 550");
  });

  it("removes phone numbers, written any usual way", () => {
    for (const phone of ["+36 30 123 4567", "+36301234567", "06-30-123-4567", "(06 30) 123 45 67", "06301234567"])
      expect(scrubString(`call ${phone} now`), phone).toBe("call [phone] now");
  });

  it("removes a six-digit login code", () => {
    expect(scrubString("code 042913 sent")).toBe("code [code] sent");
  });

  it("removes random tokens (session, pair link, API keys)", () => {
    expect(scrubString("token=q8Zk3vN1pXw7TbR2mLc9YsQ4")).toBe("token=[token]");
    expect(scrubString("Bearer re_9a8b7c6d5e4f3a2b1c0d9e8f")).toBe("Bearer [token]");
  });

  it("keeps account ids, dates, times, counts and status codes", () => {
    const text = `account ${ACCOUNT} at 2026-11-04 10:00, sent 12 of 50, status 503, match 1234`;
    expect(scrubString(text)).toBe(text);
  });
});

describe("scrub", () => {
  it("drops personal fields whatever their value, and cleans the rest", () => {
    const out = scrub({
      email: "a@b.hu",
      toEmail: "a@b.hu",
      to: "a@b.hu",
      phone: "+36301234567",
      name: "Kovács Anna",
      firstName: "Anna",
      code: "123456",
      token: "abc",
      password: "x",
      secret: "y",
      cookie: "z",
      endpoint: "https://push.example/abc",
      status: 200,
      kind: "login_code",
      note: "mail to a@b.hu failed",
    });
    expect(out).toEqual({
      email: "[redacted]",
      toEmail: "[redacted]",
      to: "[redacted]",
      phone: "[redacted]",
      name: "[redacted]",
      firstName: "[redacted]",
      code: "[redacted]",
      token: "[redacted]",
      password: "[redacted]",
      secret: "[redacted]",
      cookie: "[redacted]",
      endpoint: "[redacted]",
      status: 200,
      kind: "login_code",
      note: "mail to [email] failed",
    });
  });

  it("keeps counts keyed by email kind, login_code included", () => {
    expect(scrub({ kinds: { login_code: 2, broadcast: 1 }, loginCode: "123456" })).toEqual({
      kinds: { login_code: 2, broadcast: 1 },
      loginCode: "[redacted]",
    });
  });

  it("blanks code fields named exactly, and nothing that only ends in code (#274)", () => {
    const blanked = ["code", "Code", "loginCode", "login_code", "verificationCode", "verification_code", "verifyCode", "confirmationCode", "authCode", "auth_code", "resetCode", "oneTimeCode", "one_time_code", "otp", "otpCode", "pinCode", "pin_code", "smsCode", "mfaCode", "totpCode", "twoFactorCode", "two_factor_code"];
    const kept = ["statusCode", "status_code", "zipCode", "zip_code", "postalCode", "errorCode", "countryCode", "error-codes", "barcode", "codes", "codeLength", "encode", "unicode"];
    const out = scrub(Object.fromEntries([...blanked, ...kept].map((key) => [key, "123"]))) as Record<string, unknown>;
    for (const key of blanked) expect(out[key], key).toBe("[redacted]");
    for (const key of kept) expect(out[key], key).toBe("123");
  });

  it("keeps email kinds as count keys, code kinds included, and still drops personal keys there", () => {
    expect(scrub({ count: 4, kinds: { login_code: 2, signup_confirmation: 1, email: 1 } })).toEqual({
      count: 4,
      kinds: { login_code: 2, signup_confirmation: 1, email: "[redacted]" },
    });
    expect(scrub({ login_code: "042913" })).toEqual({ login_code: "[redacted]" });
    // Only counts: a code name under `kinds` holding anything else is blanked.
    expect(scrub({ kinds: { code: "042913", login_code: { value: 1 }, sms_code: 3 } })).toEqual({
      kinds: { code: "[redacted]", login_code: "[redacted]", sms_code: 3 },
    });
  });

  it("cleans nested objects and arrays", () => {
    expect(scrub({ list: [{ email: "a@b.hu" }, "c@d.hu"], kinds: { broadcast: 3 } })).toEqual({
      list: [{ email: "[redacted]" }, "[email]"],
      kinds: { broadcast: 3 },
    });
  });
});

describe("serializeError", () => {
  it("keeps the message and the stack, cleaned", () => {
    const error = new Error("no account for anna@example.hu");
    const out = serializeError(error);
    expect(out.name).toBe("Error");
    expect(out.message).toBe("no account for [email]");
    expect(out.stack).toContain("no account for [email]");
    expect(out.stack).toContain("log.test.ts");
    expect(JSON.stringify(out)).not.toContain("anna@example.hu");
  });

  it("hides the bound values of a failed query, at every level, in message and stack", () => {
    const cause = new Error("D1_ERROR: no such table: interest_signups");
    const error = new DrizzleQueryError('insert into "interest_signups" ("name1", "email1", "phone1", "name2", "note") values (?, ?, ?, ?, ?)', [
      "Kovács Anna",
      "anna@example.hu",
      "+36301234567",
      "Nagy Béla",
      "Szombat jó",
    ], cause);
    const wrapped = new Error("signup failed", { cause: error });
    const written = JSON.stringify(logLine("error", "interest signup insert failed", { error: wrapped }, AT));
    for (const value of ["Kovács Anna", "Nagy Béla", "Szombat jó", "anna@example.hu", "36301234567"]) expect(written, value).not.toContain(value);
    const out = serializeError(error);
    expect(out.message).toBe('Failed query: insert into "interest_signups" ("name1", "email1", "phone1", "name2", "note") values (?, ?, ?, ?, ?)\nparams: [hidden]');
    expect(out.stack).toContain("params: [hidden]\n");
    expect(out.stack).toContain("log.test.ts");
    expect((out.cause as { message: string }).message).toBe("D1_ERROR: no such table: interest_signups");
  });

  it("hides every value even when one holds a line shaped like a stack frame (#274)", () => {
    const error = new DrizzleQueryError('update "users" set "name" = ? where "id" = ?', ["Kovács Anna\n    at trick", "x1"], new Error("D1_ERROR"));
    const written = JSON.stringify(logLine("error", "rename failed", { error }, AT));
    expect(written).not.toContain("Kovács Anna");
    expect(written).not.toContain("trick");
    const out = serializeError(error);
    expect(out.message).toBe('Failed query: update "users" set "name" = ? where "id" = ?\nparams: [hidden]');
    expect(out.stack).toContain("params: [hidden]\n");
    expect(out.stack).toContain("log.test.ts");
  });

  it("hides the values of a stack that doesn't repeat the message as written", () => {
    const error = new Error("Failed query: select ?\nparams: Kovács Anna\n    at trick (changed)");
    error.stack = "Error: Failed query: select ?\nparams: Kovács Anna\n    at trick\n    at somewhere (log.test.ts:1:1)";
    const out = serializeError(error);
    expect(out.message).toBe("Failed query: select ?\nparams: [hidden]");
    expect(out.stack).toBe("Error: Failed query: select ?\nparams: [hidden]");
    expect(serializeError("Failed query: select ?\nparams: Kovács Anna\n    at trick")).toEqual({ message: "Failed query: select ?\nparams: [hidden]" });
  });

  it("handles what isn't an Error", () => {
    expect(serializeError("plain a@b.hu")).toEqual({ message: "plain [email]" });
    expect(serializeError({ code: 7 })).toEqual({ message: '{"code":7}' });
  });
});

describe("logPath", () => {
  it("keeps the path and drops the query string", () => {
    expect(logPath("https://padelparbaj.hu/unsubscribe?token=abc&email=a%40b.hu")).toBe("/unsubscribe");
  });

  it("hides the pair link token", () => {
    expect(logPath("https://padelparbaj.hu/pair/join/AbCdEfGhIjKlMnOpQrStUvWx")).toBe("/pair/join/[token]");
  });
});

describe("logLine", () => {
  it("writes level, event, time and the caller's fields", () => {
    expect(logLine("info", "request", { requestId: "r1", path: "/home", status: 200, ms: 12 }, AT)).toEqual({
      level: "info",
      event: "request",
      time: "2026-11-04T10:00:00.000Z",
      requestId: "r1",
      path: "/home",
      status: 200,
      ms: 12,
    });
  });

  it("names the account by id only", () => {
    const line = logLine("info", "login", { userId: ACCOUNT, email: "a@b.hu" }, AT);
    expect(line.userId).toBe(ACCOUNT);
    expect(line.email).toBe("[redacted]");
  });

  it("never writes an email address, a phone number or a token passed to it", () => {
    const write = vi.spyOn(console, "error").mockImplementation(() => {});
    log("error", "email failed", {
      error: new Error("550 anna@example.hu: mailbox full"),
      detail: "call +36 30 123 4567, session q8Zk3vN1pXw7TbR2mLc9YsQ4",
      toEmail: "anna@example.hu",
      phone: "+36301234567",
      token: "q8Zk3vN1pXw7TbR2mLc9YsQ4",
    });
    const written = JSON.stringify(write.mock.calls);
    expect(written).not.toContain("anna@example.hu");
    expect(written).not.toContain("123 4567");
    expect(written).not.toContain("36301234567");
    expect(written).not.toContain("q8Zk3vN1pXw7TbR2mLc9YsQ4");
    expect(written).toContain("mailbox full");
  });

  it("writes errors to console.error, warnings to console.warn, the rest to console.log", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    log("error", "a");
    log("warn", "b");
    log("info", "c");
    expect([error, warn, info].map((s) => s.mock.calls.length)).toEqual([1, 1, 1]);
  });
});

describe("the running invocation", () => {
  it("gives a line the id of the one invocation running", () => {
    const end = beginInvocation("ray-1");
    expect(currentRequestId()).toBe("ray-1");
    expect(logLine("info", "email sent", {}, AT).requestId).toBe("ray-1");
    end();
    expect(currentRequestId()).toBeUndefined();
  });

  it("gives no id while two invocations overlap, rather than a wrong one", () => {
    const endA = beginInvocation("ray-a");
    const endB = beginInvocation("ray-b");
    expect(logLine("info", "email sent", {}, AT).requestId).toBeUndefined();
    endA();
    expect(currentRequestId()).toBe("ray-b");
    endB();
  });

  it("remembers the logged-in account of a request by its request id", () => {
    const end = beginInvocation("ray-2");
    noteAccount(new Request("https://x/", { headers: { [REQUEST_ID_HEADER]: "ray-2" } }), ACCOUNT);
    noteAccount(new Request("https://x/", { headers: { [REQUEST_ID_HEADER]: "other" } }), "nobody");
    expect(accountOf("ray-2")).toBe(ACCOUNT);
    end();
    expect(accountOf("ray-2")).toBeUndefined();
  });
});
