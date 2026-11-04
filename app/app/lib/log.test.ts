// The structured logger (#227): no personal data gets written, errors keep
// their stack, and every line of an invocation carries its request id.
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
