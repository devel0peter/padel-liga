import { describe, expect, it } from "vitest";

import { defaultSeekers, isSeeking, soloSignupsByEmail } from "./partner-search";

describe("Párt keresek (D59)", () => {
  it("is what the player set, else on only for a waiting solo signup", () => {
    expect(isSeeking(undefined, false)).toBe(false);
    expect(isSeeking(undefined, true)).toBe(true);
    expect(isSeeking(true, false)).toBe(true);
    expect(isSeeking(false, true)).toBe(false);
  });
});

describe("who is on by default", () => {
  const solo = (id: number, email1: string, over: Partial<{ pairedWith: number | null; status: string; city: string; mode: "pair" | "solo" }> = {}) => ({
    id,
    email1,
    mode: "solo" as "pair" | "solo",
    city: "gyor",
    status: "new",
    pairedWith: null as number | null,
    ...over,
  });
  const rows = [
    solo(1, "Wait@x.hu"),
    solo(2, "p@x.hu", { pairedWith: 3, status: "paired" }),
    solo(3, "q@x.hu", { pairedWith: 2, status: "paired" }),
    solo(4, "gone@x.hu", { status: "withdrawn" }),
    solo(5, "deb@x.hu", { city: "deb" }),
    solo(6, "pair@x.hu", { mode: "pair" }),
  ];

  it("a waiting solo; a paired solo only once the partner registered", () => {
    expect([...defaultSeekers(rows, "gyor", new Set()).keys()]).toEqual(["wait@x.hu"]);
    // q registered and they have no pair: p is looking again (and q too, once registered).
    expect([...defaultSeekers(rows, "gyor", new Set(["q@x.hu"])).keys()]).toEqual(["wait@x.hu", "p@x.hu"]);
    expect([...defaultSeekers(rows, "gyor", new Set(["p@x.hu", "q@x.hu"])).keys()]).toEqual(["wait@x.hu", "p@x.hu", "q@x.hu"]);
  });

  it("finds a player's solo signup of the city by email, for the home club (#297)", () => {
    const found = soloSignupsByEmail([...rows, solo(7, "wait@X.hu", { status: "paired" })], "gyor");
    // Lowercased, the newest wins; not withdrawn, not another city, not a pair signup.
    expect([...found.keys()]).toEqual(["wait@x.hu", "p@x.hu", "q@x.hu"]);
    expect(found.get("wait@x.hu")?.id).toBe(7);
  });
});
