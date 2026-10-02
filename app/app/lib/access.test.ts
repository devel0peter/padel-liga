import { describe, expect, it } from "vitest";

import { accessToken } from "./access";

const req = (headers: Record<string, string>) => new Request("https://padelparbaj.hu/admin.data", { headers });

describe("accessToken", () => {
  it("prefers the Access header", () => {
    expect(accessToken(req({ "Cf-Access-Jwt-Assertion": "hdr", Cookie: "CF_Authorization=ck" }))).toBe("hdr");
  });

  it("falls back to the CF_Authorization cookie (/admin.data requests)", () => {
    expect(accessToken(req({ Cookie: "a=1; CF_Authorization=aaa.bbb.ccc; b=2" }))).toBe("aaa.bbb.ccc");
  });

  it("returns null without either", () => {
    expect(accessToken(req({}))).toBeNull();
    expect(accessToken(req({ Cookie: "CF_AuthorizationX=1; other=2" }))).toBeNull();
  });
});
