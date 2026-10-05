import { describe, expect, it } from "vitest";

import { leagueFromPath, parseLeague, switchLeaguePath } from "./leagues";

const GYOR = [{ slug: "gyor", name: "Győr" }];

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("parseLeague", () => {
  it("accepts a league and makes the slug from the name", () => {
    expect(parseLeague(form({ city: "gyor", name: "  Padelpárbaj   Győr ", slug: "" }), GYOR)).toEqual({
      ok: true,
      data: { city: "gyor", name: "Padelpárbaj Győr", slug: "padelparbaj-gyor" },
    });
  });

  it("keeps a typed slug, lowercased", () => {
    const r = parseLeague(form({ city: "gyor", name: "Padelpárbaj Győr", slug: "Gyor" }), GYOR);
    expect(r.ok && r.data.slug).toBe("gyor");
  });

  it("rejects an unknown city, a missing name and a bad slug", () => {
    const r = parseLeague(form({ city: "budapest", name: "x", slug: "nem jó!" }), GYOR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["city", "name", "slug"]);
  });
});

describe("league paths", () => {
  it("finds the league in an admin path", () => {
    expect(leagueFromPath("/admin/leagues/gyor")).toBe("gyor");
    expect(leagueFromPath("/admin/leagues/gyor/clubs")).toBe("gyor");
    expect(leagueFromPath("/admin/leagues")).toBeNull();
    expect(leagueFromPath("/admin/signups")).toBeNull();
  });

  it("switches to the same page of another league", () => {
    expect(switchLeaguePath("/admin/leagues/gyor/clubs", "debrecen")).toBe("/admin/leagues/debrecen/clubs");
    expect(switchLeaguePath("/admin/signups", "debrecen")).toBe("/admin/leagues/debrecen");
  });
});
