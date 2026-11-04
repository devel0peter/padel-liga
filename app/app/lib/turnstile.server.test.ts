// verifyTurnstile (#255): a form without a token is "missing" and logged
// without the email; Cloudflare's no is "rejected". Siteverify is stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  env: { TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET: "secret", TURNSTILE_HOSTNAMES: "padelparbaj.hu" } as Record<string, string>,
}));
vi.mock("cloudflare:workers", () => ({ env: h.env }));

const { verifyTurnstile } = await import("./turnstile.server");

const request = new Request("https://padelparbaj.hu/login", {
  method: "POST",
  headers: { "User-Agent": "TestPhone/1.0" },
});
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const siteverify = (result: object) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));

describe("verifyTurnstile", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("says missing and logs the action, not the email, when no token came", async () => {
    const fetch = siteverify({ success: true });
    expect(await verifyTurnstile(form({ email: "a@b.hu" }), request, "login")).toBe("missing");
    expect(fetch).not.toHaveBeenCalled();
    const line = JSON.stringify(warn.mock.calls);
    expect(line).toContain("turnstile no token");
    expect(line).toContain("login");
    expect(line).toContain("TestPhone/1.0");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("a@b.hu");
  });

  it("says rejected when Cloudflare says no", async () => {
    siteverify({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyTurnstile(form({ "cf-turnstile-response": "tok" }), request, "login")).toBe("rejected");
  });

  it("says ok for a success on our action and host", async () => {
    siteverify({ success: true, action: "login", hostname: "padelparbaj.hu" });
    expect(await verifyTurnstile(form({ "cf-turnstile-response": "tok" }), request, "login")).toBe("ok");
  });

  it("says ok without a check when Turnstile is off", async () => {
    h.env.TURNSTILE_SITE_KEY = "";
    try {
      expect(await verifyTurnstile(form({}), request, "login")).toBe("ok");
    } finally {
      h.env.TURNSTILE_SITE_KEY = "site";
    }
  });
});
