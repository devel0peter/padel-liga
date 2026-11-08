// The old Párom address (D140, #346): it leads to Profil's Párod section,
// with the query kept, so links in mail and notices sent before still work.
import { describe, expect, it } from "vitest";

import { loader } from "./pair";

const location = (url: string) => {
  const res = loader({ request: new Request(url) } as Parameters<typeof loader>[0]);
  expect(res.status).toBe(302);
  return res.headers.get("Location");
};

describe("/pair", () => {
  it("leads to the Párod section of Profil", () => {
    expect(location("https://padelparbaj.hu/pair")).toBe("/profile#parod");
  });

  it("keeps the query", () => {
    expect(location("https://padelparbaj.hu/pair?joined=1")).toBe("/profile?joined=1#parod");
    expect(location("https://padelparbaj.hu/pair?joined=1&league=gyor")).toBe("/profile?joined=1&league=gyor#parod");
  });
});
